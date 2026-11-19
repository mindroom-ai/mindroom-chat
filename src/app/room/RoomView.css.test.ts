import { describe, expect, it, vi } from 'vitest';

vi.unmock('../ui/styles/RoomOverlay.css');

type CssRule = { selector: string; rule?: { position?: unknown; insetInline?: unknown } };

describe('the dock styles', () => {
  it('let listed jobs span the line, beside a typing strip that holds the keyboard', async () => {
    vi.resetModules();
    const adapter = await import('@vanilla-extract/css/adapter');
    const rules: CssRule[] = [];
    adapter.setAdapter({
      appendCss: (css) => rules.push(css as CssRule),
      registerClassName: () => undefined,
      registerComposition: () => undefined,
      markCompositionUsed: () => undefined,
      onEndFileScope: () => undefined,
      getIdentOption: () => 'debug',
    });
    try {
      await import('./RoomView.css');
      const { Bar, Listed } = await import('../background-jobs/BackgroundJobsBar.css');
      const { TypingStrip } = await import('../timeline/typing/RoomViewTyping.css');
      const { DockBars } = await import('../ui/styles/RoomOverlay.css');
      const position = (selector: string) => rules.find((css) => css.selector === selector)?.rule;
      // Over the strip, which keeps its place in the line.
      expect(position(`${Listed} > ${Bar}`)).toEqual({
        position: 'absolute',
        insetInline: 0,
        zIndex: 1,
      });
      // Beside it while it holds the keyboard, so its focused button is not covered.
      expect(
        position(`${DockBars}:has(> ${TypingStrip}:focus-within) > ${Listed} > ${Bar}`)
      ).toEqual({ position: 'relative' });
    } finally {
      adapter.removeAdapter();
    }
  });
});
