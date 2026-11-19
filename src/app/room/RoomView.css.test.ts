import { describe, expect, it, vi } from 'vitest';

vi.unmock('../ui/styles/RoomOverlay.css');

type CssRule = { selector: string; rule?: { display?: unknown } };

describe('the dock styles', () => {
  it('hide the typing strip while the background jobs are listed', async () => {
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
      const { Anchor } = await import('../background-jobs/BackgroundJobsBar.css');
      const { TypingStrip } = await import('../timeline/typing/RoomViewTyping.css');
      const { DockBars } = await import('../ui/styles/RoomOverlay.css');
      const hidden = rules.filter((css) => css.rule?.display === 'none').map((css) => css.selector);
      expect(hidden).toContain(`${DockBars}:has(> ${Anchor}[data-takes-line]) > ${TypingStrip}`);
    } finally {
      adapter.removeAdapter();
    }
  });
});
