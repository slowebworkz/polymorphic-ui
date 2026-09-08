// @vitest-environment node
//
// Lit SSR — serializes the resolved Praxis contract to an HTML string, without any DOM globals.
// Not Custom Element SSR: the output tag is always options.tag ('button' below), never the
// registered custom-element tag ('praxis-button') — see renderContractToString's own doc comment
// for the full reasoning, and createContractComponent's for the "model vs. host" distinction this
// follows from. As a consequence, this output isn't meant to be handed to the browser expecting the
// live custom element to take over it — there's no tag-name match for the platform's Custom Element
// upgrade mechanism to act on. It's a serialization of the contract's resolved styling/ARIA/
// attribute pipeline, useful on its own (static generation, snapshot tests, previews).
//
// The rendered tag always comes from options.tag, never from an `as` prop — this adapter has no
// tag polymorphism at all (capabilities.tagPolymorphism: false, both here and in
// conformance.test.ts), on the DOM path or this SSR path. See createContractComponent's own doc
// comment for why: an earlier design honored `as` here, making this output disagree even with
// itself across calls to the same component.

import { describe, it, expect } from 'vitest'
import { ssrConformanceSuite } from '@praxis-kit/adapter-utils/testing'
import type { BareFactoryOptions } from '@praxis-kit/adapter-utils/testing'
import { silentDiagnostics } from '@praxis-kit/diagnostics'
import { createContractComponent } from './create-contract-component'
import { renderContractToString } from './render-to-string'

// ─── Conformance suite ────────────────────────────────────────────────────────

ssrConformanceSuite({
  createComponent: (options) =>
    createContractComponent(options as unknown as BareFactoryOptions) as ReturnType<
      typeof createContractComponent
    > & { displayName?: string },

  renderToString: (component, props = {}) => renderContractToString(component, props),

  capabilities: { tagPolymorphism: false },
})

// ─── Lit-specific SSR tests ───────────────────────────────────────────────────

describe('renderContractToString — Lit-specific', () => {
  it('renders self-closing element when children is empty', () => {
    const Box = createContractComponent({
      tag: 'div',
      enforcement: { diagnostics: silentDiagnostics },
    })
    const html = renderContractToString(Box)
    expect(html).toBe('<div></div>')
  })

  it('includes children in output', () => {
    const Box = createContractComponent({
      tag: 'div',
      enforcement: { diagnostics: silentDiagnostics },
    })
    const html = renderContractToString(Box, {}, '<span>hello</span>')
    expect(html).toContain('<span>hello</span>')
  })

  it('throws if component was not created by createContractComponent', () => {
    expect(() =>
      renderContractToString(class {} as unknown as ReturnType<typeof createContractComponent>),
    ).toThrow('[renderContractToString]')
  })

  it('escapes double quotes in attribute values', () => {
    const Box = createContractComponent({
      tag: 'div',
      enforcement: { diagnostics: silentDiagnostics },
    })
    const html = renderContractToString(Box, { 'aria-label': 'Say "hello"' })
    expect(html).toContain('&quot;hello&quot;')
    expect(html).not.toContain('"hello"')
  })

  it('omits class attribute when no classes resolve', () => {
    const Box = createContractComponent({
      tag: 'div',
      enforcement: { diagnostics: silentDiagnostics },
    })
    const html = renderContractToString(Box)
    expect(html).not.toContain('class=')
  })

  it('accepts HTML-native class prop as well as className', () => {
    const Box = createContractComponent({
      tag: 'div',
      styling: { base: 'base' },
      enforcement: { diagnostics: silentDiagnostics },
    })
    expect(renderContractToString(Box, { class: 'extra' })).toContain('extra')
    expect(renderContractToString(Box, { className: 'extra' })).toContain('extra')
  })
})

// ─── DOM/SSR parity — `as` ─────────────────────────────────────────────────────
//
// The regression this closes: `renderContractToString(Box, { as: 'section' })` used to emit
// `<section>`, a tag that varied per call for no reason the client ever honored (the live client is
// always `<praxis-box>`-shaped, never structurally an anchor/section/whatever `as` named). These pin
// the fix at the one seam this output is actually generated from — `renderContractToString`'s own
// `props` argument — so a future change can't quietly reintroduce that instability. This is
// separate from, and doesn't resolve, the base "options.tag vs. the registered custom-element tag"
// difference documented at the top of this file — that one is constant across every call, by
// design, not a regression to guard against.

describe('renderContractToString — `as` has no effect', () => {
  it('ignores `as` entirely — output is identical with and without it', () => {
    const Box = createContractComponent({
      tag: 'div',
      styling: { base: 'base' },
      enforcement: { diagnostics: silentDiagnostics },
    })
    const withoutAs = renderContractToString(Box, { 'aria-label': 'x' })
    const withAs = renderContractToString(Box, { 'aria-label': 'x', as: 'section' })
    expect(withAs).toBe(withoutAs)
    expect(withAs).not.toContain('<section')
  })

  it('still renders options.tag regardless of an unsupported-looking `as` value', () => {
    const Nav = createContractComponent({
      tag: 'nav',
      enforcement: { diagnostics: silentDiagnostics },
    })
    const html = renderContractToString(Nav, { as: 'not-a-real-tag' })
    expect(html).toMatch(/^<nav[\s>]/)
  })
})
