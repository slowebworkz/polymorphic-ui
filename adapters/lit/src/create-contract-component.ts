import {
  assembleCompoundComponent,
  diffAndApplyAttributes,
  invariant,
  resolveHostState,
  resolveTagAndNormalizedProps,
  toLooseBundle,
} from '@praxis-kit/adapter-utils'
import type {
  AnyClassPluginFactory,
  AnyRecord,
  ElementType,
  EmptyRecord,
  ExtractPluginProps,
  MergeRecords,
  NoPreset,
  NoVariants,
  RecipeMap,
  VariantMap,
} from '@praxis-kit/core'
import { iterate } from '@praxis-kit/primitive'
import type { StringMap } from '@praxis-kit/primitive'
import { LitElement, html } from 'lit'
import { buildRuntime } from './build-runtime'
import { isLitContractComponent } from './is-lit-contract-component'
import { registerForSsr } from './render-to-string'
import { isLitFactoryOptions } from './to-lit-factory-options'
import type { LitContractComponent, LitFactoryOptions, RuntimeG, UnknownProps } from './types'

/**
 * Creates a Lit custom element class with praxis-kit contracts applied.
 *
 * Returns a LitElement subclass. Register it with customElements.define():
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
 *   enforcement: { strict: 'warn' },
 * })
 *
 * customElements.define('praxis-button', Button)
 * ```
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
 * **No `as` prop, unlike every VDOM adapter.** React/Vue/Preact/Solid/Svelte's `as` genuinely
 * changes the rendered host element — real tag polymorphism. Once the model/host distinction above
 * is explicit, this becomes easy: a custom element's DOM tag is fixed at `customElements.define()`
 * time, so there is no tag for `as` to switch — this adapter never accepted `as` as a semantic-only
 * override either (an earlier design did — resolving ARIA/content-model rules as if the element
 * were a different tag while the real DOM node stayed put). That was worse than not having it: it
 * let a caller produce `role="link"`-shaped output with none of an anchor's actual
 * keyboard/click/middle-click behavior — a real accessibility footgun regardless of what the
 * option was named — and it made `renderContractToString`'s output disagree with the live client
 * (SSR had no live DOM to constrain it to `options.tag`, so it rendered the *chosen* tag as a
 * literal wrapper, e.g. `<a>…</a>`, while the browser could only ever produce
 * `<praxis-button>…</praxis-button>`). `as` is filtered out unconditionally in `_buildProps()`
 * below (including as a raw, undeclared HTML attribute — not just the removed Lit property)
 * precisely so `resolveTag`/`renderBundleToString` — shared, unmodified, cross-adapter code —
 * always resolve to `options.tag` for this adapter, on both the client and SSR paths alike.
 * Matches `capabilities.tagPolymorphism: false` already declared in the conformance suite
 * (`conformance.test.ts`), which this closes a real gap against: that flag already said Lit has no
 * tag polymorphism, but SSR quietly provided a fake, DOM-inconsistent form of it until now. Need
 * different semantics for one instance? Register a second component with a different `tag`, or
 * set `role` directly — both already work today, unaffected by this.
 */
export function createContractComponent<
  TDefault extends ElementType,
  TProps extends UnknownProps = EmptyRecord,
  TVariants extends Readonly<VariantMap> = NoVariants,
  TPreset extends RecipeMap<TVariants> = NoPreset,
  TPlugin extends AnyClassPluginFactory = AnyClassPluginFactory,
  TSubComponents extends Readonly<AnyRecord> = EmptyRecord,
>(
  options: LitFactoryOptions<TDefault, TProps, TVariants, TPreset, TPlugin> & {
    readonly subComponents?: TSubComponents
  },
): MergeRecords<
  LitContractComponent<
    TVariants,
    ExtractPluginProps<TPlugin>,
    RuntimeG<TDefault, TProps, TVariants, TPreset>
  >,
  TSubComponents
> {
  invariant(isLitFactoryOptions(options), 'options is not a valid LitFactoryOptions object')
  const bundle = buildRuntime(options)
  const looseBundle = toLooseBundle(bundle)

  const variantKeys = options.styling?.variants ? Object.keys(options.styling.variants) : []
  const pluginKeys: readonly string[] =
    'classPlugin' in bundle.runtime ? [...(bundle.runtime.classPlugin.ownedKeys ?? [])] : []

  // Set of reactive property keys owned by the praxis pipeline. Used in
  // requestUpdate() to decide whether a given property change requires a
  // pipeline re-run. Manual requestUpdate() calls (name === undefined) always
  // set the dirty flag so ARIA/role reconciliation is never skipped.
  //
  // No `as` here: unlike the VDOM adapters, a custom element's tag is fixed at
  // customElements.define() time, so there is no real tag to switch — see the
  // `as` attribute note in _buildProps() below.
  const praxisProps = new Set<PropertyKey>(['recipe', 'praxisClass', ...variantKeys, ...pluginKeys])

  const staticProps: StringMap<{ type: typeof String; attribute: string | boolean }> = {
    recipe: { type: String, attribute: 'variant-key' },
    // External className input — separate from the pipeline-output `class`
    // attribute so _applyPraxis can read it without a circular class→pipeline→class loop.
    praxisClass: { type: String, attribute: 'praxis-class' },
  }
  iterate.forEach(variantKeys, (key) => {
    staticProps[key] = { type: String, attribute: key }
  })
  iterate.forEach(pluginKeys, (key) => {
    staticProps[key] = { type: String, attribute: key }
  })

  // Typed view of the reactive instance properties that _applyPraxis reads.
  // `declare` emits no JS — Lit's finalize() installs the actual getters/setters
  // at runtime. The variant key index covers dynamic variant properties.
  type InstanceProps = {
    recipe: string | undefined
    praxisClass: string | undefined
  } & { [K in Extract<keyof TVariants, string>]?: string | null } & ExtractPluginProps<TPlugin>

  class PolymorphicLitElement extends LitElement {
    declare recipe: string | undefined
    declare praxisClass: string | undefined

    // Tracks keys set by the pipeline last render so stale attrs are removed.
    private _pipelineAttrs = new Set<string>()
    // Starts true so the first update always runs the pipeline regardless of
    // what triggered it. Cleared after _applyPraxis() and re-set only when a
    // praxis-owned property changes or requestUpdate() is called manually.
    private _praxisDirty = true

    static override get properties() {
      return staticProps
    }

    // Light DOM — class pipeline applies directly to the host element.
    protected override createRenderRoot() {
      return this
    }

    // Guard: only re-run the pipeline when a praxis-owned property changed or
    // when requestUpdate() was called manually (name === undefined — covers
    // both the initial connection and consumer-driven ARIA attribute updates).
    // Updates triggered by non-praxis reactive properties on a subclass are
    // skipped, avoiding redundant pipeline runs on unrelated state changes.
    override requestUpdate(name?: PropertyKey, oldValue?: unknown): void {
      if (name === undefined || praxisProps.has(name)) {
        this._praxisDirty = true
      }
      super.requestUpdate(name, oldValue)
    }

    override updated(changed: Map<PropertyKey, unknown>) {
      super.updated(changed)
      if (this._praxisDirty) {
        this._praxisDirty = false
        this._applyPraxis()
      }
    }

    // Single cast at the class boundary — Lit's finalize() installs the
    // reactive property getters/setters at runtime; this accessor exposes them
    // under the typed shape so _applyPraxis never needs to cast inline.
    private get _self(): InstanceProps {
      return this as unknown as InstanceProps
    }

    // Start with all current DOM attributes so the ARIA engine sees role,
    // aria-*, and any other pass-through attributes. Shared by render() and
    // _applyPraxis(), which run at different points in the same update cycle
    // and can't share a local variable.
    private _buildProps(): UnknownProps {
      const self = this._self
      const props: UnknownProps = {}
      iterate.forEach(iterate.items(this.attributes), (attr) => {
        if (attr.name === 'class') return
        // `as` is deliberately never surfaced into the pipeline's prop bag — see the
        // module-level note above `createContractComponent` for why (a custom element's
        // tag can't actually change; `resolveTag`/`resolveTagAndNormalizedProps` — shared
        // with every VDOM adapter — treat a present `as` key as "the tag to resolve to"
        // unconditionally, so even an undeclared, unrecognized `as="..."` attribute would
        // otherwise flow straight through this generic scan and reach it). Filtering it
        // here, at the one place every prop-collection path funnels through, is what makes
        // it inert for a raw HTML `as="…"` attribute too, not just the removed Lit property.
        if (attr.name === 'as') return
        // `disabled` is an HTML boolean attribute — presence means true regardless
        // of value (even disabled="false"), matching native <button disabled> semantics.
        // Read as a raw string otherwise, disabledProps would see '' and treat it as falsy.
        props[attr.name] = attr.name === 'disabled' ? true : attr.value
      })

      // Overlay Lit-managed properties for variant keys — these may differ
      // from raw attribute strings if Lit has type-coerced them.
      props['recipe'] = self.recipe
      props['className'] = self.praxisClass
      iterate.forEach(variantKeys, (key) => {
        // Lit sets removed attributes to null; treat null the same as undefined
        // so CVA falls back to defaultVariants when no explicit value is present.
        const val = self[key as Extract<keyof TVariants, string>]
        if (val != null) props[key] = val
      })
      return props
    }

    private _applyPraxis() {
      const props = this._buildProps()
      diffAndApplyAttributes(this, resolveHostState(looseBundle, props), this._pipelineAttrs, props)
    }

    // Light DOM means `this` already is the real host element — no ref/indirection needed.
    // connectedCallback/disconnectedCallback are the native mount/unmount lifecycle, called
    // once per instance regardless of how many pipeline re-runs `_applyPraxis` does.
    private _onElementCleanup: (() => void) | undefined

    override connectedCallback() {
      super.connectedCallback()
      if (options.onElement) {
        this._onElementCleanup =
          options.onElement(this, () => this._buildProps() as unknown as Readonly<TProps>) ??
          undefined
      }
    }

    override disconnectedCallback() {
      super.disconnectedCallback()
      this._onElementCleanup?.()
      this._onElementCleanup = undefined
    }

    override render() {
      const children = Array.from(this.childNodes)
      const { tag, normalizedProps } = resolveTagAndNormalizedProps(looseBundle, this._buildProps())
      if (bundle.childrenEvaluator) {
        bundle.childrenEvaluator.evaluate(children, { tag, props: normalizedProps })
      }
      bundle.runtime.options
        .htmlChildrenEvaluatorFn?.(tag)
        ?.evaluate(children, { tag, props: normalizedProps })
      return html`<slot></slot>`
    }
  }

  if (options.name) {
    Object.defineProperty(PolymorphicLitElement, 'name', { value: options.name })
  }

  // Validates the class shape (default generics — registerForSsr's own
  // parameter type doesn't need TVariants/TPlugin either) before registering
  // it, replacing what was previously an unchecked cast.
  invariant(
    isLitContractComponent(PolymorphicLitElement),
    'Generated class failed to satisfy the LitContractComponent shape',
  )

  // Register for SSR before returning — renderContractToString looks up the bundle via WeakMap.
  registerForSsr(PolymorphicLitElement, looseBundle)

  const assembled = assembleCompoundComponent(PolymorphicLitElement, options.subComponents)

  // TVariants/TPlugin/G are all erased at runtime and can't be checked by any
  // guard — the check above already proves the class shape genuinely, this
  // just bridges the erased generics (including the phantom __generics
  // marker, never assigned above — see LitContractComponent's own doc
  // comment) onto the specific public type.
  return assembled as unknown as MergeRecords<
    LitContractComponent<
      TVariants,
      ExtractPluginProps<TPlugin>,
      RuntimeG<TDefault, TProps, TVariants, TPreset>
    >,
    TSubComponents
  >
}
