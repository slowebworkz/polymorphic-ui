<!-- markdownlint-disable MD024 -->

# Migration Guides

Before/after comparisons for CVA, Radix Slot, and Chakra UI. Each section covers what the migration
looks like in code and what you stop having to manage manually. The last section instead covers a
breaking change within `@praxis-kit/lit`/`@praxis-kit/web` themselves — upgrading existing usage
past the `as` prop's removal.

The [Why not X?](README.md#why-not-x) section of the README covers the positioning reasoning.

---

## Migrating from CVA

### The pattern being replaced

A typical CVA-backed polymorphic button in a React codebase:

```tsx
// button-variants.ts
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

export const buttonVariants = cva('btn', {
  variants: {
    size: { sm: 'btn--sm', md: 'btn--md', lg: 'btn--lg' },
    intent: { primary: 'btn--primary', ghost: 'btn--ghost' },
  },
  defaultVariants: { size: 'md', intent: 'primary' },
})

export type ButtonVariants = VariantProps<typeof buttonVariants>

// Button.tsx
import type { ElementType, ComponentPropsWithoutRef, Ref } from 'react'
import { cn } from '@/lib/utils'
import { buttonVariants } from './button-variants'
import type { ButtonVariants } from './button-variants'

type ButtonOwnProps<T extends ElementType = 'button'> = {
  as?: T
  className?: string
  ref?: Ref<unknown>
} & ButtonVariants

type ButtonProps<T extends ElementType = 'button'> = ButtonOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof ButtonOwnProps<T>>

export function Button<T extends ElementType = 'button'>({
  as,
  size,
  intent,
  className,
  ref,
  ...rest
}: ButtonProps<T>) {
  const Tag = (as ?? 'button') as ElementType
  return <Tag ref={ref} className={cn(buttonVariants({ size, intent }), className)} {...rest} />
}
```

### After

```tsx
import { createContractComponent } from 'praxis-kit/react'

export const Button = createContractComponent({
  tag: 'button',
  name: 'Button',
  styling: {
    base: 'btn',
    variants: {
      size: { sm: 'btn--sm', md: 'btn--md', lg: 'btn--lg' },
      intent: { primary: 'btn--primary', ghost: 'btn--ghost' },
    },
    defaults: { size: 'md', intent: 'primary' },
  },
  filterProps: (key, variantKeys) => variantKeys.has(key),
})
```

### What changed

| Before                                                     | After                                               |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `forwardRef` or explicit `ref` prop threading              | `ref` forwarded automatically (React 19 plain prop) |
| `as` wiring: `const Tag = as ?? 'button'`                  | Built into the component                            |
| `cn(buttonVariants({ size, intent }), className)`          | Class pipeline runs automatically                   |
| Variant keys leak to the DOM unless manually stripped      | `filterProps` declares which props to consume       |
| No `asChild` support without adding `@radix-ui/react-slot` | `asChild` built in                                  |

### Usage is identical

```tsx
// Renders <button class="btn btn--md btn--primary">
<Button>Click me</Button>

// Renders <a class="btn btn--lg btn--ghost">
<Button as="a" href="/" size="lg" intent="ghost">Home</Button>

// Renders child element directly, merging Button's resolved classes onto it
<Button asChild>
  <a href="/dashboard">Dashboard</a>
</Button>
```

### Typing component consumers

The `PolymorphicProps` type replaces the manual `ButtonProps<T>` construction. Extract the variants
object so its type is available, then wrap it in `PolymorphicGenerics`:

```ts
import type { PolymorphicGenerics } from 'praxis-kit/core'
import type { PolymorphicProps, ElementType } from 'praxis-kit/react'

const variants = {
  size: { sm: 'btn--sm', md: 'btn--md', lg: 'btn--lg' },
  intent: { primary: 'btn--primary', ghost: 'btn--ghost' },
} as const

export const Button = createContractComponent({
  tag: 'button',
  name: 'Button',
  styling: { base: 'btn', variants, defaults: { size: 'md', intent: 'primary' } },
  filterProps: (key, variantKeys) => variantKeys.has(key),
})

// TAs defaults to 'button'; override it when the component renders as another element
export type ButtonProps<TAs extends ElementType = 'button'> = PolymorphicProps<
  PolymorphicGenerics<'button', Record<never, never>, typeof variants>,
  TAs
>
```

### What you gain over the CVA pattern

- **ARIA normalization** — `<Button as="nav">` with `role="navigation"` has the redundant role
  stripped automatically; invalid `aria-*` attributes are removed before they reach the DOM.
- **Structural contracts** — `enforcement.children` enforces which children are valid and how many
  are allowed, surfacing violations at render time rather than as silent broken UI.
- **Framework portability** — the same `FactoryOptions` object drives the React, Vue, Preact, Solid,
  Svelte, Lit, and Web adapters; the variant and enforcement logic lives once, in core. (Lit and Web
  are Custom Element hosts rather than VDOM components, so `as`/`asChild` don't carry over the same
  way — see the Lit/Web section below, and each adapter's own README.)
- **Compound variants across presets** — `styling.presets` lets you name variant bundles
  (`variantKey="compact"`) while still allowing compound variants to fire across the preset
  boundary.

---

## Migrating from Radix Slot / `asChild`

### The pattern being replaced

A typical Radix Slot integration for a button that supports `asChild`:

```tsx
import { Slot } from '@radix-ui/react-slot'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'

type ButtonProps = {
  asChild?: boolean
  variant?: 'primary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  className?: string
} & ComponentPropsWithoutRef<'button'>

export function Button({
  asChild,
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      className={cn(
        'btn',
        size === 'sm' && 'btn--sm',
        size === 'md' && 'btn--md',
        size === 'lg' && 'btn--lg',
        variant === 'primary' && 'btn--primary',
        variant === 'ghost' && 'btn--ghost',
        className,
      )}
      {...rest}
    />
  )
}
```

### After

```tsx
import { createContractComponent } from 'praxis-kit/react'

export const Button = createContractComponent({
  tag: 'button',
  styling: {
    base: 'btn',
    variants: {
      size: { sm: 'btn--sm', md: 'btn--md', lg: 'btn--lg' },
      variant: { primary: 'btn--primary', ghost: 'btn--ghost' },
    },
    defaults: { size: 'md', variant: 'primary' },
  },
  filterProps: (key, variantKeys) => variantKeys.has(key),
})
```

### `asChild` usage is identical

```tsx
// Renders an <a>, not a <button>. Button's resolved classes merge onto the anchor.
<Button asChild>
  <a href="/dashboard">Dashboard</a>
</Button>
```

### `Slottable` for wrapping additional content

When the slot child needs to wrap inner content, use `Slottable`:

```tsx
import { createContractComponent, Slottable } from 'praxis-kit/react'

const Button = createContractComponent({ tag: 'button', /* ... */ })

<Button asChild>
  <a href="/dashboard">
    <span aria-hidden>→</span>
    <Slottable>Dashboard</Slottable>
  </a>
</Button>
```

This merges onto the `<a>` and places `Slottable`'s children as the inner content — the same pattern
as Radix's `Slottable`.

### What changed

| Before                                              | After                                            |
| --------------------------------------------------- | ------------------------------------------------ |
| `import { Slot } from '@radix-ui/react-slot'`       | Built into the adapter                           |
| `const Comp = asChild ? Slot : 'button'`            | The `asChild` prop is recognized automatically   |
| Manual `cn(...)` with ternary class logic           | Variant pipeline handles class composition       |
| No `as` prop (Slot doesn't change the element type) | `as` prop also available for inline tag override |

### What you gain over the Radix Slot pattern

- **Variant composition** — Slot handles prop merging; the praxis-kit class pipeline composes
  variant dimensions, base classes, tag-specific overrides, and presets in one pass.
- **ARIA enforcement** — Radix Slot forwards whatever props you give it; this library validates and
  normalizes roles on the resolved element type.
- **Structural contracts** — Slot merges onto exactly one child. It does not validate what that
  child is. `enforcement.children` adds cardinality and type rules on top.
- **Framework neutrality** — `asChild` in the Preact adapter uses the same underlying Slot contract,
  and the variant logic is framework-agnostic.

### Still using Radix UI components?

If your app uses Radix UI component primitives (Dialog, Tooltip, Select, etc.) alongside your own
design-system components, the two coexist cleanly. Radix Slot governs Radix's own `asChild`
behavior. `praxis-kit/react` governs the `asChild` behavior of your components. There is no
conflict.

---

## Migrating from Chakra UI (or any full component library)

Full component libraries ship pre-built components with pre-decided semantics. This migration is
less about replacing components and more about building your own equivalent layer — one that
enforces _your_ design system's rules instead of Chakra's.

### The pattern being replaced

```tsx
// Using Chakra's pre-built polymorphic components
import { Button, ButtonGroup, Box } from '@chakra-ui/react'

// Chakra's rules; you cannot change them
;<ButtonGroup spacing={2}>
  <Button colorScheme="blue">Save</Button>
  <Button variant="ghost">Cancel</Button>
</ButtonGroup>
```

### After — your own components with your own rules

```tsx
import { createContractComponent } from 'praxis-kit/react'
import { isValidElement } from 'react'
import type { ReactElement } from 'react'
import { Button } from './button'

// Button — your variant surface, not Chakra's
export const Button = createContractComponent({
  tag: 'button',
  name: 'Button',
  styling: {
    base: 'btn',
    variants: {
      colorScheme: { blue: 'btn--blue', red: 'btn--red', gray: 'btn--gray' },
      variant: { solid: 'btn--solid', ghost: 'btn--ghost', outline: 'btn--outline' },
    },
    defaults: { colorScheme: 'blue', variant: 'solid' },
  },
  filterProps: (key, variantKeys) => variantKeys.has(key),
})

// ButtonGroup — your cardinality rule, not Chakra's
export const ButtonGroup = createContractComponent({
  tag: 'div',
  name: 'ButtonGroup',
  styling: { base: 'btn-group' },
  enforcement: {
    strict: 'warn',
    children: [
      {
        name: 'Button',
        match: (c): c is ReactElement => isValidElement(c) && c.type === Button,
        cardinality: { min: 1, max: 4 },
      },
    ],
  },
})
```

```tsx
<ButtonGroup>
  <Button colorScheme="blue">Save</Button>
  <Button variant="ghost">Cancel</Button>
</ButtonGroup>

// Violates the cardinality rule — throws at render (with enforcement.strict: 'throw')
<ButtonGroup>
  <Button>One</Button>
  <Button>Two</Button>
  <Button>Three</Button>
  <Button>Four</Button>
  <Button>Five</Button>
</ButtonGroup>
```

### Polymorphic `Box` / layout primitives

Chakra's `Box` is a polymorphic wrapper that applies design-token props. The equivalent:

```tsx
import { createContractComponent } from 'praxis-kit/react'

export const Box = createContractComponent({ tag: 'div' })

// Renders <div>
<Box>content</Box>

// Renders <section>
<Box as="section">content</Box>

// Renders <a>, merging Box's classes onto it
<Box asChild>
  <a href="/">Home</a>
</Box>
```

For Tailwind-specific layout prop filtering, the `praxis-kit/tailwind` plugin integrates with
`styling.plugin` and strips `flex` / `grid` layout tokens to the appropriate contexts.

### What changed

| Before                                                   | After                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Chakra's `colorScheme`, `variant` map to Chakra's tokens | Your variants map to your tokens                                                       |
| Chakra enforces Chakra's component rules                 | You define the rules via `enforcement.children`                                        |
| React-only                                               | Same component definition works across React, Vue, Preact, Solid, Svelte, Lit, and Web |
| Pre-built component semantics                            | Your semantic layer, built on the core runtime                                         |

### Incremental adoption

No need to replace everything at once. A reasonable order:

1. Layout primitives first (`Box`, `Flex`, `Grid`) — they have no semantic opinions.
2. Atomic components next (`Button`, `Input`) — straightforward variant maps.
3. Composite components last (`ButtonGroup`, `Form`) — structural contracts require defining your
   own child rules, which take time to get right.

Chakra components and `@praxis-kit` components can coexist in the same render tree during the
migration. There is no global state conflict.

### What you gain over the Chakra pattern

- **Your constraints** — `ButtonGroup` enforces that it receives 1–4 of _your_ `Button` components,
  not Chakra's. Violations surface at render time, not as broken UI.
- **Framework portability** — the same `FactoryOptions` drives the React, Vue, Preact, Solid,
  Svelte, Lit, and Web adapters. Writing a Vue 3 version of your `Button` is adding an adapter call,
  not rewriting the logic.
- **ARIA normalization** — roles on your components are validated against the resolved element type.
  A `<ButtonGroup as="nav">` will not silently pass invalid ARIA through to the DOM.
- **No design token coupling** — `@praxis-kit` applies whatever class strings you provide. It has no
  opinion on your design tokens, CSS variables, or utility class library.

---

## Upgrading `@praxis-kit/lit` and `@praxis-kit/web` past the `as` removal

Unlike the migrations above, this one isn't about adopting `@praxis-kit` — it's a breaking change
within the Lit and Web adapters themselves, for anyone already using them. Both adapters used to
accept an `as` attribute as a semantic-only override: it never changed the rendered element (a
custom element's tag is fixed at `customElements.define()` time), but it did change which ARIA role
and content-model rules the pipeline applied, as if the element really were a different tag.

That was a real footgun, not a style choice: `as="a"` could produce `role="link"`-shaped output with
none of an anchor's actual keyboard/click/middle-click behavior, and it made SSR output disagree
with what the live client could ever render — `renderToString(Button, { as: 'a' })` used to emit a
literal `<a>…</a>` wrapper, while the browser could only ever produce
`<praxis-button>…</praxis-button>`. `as` has been removed entirely, on both the DOM and SSR paths,
rather than kept under a different name.

### Before

```ts
import { createContractComponent, renderToString } from '@praxis-kit/lit' // or /web

const NavLink = createContractComponent({ tag: 'div', name: 'NavLink' })
customElements.define('praxis-nav-link', NavLink)
```

```html
<!-- Relied on `as` to get link-shaped ARIA semantics on a <div>-tagged component -->
<praxis-nav-link as="a" href="/home">Home</praxis-nav-link>
```

```ts
// SSR used to honor `as` too — output disagreed with the client above
renderToString(NavLink, { as: 'a', href: '/home' })
// => '<a href="/home">Home</a>'
```

### After

`options.tag` is the only thing that decides ARIA/content-model semantics now — register a separate
component for each intrinsic model you need, rather than switching one component's semantics per
instance:

```ts
import { createContractComponent, renderContractToString } from '@praxis-kit/lit' // or /web

const NavLink = createContractComponent({ tag: 'a', name: 'NavLink' })
customElements.define('praxis-nav-link', NavLink)
```

```html
<praxis-nav-link href="/home">Home</praxis-nav-link>
```

```ts
renderContractToString(NavLink, { href: '/home' })
// => '<a href="/home">Home</a>' — now consistent with what the live client's ARIA/content-model
// rules already resolve against, since it's the same options.tag driving both paths
```

`renderToString` was also renamed to `renderContractToString` on both adapters, independent of the
`as` change — it never rendered the actual `<praxis-nav-link>` custom element (it renders
`options.tag`'s intrinsic HTML shape instead, since it has no way to know what name, if any, the
class is eventually registered under), so the new name says what it actually does: serializes the
resolved contract, not the live Custom Element.

### What changed

| Before                                                      | After                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| `as="a"` switched ARIA/content-model semantics per instance | No `as` — register a separate component per intrinsic `tag` |
| `renderToString(Button, { as: 'a' })`                       | `renderContractToString(Button, props)` — no `as` key       |
| SSR output could differ from the live client per call       | SSR output is always `options.tag`, matching every call     |

### Why this is the right trade-off

A custom element's tag is fixed at registration time — no design here could make `<praxis-button>`
literally become an `<a>`. The `as` override didn't add real polymorphism; it added a second,
unstable way to describe semantics that could drift from what the DOM actually was. Removing it
makes `options.tag` mean one thing, consistently, on both the client and SSR — see each adapter's
own "What `tag` means" README section for the fuller model/host distinction this follows from.
