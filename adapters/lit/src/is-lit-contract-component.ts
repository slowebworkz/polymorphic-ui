import type { AnyRecord, EmptyRecord, NoVariants, VariantMap } from '@praxis-kit/core'
import { isFunction } from '@praxis-kit/primitive'
import { LitElement } from 'lit'
import type { LitContractComponent } from './types'

/**
 * Type guard narrowing a generated class down to the public
 * `LitContractComponent<TVariants, TPluginProps>` interface the adapter
 * exposes.
 *
 * Unlike the vnode-style `PolymorphicComponent<G>` in other adapters, this
 * type describes an actual constructable class (`new (): ...`) — so unlike
 * those guards, there's a real runtime fact to check beyond generic-erasure
 * boundaries: the value is a function whose prototype chain includes
 * `LitElement`, exactly what `createContractComponent` always produces.
 *
 * `LitContractComponent`'s third parameter, `G` (the phantom `__generics`
 * marker `GenericsOf`/`ContractProps` read back — `./types/contract-props`),
 * is left at its default here: it carries no runtime signal for this guard to
 * check, and `createContractComponent` supplies the real `G` itself when it
 * casts this function's narrowed result to its public return type.
 */
export function isLitContractComponent<
  TVariants extends Readonly<VariantMap> = NoVariants,
  TPluginProps extends AnyRecord = EmptyRecord,
>(value: unknown): value is LitContractComponent<TVariants, TPluginProps> {
  return isFunction(value) && value.prototype instanceof LitElement
}
