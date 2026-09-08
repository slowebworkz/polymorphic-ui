import { renderBundleToString } from '@praxis-kit/adapter-utils'
import type { LooseBundle, RegistryEntry, UnknownProps, WebContractComponent } from './types/index'

// Module-local: a second, separately-bundled copy of this adapter package would get its own
// registry, and a class registered against one copy wouldn't resolve against the other's
// renderContractToString. Not a concern today, but worth flagging for whenever this package's own
// build/publish pipeline starts assembling multiple entry points — same "single identity" invariant
// noted on Lit's identical registry (`adapters/lit/src/render-to-string.ts`).
const ssrRegistry = new WeakMap<WebContractComponent, RegistryEntry>()

/** Called by createContractComponent to enable renderContractToString for a class. */
export function registerForSsr(cls: WebContractComponent, bundle: LooseBundle): void {
  ssrRegistry.set(cls, { bundle })
}

/**
 * Serializes a praxis-kit web component's **resolved contract** to an HTML string, without
 * requiring a DOM — not Custom Element SSR, and not a hydration mechanism.
 *
 * This distinction matters and is easy to get wrong: the output element is `options.tag`
 * (`<button>…</button>`, say), never the registered custom-element tag (`<praxis-button>`) —
 * `createContractComponent`'s own doc comment covers why the two are different concepts ("the
 * element Praxis models" vs. "the element actually in the DOM"). `customElements.define()` happens
 * externally, after `createContractComponent()` returns, and this function has no way to know what
 * name (if any) a caller eventually registers the class under, so there is no tag it could emit
 * that's guaranteed to match. Even if it could, the browser's Custom Element upgrade mechanism only
 * upgrades an exact tag-name match — a server-sent `<button>` can never become the live
 * `<praxis-button>` no matter what the client bundle does, so this was never a viable
 * SSR-then-upgrade path regardless of naming.
 *
 * Use this for what it actually is: previewing/testing the resolved styling + ARIA + attribute
 * pipeline as plain HTML (static generation, snapshot tests, non-interactive contexts) — not for
 * server-rendering markup you intend the live custom element to take over.
 *
 * `innerHTML` is treated as a pre-sanitized HTML string and inserted verbatim.
 * Callers are responsible for escaping any untrusted content before passing it.
 */
export function renderContractToString(
  component: WebContractComponent,
  props: UnknownProps = {},
  innerHTML = '',
): string {
  const entry = ssrRegistry.get(component)
  if (!entry) {
    const name = (component as { name?: string }).name ?? 'AnonymousComponent'
    throw new Error(
      `[renderContractToString] ${name} was not registered for SSR. ` +
        'Ensure it was created with createContractComponent from @praxis-kit/web.',
    )
  }

  // `as` intentionally discarded — see this function's own doc comment above.
  const { as: _as, ...rest } = props
  return renderBundleToString(entry.bundle, rest, innerHTML)
}
