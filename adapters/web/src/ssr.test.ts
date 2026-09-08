// @vitest-environment node
//
// Web SSR — serializes the resolved Praxis contract to an HTML string, without any DOM globals.
// Not Custom Element SSR: the output tag is always options.tag, never the registered
// custom-element tag — see renderContractToString's own doc comment for the full reasoning, and
// createContractComponent's for the "model vs. host" distinction this follows from. This output
// isn't meant to be handed to the browser expecting the live custom element to take over it —
// there's no tag-name match for the platform's Custom Element upgrade mechanism to act on.
//
// The rendered tag always comes from options.tag, never from an `as` prop — this adapter has no
// tag polymorphism at all, on the DOM path or this SSR path. See createContractComponent's own
// doc comment for why: an earlier design honored `as` here (in this adapter and Lit's), making
// this output disagree even with itself across calls to the same component.

import { describe, it, expect } from 'vitest'
import { ssrConformanceSuite } from '@praxis-kit/adapter-utils/testing'
import type { BareFactoryOptions } from '@praxis-kit/adapter-utils/testing'
import { silentDiagnostics } from '@praxis-kit/diagnostics'
import { createContractComponent } from './create-contract-component'
import { renderContractToString } from './render-to-string'

ssrConformanceSuite({
  createComponent: (options) =>
    createContractComponent(options as unknown as BareFactoryOptions) as ReturnType<
      typeof createContractComponent
    > & { displayName?: string },

  renderToString: (component, props = {}) => renderContractToString(component, props),

  capabilities: { tagPolymorphism: false },
})

describe('renderContractToString — web-specific', () => {
  it('renders opening and closing tags for empty elements', () => {
    const Box = createContractComponent({
      tag: 'div',
      enforcement: { diagnostics: silentDiagnostics },
    })
    expect(renderContractToString(Box)).toBe('<div></div>')
  })

  it('includes innerHTML in output verbatim', () => {
    const Box = createContractComponent({
      tag: 'div',
      enforcement: { diagnostics: silentDiagnostics },
    })
    expect(renderContractToString(Box, {}, '<span>hi</span>')).toContain('<span>hi</span>')
  })

  it('throws with component name for unregistered component', () => {
    expect(() =>
      renderContractToString(class {} as unknown as ReturnType<typeof createContractComponent>),
    ).toThrow('[renderContractToString]')
  })

  it('omits class attribute when no classes resolve', () => {
    const Box = createContractComponent({
      tag: 'div',
      enforcement: { diagnostics: silentDiagnostics },
    })
    expect(renderContractToString(Box)).not.toContain('class=')
  })

  it('renders resolved base class', () => {
    const Box = createContractComponent({
      tag: 'div',
      styling: { base: 'box' },
      enforcement: { diagnostics: silentDiagnostics },
    })
    expect(renderContractToString(Box)).toContain('class="box"')
  })

  it('renders resolved variant class', () => {
    const Box = createContractComponent({
      tag: 'div',
      styling: { variants: { size: { sm: 'text-sm', lg: 'text-lg' } } },
      enforcement: { diagnostics: silentDiagnostics },
    })
    expect(renderContractToString(Box, { size: 'lg' })).toContain('text-lg')
  })

  it('forwards data attributes', () => {
    const Box = createContractComponent({
      tag: 'div',
      enforcement: { diagnostics: silentDiagnostics },
    })
    expect(renderContractToString(Box, { 'data-test': 'bar', id: 'foo' })).toContain(
      'data-test="bar"',
    )
  })

  it('escapes double quotes in attribute values', () => {
    const Box = createContractComponent({
      tag: 'div',
      enforcement: { diagnostics: silentDiagnostics },
    })
    const html = renderContractToString(Box, { title: '"quoted"' })
    expect(html).toContain('&quot;quoted&quot;')
  })

  it('escapes < in attribute values but passes innerHTML through verbatim', () => {
    const Box = createContractComponent({
      tag: 'div',
      enforcement: { diagnostics: silentDiagnostics },
    })
    const html = renderContractToString(Box, { title: '<script>' }, '<em>safe</em>')
    // < is escaped in attributes; > doesn't need escaping in attribute values
    expect(html).toContain('&lt;script')
    // innerHTML is raw — callers are responsible for sanitizing untrusted content
    expect(html).toContain('<em>safe</em>')
  })
})

// ─── DOM/SSR parity — `as` ─────────────────────────────────────────────────────

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
