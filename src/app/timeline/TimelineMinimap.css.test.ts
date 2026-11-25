import { describe, expect, it, vi } from 'vitest';

vi.unmock('../ui/styles/RoomOverlay.css');

type CssRule = {
  selector: string;
  rule?: Record<string, unknown>;
};

const withCssRules = async (run: (rules: CssRule[]) => Promise<void>) => {
  vi.resetModules();
  const adapter = await import('@vanilla-extract/css/adapter');
  const rules: CssRule[] = [];
  adapter.setAdapter({
    appendCss: (css) => rules.push(css as unknown as CssRule),
    registerClassName: () => undefined,
    registerComposition: () => undefined,
    markCompositionUsed: () => undefined,
    onEndFileScope: () => undefined,
    getIdentOption: () => 'debug',
  });
  try {
    await run(rules);
  } finally {
    adapter.removeAdapter();
  }
};

describe('the timeline minimap styles', () => {
  it('anchor the minimap bottom above the composer rather than the transient dock', async () => {
    await withCssRules(async (rules) => {
      const { MinimapContainer } = await import('./TimelineMinimap.css');
      const { controlsTopInset, footerInset } = await import('../ui/styles/RoomOverlay.css');
      const containerRule = rules.find((css) => css.selector === MinimapContainer)?.rule;

      expect(containerRule).toBeDefined();
      expect(containerRule?.top).toBe(controlsTopInset);
      expect(containerRule?.bottom).toBe(`var(--room-composer-height, ${footerInset})`);
      expect(containerRule?.bottom).not.toBe(footerInset);
    });
  });
});
