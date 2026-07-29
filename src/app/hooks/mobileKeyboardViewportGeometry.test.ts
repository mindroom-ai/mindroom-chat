// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../pages/App';

/**
 * CINNY-132 consumer lock.
 *
 * The publisher half (`useMobileKeyboardViewportFix.test.ts`) proves the hook
 * reads `visualViewport.offsetTop` on a scroll. This file proves the other
 * half: that the real `App` mounts that publisher, and that the real
 * `src/index.css` turns its output into a shell and a portal host that both sit
 * exactly inside the visible window.
 *
 * Deliberately a scroll-only pan. iOS fires no `resize` when WebKit pans the
 * visual viewport over an unchanged layout viewport, so a test that dispatches
 * `resize` would pass against the pre-fix code.
 *
 * jsdom limits, stated plainly rather than worked around:
 *   - `getBoundingClientRect()` is always zero — jsdom does no layout.
 *   - `getComputedStyle().top` is `''` when the declared value is a `var()`
 *     reference — jsdom does not substitute custom properties.
 * So `readBox` below resolves the box itself. What is still real: the
 * stylesheet is the shipped file parsed into CSSOM, the rules are selected by
 * real selector matching against real elements, and the custom property values
 * are whatever the real hook actually wrote to `documentElement`. What is
 * modelled rather than measured: `var()` substitution, `dvh`, and the fact that
 * a `position: fixed` box with `top` and `height` occupies `[top, top+height]`.
 * Painting, stacking, and pointer geometry are out of reach here; the
 * `e2e/cinny132-keyboard-viewport.spec.ts` companion measures those in Chromium.
 */

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'web'),
    isNativePlatform: vi.fn(() => false),
    isPluginAvailable: vi.fn(() => false),
  },
}));

vi.mock('@capacitor/keyboard', () => ({
  Keyboard: { addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })) },
}));

// App's own body — including the `useMobileKeyboardViewportFix()` call this
// file exists to lock — stays real. Only the subtrees that would drag in the
// router graph, network calls, or vanilla-extract stylesheets are replaced.
vi.mock('../components/ClientConfigLoader', () => ({ ClientConfigLoader: () => null }));
vi.mock('../components/ReactQueryDevtoolsToggle', () => ({
  ReactQueryDevtoolsToggle: () => null,
}));
vi.mock('../components/particle-background', () => ({
  PersistentParticleBackgroundProvider: ({ children }: { children?: React.ReactNode }) =>
    children ?? null,
}));
vi.mock('../pages/ConfigConfig', () => ({
  ConfigConfigLoading: () => null,
  ConfigConfigError: () => null,
}));
vi.mock('../pages/FeatureCheck', () => ({
  FeatureCheck: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
vi.mock('../pages/Router', () => ({ createRouter: vi.fn(() => ({})) }));

const IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';

/** iPhone-ish layout viewport. iOS never shrinks this for the keyboard. */
const LAYOUT_VIEWPORT_HEIGHT = 793;
/** What is left on screen once the keyboard is up. */
const KEYBOARD_VISUAL_HEIGHT = 457;
/** How far WebKit panned the visual viewport down to reveal the composer. */
const KEYBOARD_PAN_OFFSET = 170;

// Read from the vitest root rather than `import.meta.url`: under the jsdom
// environment the test module can be served over http, and `?raw` imports come
// back empty because vitest disables CSS processing.
const INDEX_CSS = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

type ViewportDom = {
  setVisualViewport: (height: number, offsetTop: number) => void;
  emitVisualViewportScroll: () => void;
  emitVisualViewportResize: () => void;
};

const installViewportDom = (): ViewportDom => {
  document.head.innerHTML = `<style>${INDEX_CSS}</style>`;
  document.body.innerHTML = '<div id="root"></div><div id="portalContainer"></div>';

  let visualViewportHeight = LAYOUT_VIEWPORT_HEIGHT;
  let visualViewportOffsetTop = 0;
  const events = new EventTarget();

  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      get height() {
        return visualViewportHeight;
      },
      get offsetTop() {
        return visualViewportOffsetTop;
      },
    },
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: LAYOUT_VIEWPORT_HEIGHT,
  });
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: IOS_USER_AGENT,
  });

  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      unobserve() {}

      disconnect() {}
    }
  );

  let rafId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    rafId += 1;
    queueMicrotask(() => callback(0));
    return rafId;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);

  return {
    setVisualViewport: (height, offsetTop) => {
      visualViewportHeight = height;
      visualViewportOffsetTop = offsetTop;
    },
    emitVisualViewportScroll: () => events.dispatchEvent(new Event('scroll')),
    emitVisualViewportResize: () => events.dispatchEvent(new Event('resize')),
  };
};

const GEOMETRY_PROPERTIES = ['position', 'top', 'height'] as const;

/** Walk the parsed stylesheet and keep the last declaration that matches. */
const collectDeclarations = (element: Element): Map<string, string> => {
  const declarations = new Map<string, string>();

  const visit = (rules: CSSRuleList) => {
    Array.from(rules).forEach((rule) => {
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested) {
        visit(nested);
        return;
      }

      const { selectorText, style } = rule as CSSStyleRule;
      if (!selectorText) return;
      try {
        if (!element.matches(selectorText)) return;
      } catch {
        // A selector jsdom cannot parse cannot have matched in this test's
        // favour either; skipping it can only lose declarations, never invent
        // them, so the assertions still fail loudly if it mattered.
        return;
      }

      GEOMETRY_PROPERTIES.forEach((property) => {
        const value = style.getPropertyValue(property);
        if (value) declarations.set(property, value);
      });
    });
  };

  Array.from(document.styleSheets).forEach((sheet) => visit(sheet.cssRules));
  return declarations;
};

const resolveLength = (value: string): number => {
  const trimmed = value.trim();

  const reference = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]*))?\)$/i.exec(trimmed);
  if (reference) {
    const published = document.documentElement.style.getPropertyValue(reference[1]).trim();
    return resolveLength(published || reference[2] || '0px');
  }

  if (trimmed === '' || trimmed === 'auto') return 0;
  // On iOS `dvh` is the layout viewport — that is the whole bug.
  if (trimmed.endsWith('dvh')) return (Number.parseFloat(trimmed) / 100) * LAYOUT_VIEWPORT_HEIGHT;
  if (trimmed.endsWith('px')) return Number.parseFloat(trimmed);

  throw new Error(`Unsupported CSS length for viewport geometry: ${value}`);
};

type ResolvedBox = { position: string; top: number; height: number };

const readBox = (selector: string): ResolvedBox => {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`No element matched ${selector}`);

  const declarations = collectDeclarations(element);
  return {
    position: declarations.get('position') ?? 'static',
    top: resolveLength(declarations.get('top') ?? 'auto'),
    height: resolveLength(declarations.get('height') ?? 'auto'),
  };
};

describe('mobile keyboard viewport geometry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('style');
  });

  it('keeps the shell and the portal host inside the visible window after a scroll-only pan', async () => {
    const viewportDom = installViewportDom();

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(App));
    });

    viewportDom.setVisualViewport(KEYBOARD_VISUAL_HEIGHT, KEYBOARD_PAN_OFFSET);
    await act(async () => {
      viewportDom.emitVisualViewportScroll();
    });

    const visibleBottom = KEYBOARD_PAN_OFFSET + KEYBOARD_VISUAL_HEIGHT;
    // Guard the premise: the layout viewport really is taller than the screen.
    expect(visibleBottom).toBeLessThan(LAYOUT_VIEWPORT_HEIGHT);

    const expectedBox: ResolvedBox = {
      position: 'fixed',
      top: KEYBOARD_PAN_OFFSET,
      height: KEYBOARD_VISUAL_HEIGHT,
    };
    const rootBox = readBox('#root');
    const portalBox = readBox('#portalContainer');

    expect(rootBox).toEqual(expectedBox);
    expect(portalBox).toEqual(expectedBox);
    // Neither host may extend past the keyboard, in either direction.
    expect(rootBox.top + rootBox.height).toBe(visibleBottom);
    expect(portalBox.top + portalBox.height).toBe(visibleBottom);

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('reproduces the pre-fix box on native iOS, where the WebView resizes instead of panning', async () => {
    const viewportDom = installViewportDom();

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(App));
    });

    // Capacitor sets `Keyboard.resize: 'native'`, so the visual viewport equals
    // the layout viewport and there is no pan to follow.
    viewportDom.setVisualViewport(LAYOUT_VIEWPORT_HEIGHT, 0);
    await act(async () => {
      viewportDom.emitVisualViewportResize();
    });

    // The hook runs on native iOS too, so these are published pixel values
    // rather than the CSS fallbacks — the identity is arithmetic, not absence.
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe(
      `${LAYOUT_VIEWPORT_HEIGHT}px`
    );
    expect(document.documentElement.style.getPropertyValue('--app-viewport-offset-top')).toBe(
      '0px'
    );

    const preFixBox = { top: 0, height: LAYOUT_VIEWPORT_HEIGHT };
    expect(readBox('#root')).toMatchObject(preFixBox);
    expect(readBox('#portalContainer')).toMatchObject(preFixBox);

    await act(async () => {
      renderer?.unmount();
    });
  });
});
