// @vitest-environment jsdom
//
// Known limitations vs other adapters (documented, not bugs):
//
//   1. Tag rendering: custom elements have a fixed tag set at define()-time, and this adapter has
//      no `as` prop at all (see createContractComponent's doc comment) — `as` is filtered out of
//      the pipeline unconditionally, on both the DOM and SSR paths, rather than left to silently
//      reinterpret ARIA/content-model semantics for a tag the element will never actually be.
//      Tests "renders default tag", "respects a custom tag option", "renders a different tag via
//      as prop", and "switches rendered tag on rerender with a new as prop" will fail.
//
//   2. Variant key stripping: Lit's reactive property system keeps variant
//      attributes on the host as DOM attributes. In React/Vue they never reach
//      the DOM. Tests "strips variant keys before DOM forwarding" and
//      "custom filterProps strips matching keys" will fail.
//
//   3. asChild: disabled via capabilities.asChild: false (Light DOM, no JSX slot).

import {
  conformanceSuite,
  conformancePerformanceSuite,
  conformanceIsolationSuite,
} from '@praxis-kit/adapter-utils/testing'
import type {
  BareFactoryOptions,
  ChildSpec,
  ConformanceAdapter,
  ConformanceFactoryOptions,
} from '@praxis-kit/adapter-utils/testing'
import { createContractComponent } from './create-contract-component'
import type { LitConformanceComponent, LitConformanceEl } from './types/index'
import type { AnyRecord } from '@praxis-kit/core'
import { iterate } from '@praxis-kit/primitive'

// ─── Helpers ─────────────────────────────────────────────────────────────────

let counter = 0
const uniqueTag = () => `praxis-conf-${counter++}`

// React-style event prop → native event name.
const EVENT_MAP: Record<string, string> = {
  onClick: 'click',
  onFocus: 'focus',
  onBlur: 'blur',
  onChange: 'change',
  onInput: 'input',
  onKeyDown: 'keydown',
  onKeyUp: 'keyup',
}

type ListenerMap = Map<string, EventListener>

function applyStyle(el: HTMLElement, nextStyle: AnyRecord, prevStyle: AnyRecord): void {
  // Remove properties present in the previous style but absent in the new one.
  iterate.forEachKey(prevStyle, (prop) => {
    if (!(prop in nextStyle)) el.style.removeProperty(prop)
  })
  iterate.forEachEntry(nextStyle, (prop, value) => {
    el.style.setProperty(prop, String(value))
  })
}

function applyProps(
  el: HTMLElement,
  props: AnyRecord,
  listeners: ListenerMap,
  prevStyle: AnyRecord = {},
): void {
  iterate.forEachEntry(props, (key, value) => {
    const nativeEvent = EVENT_MAP[key]
    if (nativeEvent) {
      // Remove old listener for this event before adding the new one.
      const old = listeners.get(nativeEvent)
      if (old) el.removeEventListener(nativeEvent, old)
      const fn = value as EventListener
      el.addEventListener(nativeEvent, fn)
      listeners.set(nativeEvent, fn)
      return
    }
    if (key === 'className' || key === 'class') {
      el.setAttribute('praxis-class', value as string)
      return
    }
    if (key === 'recipe') {
      el.setAttribute('variant-key', value as string)
      return
    }
    if (key === 'style') {
      applyStyle(
        el,
        typeof value === 'object' && value !== null ? (value as AnyRecord) : {},
        prevStyle,
      )
      return
    }
    if (value === true) {
      el.setAttribute(key, '')
      return
    }
    if (value === false || value === null || value === undefined) {
      el.removeAttribute(key)
      return
    }
    el.setAttribute(key, String(value))
  })
}

function clearStaleProps(
  el: HTMLElement,
  prevProps: AnyRecord,
  nextProps: AnyRecord,
  listeners: ListenerMap,
): void {
  // Remove attributes and event listeners present in prevProps but absent in nextProps.
  iterate.forEachKey(prevProps, (key) => {
    if (key in nextProps) return
    const nativeEvent = EVENT_MAP[key]
    if (nativeEvent) {
      const listener = listeners.get(nativeEvent)
      if (listener) {
        el.removeEventListener(nativeEvent, listener)
        listeners.delete(nativeEvent)
      }
      return
    }
    const attr =
      key === 'recipe'
        ? 'variant-key'
        : key === 'className' || key === 'class'
          ? 'praxis-class'
          : key
    el.removeAttribute(attr)
  })
}

function buildChild(spec: ChildSpec): HTMLElement {
  if ('component' in spec) {
    const comp = spec.component as LitConformanceComponent
    const el = document.createElement(comp.elementName)
    const listeners: ListenerMap = new Map()
    applyProps(el, spec.props ?? {}, listeners)
    iterate.forEach(spec.children ?? [], (c) => el.appendChild(buildChild(c)))
    return el as HTMLElement
  }
  const el = document.createElement(spec.tag)
  const listeners: ListenerMap = new Map()
  applyProps(el, spec.props ?? {}, listeners)
  iterate.forEach(spec.children ?? [], (c) => el.appendChild(buildChild(c)))
  return el as HTMLElement
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

let container: HTMLElement

const adapter: ConformanceAdapter<LitConformanceComponent> = {
  capabilities: { asChild: false, tagPolymorphism: false, domPropFiltering: false },
  testSuites: { ssr: true },

  createComponent(options: ConformanceFactoryOptions): LitConformanceComponent {
    const ElementClass = createContractComponent(options as BareFactoryOptions)
    const elementName = uniqueTag()
    customElements.define(elementName, ElementClass as unknown as CustomElementConstructor)
    return {
      displayName: options.name ?? 'PolymorphicComponent',
      elementName,
    }
  },

  render(component, props = {}, children = []) {
    const el = document.createElement(component.elementName) as unknown as LitConformanceEl
    const elHtml = el as unknown as HTMLElement
    const listeners: ListenerMap = new Map()
    let lastProps = { ...props }

    // Track user-provided children separately so rerender can remove only these
    // and leave Lit's internal template nodes (slot, comment markers) intact.
    const userChildren: Node[] = children.map((c) => buildChild(c))
    iterate.forEach(userChildren, (c) => elHtml.appendChild(c))

    container.appendChild(elHtml)
    applyProps(elHtml, props, listeners)

    // performUpdate() forces Lit's microtask-scheduled update to run synchronously.
    el.performUpdate()

    return {
      get element() {
        return elHtml
      },
      rerender(newProps = {}, newChildren = []) {
        const prevStyle = (lastProps['style'] as AnyRecord | undefined) ?? {}
        clearStaleProps(elHtml, lastProps, newProps, listeners)
        lastProps = { ...newProps }

        // Remove only the user-provided children — Lit's slot and comment
        // marker nodes must remain or ChildPart tracking breaks.
        iterate.forEach(userChildren, (c) => {
          if (c.parentNode) c.parentNode.removeChild(c)
        })
        userChildren.length = 0
        const fresh = newChildren.map((c) => buildChild(c))
        iterate.forEach(fresh, (c) => elHtml.appendChild(c))
        userChildren.push(...fresh)

        applyProps(elHtml, newProps, listeners, prevStyle)
        el.performUpdate()
      },
      unmount() {
        elHtml.remove()
      },
    }
  },

  setup() {
    container = document.createElement('div')
    document.body.appendChild(container)
  },

  cleanup() {
    container?.remove()
  },
}

conformanceSuite(adapter)

conformancePerformanceSuite(adapter)
conformanceIsolationSuite(adapter)
