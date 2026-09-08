import type {
  AnyClassPluginFactory,
  AnyRecord,
  ElementType,
  EmptyRecord,
  ExtractPluginProps,
  NoPreset,
  NoVariants,
  RecipeMap,
  VariantMap,
} from '@praxis-kit/core'
import type { Diagnostics } from '@praxis-kit/diagnostics'
import {
  assembleCompoundComponent,
  diffAndApplyAttributes,
  invariant,
  resolveHostState,
  toLooseBundle,
} from '@praxis-kit/adapter-utils'
import { buildRuntime } from './build-runtime'
import { isWebContractComponent } from './is-web-contract-component'
import { registerForSsr } from './render-to-string'
import { isWebFactoryOptions } from './to-web-factory-options'
import type { WebContractComponent, WebFactoryOptions, UnknownProps } from './types/index'

/**
 * Creates a plain `HTMLElement` subclass with praxis-kit contracts applied.
 *
 * No framework dependency. Register with `customElements.define()`:
 *
 * ```ts
 * const Button = createContractComponent({
 *   tag: 'button',
 *   name: 'Button',
 *   styling: {
 *     base: 'btn',
 *     variants: { intent: { primary: 'btn--primary', ghost: 'btn--ghost' } },
 *     defaults: { intent: 'primary' },
 *   },
 *   enforcement: { diagnostics: warnDiagnostics },
 * })
 *
 * customElements.define('praxis-button', Button)
 * ```
 *
 * The pipeline runs synchronously on `connectedCallback` and on every
 * `attributeChangedCallback` for praxis-owned attributes (variant keys,
 * `variant-key`, `praxis-class`).
 *
 * For non-reactive attributes (`aria-*`, `role`, `data-*`) — or a praxis-owned
 * property set directly rather than via `setAttribute` (property assignment
 * alone never fires `attributeChangedCallback`) — call `element.update()` after
 * to trigger an explicit pipeline re-run.
 *
 * **This adapter is a Custom Element host carrying a Praxis semantic contract — not a
 * reimplementation of native HTML element behavior.** `options.tag` (`'button'` above) names the
 * _intrinsic model_ Praxis resolves ARIA roles, content-model rules, and built-in prop
 * normalizers (`disabledProps`, etc.) against — it is not, and was never meant to be, the tag
 * actually written to the DOM. The DOM tag is whatever name a caller later passes to
 * `customElements.define(name, Button)`, entirely separate from `options.tag` and not knowable by
 * this function at all (registration happens externally, after this returns, possibly under
 * multiple names or never). So for the example above:
 *
 * ```text
 * Praxis intrinsic model:  button   (options.tag — drives ARIA/content-model/normalizers)
 * DOM host:                praxis-button   (customElements.define()'s name — the actual element)
 * ```
 *
 * A concrete consequence worth internalizing: `<praxis-button disabled>` gets `aria-disabled` from
 * the `disabledProps` normalizer (correctly, since `disabled`'s HTML-boolean-attribute semantics
 * are honored in `_buildProps()` below), but the browser does **not** make the custom element
 * keyboard-inert, form-participating, or otherwise behave like a real `HTMLButtonElement` — that
 * gap isn't a bug, it's the direct consequence of `class X extends HTMLElement`, and no ARIA
 * attribute on any element, custom or not, ever supplies real interactive behavior. The contract
 * layer (styling, variants, ARIA policy, child enforcement, attribute management, lifecycle hooks,
 * diagnostics) and the host's actual interactive behavior are — and have to stay — conceptually
 * separate; a caller who needs real button/link/input behavior supplies it themselves (`onElement`
 * is the wiring point), the same way any `role="button"` `<div>` would require it. (Customized
 * built-ins — `class X extends HTMLButtonElement` + `{ extends: 'button' }` — were considered and
 * rejected for solving this: a real platform mechanism, but a different consumer-facing API
 * (`<button is="…">` instead of `<praxis-button>`) with its own platform constraints, not worth the
 * complexity it would add here.)
 *
 * **No `as` prop.** Like the Lit adapter (this one's closest sibling — both are fixed-identity
 * custom elements, sharing `resolveHostState`/`renderBundleToString` from `@praxis-kit/adapter-utils`),
 * a custom element's DOM tag is fixed at `customElements.define()` time — once the model/host
 * distinction above is explicit, this becomes easy: there is no tag for `as` to switch. An earlier
 * design accepted `as` as a semantic-only override (never changing the rendered element, but
 * changing which ARIA/content-model rules applied, as if it really were a different tag). That was
 * worse than not having it: it could produce `role="link"`-shaped output with none of an anchor's
 * actual keyboard/click/middle-click behavior — a real accessibility footgun regardless of the
 * option's name — and it made `renderContractToString`'s output disagree with itself across calls
 * to the same component, which can only ever produce `<praxis-button>…</praxis-button>` on the live
 * client regardless of what tag `as` named. `as` is filtered out unconditionally in `_buildProps()`
 * below (including as a raw, undeclared HTML attribute, not just a declared property) so
 * `resolveHostState`/`renderBundleToString` — shared, unmodified, cross-adapter code — always
 * resolve to `options.tag` here, on both the client and SSR paths. Need different semantics for one
 * instance? Register a second component with a different `tag`, or set `role` directly — both
 * already work today, unaffected by this.
 */
export function createContractComponent<
  TDefault extends ElementType,
  TProps extends UnknownProps = EmptyRecord,
  TVariants extends Readonly<VariantMap> = NoVariants,
  TPreset extends RecipeMap<TVariants> = NoPreset,
  TPlugin extends AnyClassPluginFactory = AnyClassPluginFactory,
  TSubComponents extends Readonly<AnyRecord> = EmptyRecord,
>(
  options: WebFactoryOptions<TDefault, TProps, TVariants, TPreset, TPlugin> & {
    readonly subComponents?: TSubComponents
  },
): WebContractComponent<TVariants, ExtractPluginProps<TPlugin>> & TSubComponents {
  invariant(isWebFactoryOptions(options), 'options is not a valid WebFactoryOptions object')
  const bundle = buildRuntime(options)
  const looseBundle = toLooseBundle(bundle)

  const variantKeys = options.styling?.variants ? Object.keys(options.styling.variants) : []
  const pluginKeys: readonly string[] =
    'classPlugin' in bundle.runtime ? [...(bundle.runtime.classPlugin.ownedKeys ?? [])] : []

  // Attribute names observed by the browser's native attribute-change callback.
  // Variant keys use their raw name; praxisClass maps to the 'praxis-class' attribute
  // to avoid a circular class→pipeline→class read. No 'as' — see this function's own
  // doc comment above.
  const observedAttrNames = ['variant-key', 'praxis-class', ...variantKeys, ...pluginKeys]

  type InstanceProps = {
    recipe: string | undefined
    praxisClass: string | undefined
  } & { [K in Extract<keyof TVariants, string>]?: string | null } & ExtractPluginProps<TPlugin>

  // In SSR (Node) environments HTMLElement is not defined. The class still needs
  // to be created so registerForSsr() can register the bundle — but the element
  // lifecycle methods (connectedCallback, attributeChangedCallback) will never
  // run server-side; only renderContractToString() is used.
  const BaseElement: typeof HTMLElement =
    typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown as typeof HTMLElement)

  class PolymorphicWebElement extends BaseElement {
    // Set via Object.defineProperty below, right after the class is declared —
    // `declare` here just tells TS the static side genuinely has this property.
    declare static diagnostics: Diagnostics

    // Tracks keys set by the pipeline last run so stale ones are removed.
    private _pipelineAttrs = new Set<string>()

    static get observedAttributes(): string[] {
      return observedAttrNames
    }

    // Tag registered by the consumer's own customElements.define() call is never literally
    // `dialog` (custom-element names must be hyphenated), so native `<dialog>`-specific methods
    // like showModal() won't exist on this class unless the consumer opts into "customized
    // built-ins" (`{ extends: 'dialog' }`) themselves — not something this adapter special-cases.
    private _onElementCleanup: (() => void) | undefined

    connectedCallback(): void {
      this._applyPraxis()
      if (options.onElement) {
        this._onElementCleanup =
          options.onElement(this, () => this._buildProps() as unknown as Readonly<TProps>) ??
          undefined
      }
    }

    disconnectedCallback(): void {
      this._onElementCleanup?.()
      this._onElementCleanup = undefined
    }

    // Fires synchronously for every observed attribute change — no microtask
    // scheduling needed. The guard is implicit: this only fires for
    // observedAttributes, all of which are praxis-owned.
    attributeChangedCallback(_name: string, _old: string | null, _next: string | null): void {
      if (this.isConnected) {
        this._applyPraxis()
      }
    }

    /** Re-runs the pipeline. Call after setting non-reactive attributes (aria-*, role, data-*)
     *  or a praxis-owned property directly (see this module's own doc comment). */
    update(): void {
      this._applyPraxis()
    }

    private get _self(): InstanceProps {
      return this as unknown as InstanceProps
    }

    // Shared by _applyPraxis and the onElement getProps accessor — both need the same
    // attribute-derived prop snapshot, just for different purposes (pipeline input vs.
    // exposing "current props" to author-supplied element wiring).
    private _buildProps(): UnknownProps {
      const self = this._self

      // Skip 'class' (pipeline output), 'as' (see this module's own doc comment — never a
      // pipeline input, declared or not), and all observedAttributes. Observed attrs are
      // either read as camelCase below (variant keys, praxis-class) or are user-added
      // observed attrs (e.g. 'value' in a subclass) that must not leak into state.attributes
      // — setAttribute on an observed attr would re-trigger this callback and cause infinite
      // recursion.
      const observedSet = new Set(
        (this.constructor as { observedAttributes?: readonly string[] }).observedAttributes ?? [],
      )
      const props: UnknownProps = {}
      for (const attr of Array.from(this.attributes)) {
        if (attr.name === 'class' || attr.name === 'as' || observedSet.has(attr.name)) continue
        // `disabled` is an HTML boolean attribute — presence means true regardless
        // of value (even disabled="false"), matching native <button disabled> semantics.
        // Read as a raw string otherwise, disabledProps would see '' and treat it as falsy.
        props[attr.name] = attr.name === 'disabled' ? true : attr.value
      }

      // Overlay the typed view of praxis-owned attributes; attribute values are
      // always strings, but consumers may set them via property too.
      props['recipe'] = self.recipe ?? this.getAttribute('variant-key') ?? undefined
      props['className'] = self.praxisClass ?? this.getAttribute('praxis-class') ?? undefined

      for (const key of variantKeys) {
        const val = self[key as Extract<keyof TVariants, string>] ?? this.getAttribute(key)
        if (val != null) props[key] = val
      }
      return props
    }

    private _applyPraxis(): void {
      const {
        childrenEvaluator,
        runtime: { options },
      } = bundle
      const props = this._buildProps()
      const hostState = resolveHostState(looseBundle, props)
      const children = Array.from(this.childNodes)

      if (childrenEvaluator) {
        childrenEvaluator.evaluate(children, {
          tag: hostState.tag,
          props: hostState.normalizedProps,
        })
      }
      options
        .htmlChildrenEvaluatorFn?.(hostState.tag)
        ?.evaluate(children, { tag: hostState.tag, props: hostState.normalizedProps })

      diffAndApplyAttributes(this, hostState, this._pipelineAttrs, props)
    }
  }

  if (options.name) {
    Object.defineProperty(PolymorphicWebElement, 'name', { value: options.name })
  }

  Object.defineProperty(PolymorphicWebElement, 'diagnostics', { value: bundle.diagnostics })

  // Validates the class shape (default generics — registerForSsr's own
  // parameter type doesn't need TVariants/TPlugin either) before registering
  // it, replacing what was previously an unchecked cast. Captured into a
  // plain const first — narrowing a `class` declaration's own identifier
  // doesn't reliably persist to later statements the same way it does for
  // an ordinary variable.
  const contractClass = PolymorphicWebElement
  invariant(
    isWebContractComponent(contractClass),
    'Generated class failed to satisfy the WebContractComponent shape',
  )

  // Register for SSR before returning — renderContractToString looks up the bundle via WeakMap.
  registerForSsr(contractClass, looseBundle)

  const assembled = assembleCompoundComponent(contractClass, options.subComponents)

  // TVariants/TPlugin are erased at runtime and can't be checked by any
  // guard — the check above already proves the class shape genuinely, this
  // just bridges the erased generics onto the specific public type.
  return assembled as unknown as WebContractComponent<TVariants, ExtractPluginProps<TPlugin>> &
    TSubComponents
}
