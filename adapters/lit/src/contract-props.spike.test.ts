/**
 * Compile-time type contract tests for `ContractProps<T>` / `GenericsOf<T>` — the Lit analog of
 * `adapters/preact/src/contract-props.spike.test.tsx` (React has the same shape too). Lit has no
 * `asChild`/`render` mode (see the "known limitations" note atop `conformance.test.ts`), so unlike
 * those two adapters there is no `Mode` parameter here, and no asChild-mode section below.
 *
 * `createContractComponent`'s return type erases `TDefault`/`Props`/`TPreset` entirely — nothing
 * short of the phantom `__generics` marker on `LitContractComponent` (`./types/primitives`) could
 * recover them from outside this file. These tests exist to catch a regression in that recovery,
 * not to re-test `PropsOf`/`VariantProps`/etc. themselves (covered in `@praxis-kit/core`). Checks
 * are written as direct indexed/accessor comparisons rather than whole-object structural matches —
 * `ContractProps<T>` always carries `recipe` alongside the custom props, so matching against a
 * partial object shape would either miss that field or have to keep re-declaring it here.
 *
 * No runtime assertions are made — `expectTypeOf` only.
 */
import { describe, it, expectTypeOf } from 'vitest'
import type { DefaultOf, EmptyRecord, PolymorphicGenerics, PropsOf } from '@praxis-kit/core'
import { createContractComponent } from './create-contract-component'
import type { ContractProps, GenericsOf } from './types'

type ButtonProps = { readonly loading?: boolean }

const buttonVariants = { intent: { primary: 'btn-primary', ghost: 'btn-ghost' } } as const

const Button = createContractComponent<'button', ButtonProps, typeof buttonVariants>({
  tag: 'button',
  name: 'SpikeButton',
  styling: { base: 'btn-base', variants: buttonVariants, defaults: { intent: 'ghost' } },
})

const Header = createContractComponent({ tag: 'header', name: 'SpikeCardHeader' })

const Card = createContractComponent({
  tag: 'section',
  name: 'SpikeCard',
  subComponents: { Header },
})

// Unlike React/Preact's JSX-based spike tests, nothing here renders — every
// assertion below is `typeof Button`/`typeof Card` in a type position only.
void Button
void Card

describe('GenericsOf', () => {
  it('recovers the PolymorphicGenerics a component was built from', () => {
    expectTypeOf<PropsOf<GenericsOf<typeof Button>>>().toEqualTypeOf<ButtonProps>()
    expectTypeOf<DefaultOf<GenericsOf<typeof Button>>>().toEqualTypeOf<'button'>()
  })

  it('falls back to the widest PolymorphicGenerics for a value with no marker', () => {
    // `{}` structurally satisfies `HasGenerics<PolymorphicGenerics>` — `__generics` is optional —
    // the same "no marker, nothing to recover" case documented on the type itself.
    expectTypeOf<GenericsOf<object>>().toEqualTypeOf<PolymorphicGenerics>()
  })
})

describe('ContractProps', () => {
  it('recovers the custom props declared via TProps', () => {
    expectTypeOf<ContractProps<typeof Button>['loading']>().toEqualTypeOf<boolean | undefined>()
  })

  it('recovers variant props declared via the styling.variants map', () => {
    expectTypeOf<ContractProps<typeof Button>['intent']>().toEqualTypeOf<
      'primary' | 'ghost' | undefined
    >()
  })

  it('has no `as` — unlike every VDOM adapter, Lit has no tag polymorphism to type', () => {
    // A custom element's tag is fixed at customElements.define() time; `as` can't change it.
    // The declared property type is `never` (read back here as `undefined`, since an optional
    // property's read type is always `T | undefined` — `never | undefined` collapses to
    // `undefined`), which is what makes *assigning* `as` a compile error below, matching
    // createContractComponent's runtime behavior of filtering `as` out unconditionally.
    expectTypeOf<ContractProps<typeof Button>['as']>().toEqualTypeOf<undefined>()

    const props: ContractProps<typeof Button> = { loading: true, intent: 'primary' }
    // @ts-expect-error — `as` is declared `never`; no value satisfies it.
    props.as = 'a'
    void props
  })

  it("resolves the root's own props on a compound component, unaffected by subComponents", () => {
    expectTypeOf<PropsOf<GenericsOf<typeof Card>>>().toEqualTypeOf<EmptyRecord>()
    expectTypeOf<ContractProps<typeof Card>['as']>().toEqualTypeOf<undefined>()
  })
})
