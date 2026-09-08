import { describe, it, expect } from 'vitest'
import type { AnyRecord } from '@praxis-kit/core'
import type { ConformanceComponent, ConformanceFactoryOptions } from '../types'
import { silentDiagnostics } from '@praxis-kit/diagnostics'

/**
 * Adapter contract for the SSR conformance suite.
 *
 * Implement in a `// @vitest-environment node` test file — SSR must not
 * access browser globals (window, document, etc.).
 *
 * C is the framework's component type. renderToString may return a string
 * synchronously or a Promise<string> for async renderers (e.g. Vue).
 */
export type SsrConformanceAdapter<C extends ConformanceComponent = ConformanceComponent> = {
  createComponent(options: ConformanceFactoryOptions): C
  renderToString(component: C, props?: AnyRecord): string | Promise<string>
  /**
   * Declare which optional behavioral contracts this adapter's SSR path satisfies. Mirrors
   * `ConformanceAdapter.capabilities` (`./conformance.ts`) — kept as its own, narrower field here
   * rather than sharing that type directly, since the DOM suite's `asChild`/`domPropFiltering`
   * capabilities have no SSR-path equivalent to gate.
   */
  capabilities?: {
    /**
     * false for adapters where the rendered element tag is fixed at registration time (e.g. Lit/
     * Web custom elements) — the same constraint `ConformanceAdapter.capabilities.tagPolymorphism`
     * documents for the DOM suite, but SSR has no live element to constrain it the way the DOM
     * path does: without this gate, an SSR-only adapter could render whatever tag `as` names as a
     * literal string wrapper even though the real component can never structurally become that
     * tag, producing markup the live client would never itself produce. Skips the SSR test
     * asserting `as` changes the rendered tag.
     */
    tagPolymorphism?: boolean
  }
}

/**
 * SSR conformance suite. Verifies that components render correctly to HTML
 * strings without accessing browser globals.
 *
 * Run in a `// @vitest-environment node` test file.
 */
export function ssrConformanceSuite<C extends ConformanceComponent = ConformanceComponent>(
  adapter: SsrConformanceAdapter<C>,
): void {
  const caps = { tagPolymorphism: true, ...adapter.capabilities }

  // ── basic rendering ─────────────────────────────────────────────────────────

  describe('ssr — basic rendering', () => {
    it('renders without accessing browser globals', async () => {
      const Box = adapter.createComponent({ enforcement: { diagnostics: silentDiagnostics } })
      const result = adapter.renderToString(Box)
      // Works for both sync (string) and async (Promise<string>) renderers.
      await expect(Promise.resolve(result)).resolves.not.toThrow()
    })

    it('renders default tag (div) to HTML', async () => {
      const Box = adapter.createComponent({ enforcement: { diagnostics: silentDiagnostics } })
      const html = await adapter.renderToString(Box)
      expect(html).toMatch(/<div[\s>]/)
    })

    it('respects a custom tag option', async () => {
      const Nav = adapter.createComponent({
        tag: 'nav',
        enforcement: { diagnostics: silentDiagnostics },
      })
      const html = await adapter.renderToString(Nav)
      expect(html).toMatch(/<nav[\s>]/)
    })

    if (caps.tagPolymorphism)
      it('as prop overrides the default tag', async () => {
        const Box = adapter.createComponent({ enforcement: { diagnostics: silentDiagnostics } })
        const html = await adapter.renderToString(Box, { as: 'section' })
        expect(html).toMatch(/<section[\s>]/)
        expect(html).not.toMatch(/<div[\s>]/)
      })
  })

  // ── class output ─────────────────────────────────────────────────────────────

  describe('ssr — class output', () => {
    it('applies base class', async () => {
      const Box = adapter.createComponent({
        styling: { base: 'box-base' },
        enforcement: { diagnostics: silentDiagnostics },
      })
      const html = await adapter.renderToString(Box)
      expect(html).toContain('box-base')
    })

    it('applies variant class from default', async () => {
      const Box = adapter.createComponent({
        styling: {
          variants: { size: { sm: 'text-sm', lg: 'text-lg' } },
          defaults: { size: 'lg' },
        },
        enforcement: { diagnostics: silentDiagnostics },
      })
      const html = await adapter.renderToString(Box)
      expect(html).toContain('text-lg')
    })

    it('applies variant class from prop', async () => {
      const Box = adapter.createComponent({
        styling: { variants: { size: { sm: 'text-sm', lg: 'text-lg' } } },
        enforcement: { diagnostics: silentDiagnostics },
      })
      const html = await adapter.renderToString(Box, { size: 'sm' })
      expect(html).toContain('text-sm')
    })

    it('merges caller class with base', async () => {
      const Box = adapter.createComponent({
        styling: { base: 'base' },
        enforcement: { diagnostics: silentDiagnostics },
      })
      const html = await adapter.renderToString(Box, { class: 'extra' })
      expect(html).toContain('base')
      expect(html).toContain('extra')
    })

    it('applies compound variant class', async () => {
      const Box = adapter.createComponent({
        styling: {
          base: 'btn',
          variants: {
            size: { sm: 'btn-sm', lg: 'btn-lg' },
            intent: { primary: 'btn-primary', ghost: 'btn-ghost' },
          },
          compounds: [{ size: 'lg', intent: 'ghost', class: 'btn-lg-ghost' }],
        },
        enforcement: { diagnostics: silentDiagnostics },
      })
      const html = await adapter.renderToString(Box, { size: 'lg', intent: 'ghost' })
      const classAttr = html.match(/class="([^"]*)"/)?.[1] ?? ''
      expect(classAttr.split(' ')).toContain('btn-lg-ghost')
    })
  })

  // ── prop forwarding ───────────────────────────────────────────────────────────

  describe('ssr — prop forwarding', () => {
    it('forwards data attributes', async () => {
      const Box = adapter.createComponent({ enforcement: { diagnostics: silentDiagnostics } })
      const html = await adapter.renderToString(Box, { 'data-testid': 'box' })
      expect(html).toContain('data-testid="box"')
    })

    it('forwards aria-label', async () => {
      const Box = adapter.createComponent({ enforcement: { diagnostics: silentDiagnostics } })
      const html = await adapter.renderToString(Box, { 'aria-label': 'Close' })
      expect(html).toContain('aria-label="Close"')
    })
  })

  // ── boolean attributes ────────────────────────────────────────────────────────

  describe('ssr — boolean attributes', () => {
    it('renders disabled on a button element', async () => {
      const Button = adapter.createComponent({
        tag: 'button',
        enforcement: { diagnostics: silentDiagnostics },
      })
      const html = await adapter.renderToString(Button, { disabled: true })
      expect(html).toMatch(/disabled/)
    })

    it('renders hidden attribute', async () => {
      const Box = adapter.createComponent({ enforcement: { diagnostics: silentDiagnostics } })
      const html = await adapter.renderToString(Box, { hidden: true })
      expect(html).toMatch(/hidden/)
    })
  })

  // ── attribute escaping ────────────────────────────────────────────────────────

  describe('ssr — attribute escaping', () => {
    it('escapes double quotes in aria-label', async () => {
      const Box = adapter.createComponent({ enforcement: { diagnostics: silentDiagnostics } })
      const html = await adapter.renderToString(Box, { 'aria-label': 'Hello "world"' })
      expect(html).not.toContain('aria-label="Hello "world""')
      expect(html).toMatch(/aria-label=/)
    })

    it('does not produce a bare script element from a data attribute value', async () => {
      const Box = adapter.createComponent({ enforcement: { diagnostics: silentDiagnostics } })
      const html = await adapter.renderToString(Box, { 'data-value': '<b>text</b>' })
      // The value must be inside the attribute — not injected as free HTML content.
      expect(html).toContain('data-value=')
      expect(html).not.toMatch(/<b>text<\/b>(?=[^"]|$)/)
    })
  })

  // ── ARIA normalisation ────────────────────────────────────────────────────────

  describe('ssr — ARIA normalisation', () => {
    it('strips redundant role (nav has implicit role=navigation)', async () => {
      const Nav = adapter.createComponent({
        tag: 'nav',
        enforcement: { diagnostics: silentDiagnostics },
      })
      const html = await adapter.renderToString(Nav, { role: 'navigation' })
      expect(html).toContain('<nav')
      expect(html).not.toContain('role=')
    })

    it('forwards non-redundant role', async () => {
      const Box = adapter.createComponent({ enforcement: { diagnostics: silentDiagnostics } })
      const html = await adapter.renderToString(Box, { role: 'dialog' })
      expect(html).toContain('role="dialog"')
    })
  })

  // ── prop normalization ordering ──────────────────────────────────────────────

  describe('ssr — prop normalization ordering', () => {
    it("a normalize option observes the HTML built-in normalizers' output", async () => {
      // `disabledProps` sets aria-disabled="true" on a disabled <button>. The
      // caller's `normalize` must run after the HTML built-ins so it can see
      // that value — the same ordering the DOM render paths use.
      const Button = adapter.createComponent({
        tag: 'button',
        enforcement: { diagnostics: silentDiagnostics },
        normalize: (props: AnyRecord) =>
          props['aria-disabled'] === 'true' ? { ...props, 'data-observed-aria': 'yes' } : props,
      })
      const html = await adapter.renderToString(Button, { disabled: true })
      expect(html).toContain('data-observed-aria="yes"')
    })
  })
}
