import type {
  AnyRecord,
  EmptyRecord,
  MergeRecords,
  NoVariants,
  PolymorphicGenerics,
  VariantMap,
} from '@praxis-kit/core'
import type { LitElement } from 'lit'

// No `as` field — unlike the VDOM adapters' PolymorphicComponent<G> shapes, a Lit custom element
// has no tag to switch (see createContractComponent's doc comment); G['default'] contributes
// nothing an instance type needs to expose.
export type PolymorphicElement<G extends PolymorphicGenerics> = HTMLElement & G['props']

export type UnknownProps = AnyRecord

// Resolved DOM attribute values about to be serialized (render-to-string.ts) or
// applied to a host element (applyHostState in create-contract-component.ts).
export type ResolvedAttributes = AnyRecord

/**
 * Constructor type returned by createContractComponent.
 *
 * Describes the class contract without exposing LitElement's private members
 * (which would trigger TS4094 in declaration emit). Variant key instance
 * properties are typed via the TVariants parameter.
 *
 * `G` is a phantom marker only — see `__generics` below — and defaults to the
 * widest `PolymorphicGenerics` so existing two-argument usages of this type
 * (every call site inside this adapter) keep resolving exactly as before.
 */
export type LitContractComponent<
  TVariants extends Readonly<VariantMap> = NoVariants,
  TPluginProps extends AnyRecord = EmptyRecord,
  G extends PolymorphicGenerics = PolymorphicGenerics,
> = {
  new (): MergeRecords<
    LitElement & {
      recipe: string | undefined
      praxisClass: string | undefined
    } & { [K in Extract<keyof TVariants, string>]?: string | null },
    TPluginProps
  >

  /**
   * Type-only; never assigned at runtime. `createContractComponent` erases
   * `TDefault`/`Props`/`TPreset` entirely from its return type — only
   * `TVariants` and `TPluginProps` survive as real instance-shape information,
   * since those are the two that show up as actual constructor properties.
   * This field is the Lit adapter's `HasGenerics<G>` (`@praxis-kit/contract-props`)
   * counterpart: it carries the full `PolymorphicGenerics` the component was
   * built from so `GenericsOf`/`ContractProps` (./contract-props) can recover
   * it from outside the file that built it, the same recovery React/Preact do
   * for their own erased overload-based component types. Inline rather than
   * intersected for the same reason those adapters keep it inline — untested
   * here since Lit's type has a single construct signature, not an overload
   * set, but kept consistent with the established shape regardless.
   */
  readonly __generics?: G
}
