# @praxis-kit/web

Vanilla Custom Elements adapter for praxis-kit — a Custom Element host carrying a Praxis semantic
contract: styling, ARIA policy, and structural child validation. No framework dependency, no
`@praxis-kit/runtime` or any other rendering library — a plain `HTMLElement` subclass. Not a
reimplementation of native HTML element behavior — see "What `tag` means" below.

Private workspace; ships to users as the `praxis-kit/web` entry of the published package.

---

## Usage

```ts
import { createContractComponent, defineContractComponent } from 'praxis-kit/web'

const Button = createContractComponent({
  tag: 'button',
  name: 'Button',
  styling: {
    base: 'btn',
    variants: { size: { sm: 'btn--sm', lg: 'btn--lg' } },
    defaults: { size: 'sm' },
  },
  enforcement: { strict: 'warn' },
})

customElements.define('praxis-button', Button)
```

### What `tag` means

`options.tag` is the **intrinsic model** Praxis resolves ARIA roles, content-model rules, and
built-in prop normalizers against — it is not, and never was, the tag written to the DOM:

```text
Praxis intrinsic model:  button          (options.tag)
DOM host:                praxis-button   (customElements.define()'s name — the real element)
```

A concrete consequence: `<praxis-button disabled>` gets `aria-disabled="true"` from the built-in
`disabledProps` normalizer, but the browser does **not** make the custom element keyboard-inert or
form-participating — no ARIA attribute, on any element, custom or not, ever supplies real
interactive behavior. Need real button/link/input behavior? Wire it yourself (`onElement` is the
hook) — the same requirement any `role="button"` `<div>` would carry.

Two differences from the other adapters, both consequences of the model/host distinction above
rather than bugs — identical to the Lit adapter's, since both are fixed-identity custom elements
sharing the same underlying pipeline:

- **No `as` — no tag polymorphism at all.** A custom element's DOM tag is fixed at
  `customElements.define()` time; nothing at render time can turn a `<praxis-button>` into an `<a>`.
  Setting an `as` attribute has no effect (filtered out before it reaches the pipeline, on both the
  DOM and SSR paths) rather than silently reinterpreting semantics for a tag the element will never
  actually be. Need different semantics for one case? Register a second component with a different
  `tag`, or set `role` directly.
- **Variant attributes stay on the host.** They're read from and reflected as real DOM attributes,
  unlike React/Vue where they're consumed and stripped before reaching the DOM.

`asChild` is not available on this adapter — Light DOM has no JSX-style slot to clone props onto.

### `renderContractToString` — not Custom Element SSR

`renderContractToString(Button, props)` serializes the **resolved contract** — the same
styling/ARIA/attribute pipeline the live element runs — as plain HTML using `options.tag`
(`<button>…</button>`, not `<praxis-button>…</praxis-button>`). It's a preview/static-HTML utility
(snapshot tests, static generation, non-interactive contexts), not a hydration mechanism: this
function has no way to know what name (if any) a caller eventually registers the class under
(`customElements.define()` happens externally, after the fact), so it can't emit a tag the browser
could ever upgrade in place even if it tried.

## Exports

| Export                        | Description                                                         |
| ----------------------------- | ------------------------------------------------------------------- |
| `createContractComponent`     | Factory: styling + ARIA enforcement + children validation           |
| `defineContractComponent`     | Curries a factory's options so multiple call sites share one config |
| `renderContractToString`      | Serializes the resolved contract to HTML — not Custom Element SSR   |
| `WebFactoryOptions` (type)    | Factory options with web-specific extensions                        |
| `WebContractComponent` (type) | Return type of the factory                                          |

No peer dependencies — this is the zero-framework path.

Development: `pnpm --filter @praxis-kit/web test` (includes an SSR suite), `typecheck`, `lint`.
