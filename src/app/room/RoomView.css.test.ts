import { describe, expect, it, vi } from 'vitest';

vi.unmock('../ui/styles/RoomOverlay.css');
vi.unmock('../messages/canvas/canvasHost.css');

type CssRule = {
  selector: string;
  rule?: {
    position?: unknown;
    insetInline?: unknown;
    bottom?: unknown;
    '@container'?: Record<string, { vars?: Record<string, unknown> }>;
  };
};

const withCssRules = async (run: (rules: CssRule[]) => Promise<void>) => {
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
    await run(rules);
  } finally {
    adapter.removeAdapter();
  }
};

describe('the dock styles', () => {
  it('let listed jobs span the line, beside a typing strip that holds the keyboard', async () => {
    await withCssRules(async (rules) => {
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
    });
  });

  it('reserve one dock row for Jump to Latest, drop it in short areas, and place StickyAnswer above it', async () => {
    await withCssRules(async (rules) => {
      const { fallbackVar } = await import('@vanilla-extract/css');
      const { config, toRem } = await import('folds');
      const { composerInset, dockRowHeight, dockRowReserve, footerInset, jumpToLatestBottom } =
        await import('../ui/styles/RoomOverlay.css');
      const { shortRoomArea } = await import('../ui/styles/roomArea.css');
      const { TimelineArea } = await import('./RoomView.css');
      const { StickyAnswer } = await import('../messages/canvas/canvasHost.css');
      expect(composerInset).toBe('var(--room-composer-height, 0px)');
      expect(dockRowHeight).toBe(`calc(${toRem(32)} + ${config.space.S200})`);
      expect(jumpToLatestBottom).toBe(
        `calc(max(${footerInset}, ${composerInset} + ${fallbackVar(
          dockRowReserve,
          dockRowHeight
        )}) + ${config.space.S400})`
      );
      expect(rules.find((css) => css.selector === TimelineArea)?.rule?.['@container']).toEqual({
        [shortRoomArea]: { vars: { [dockRowReserve]: '0px' } },
      });
      expect(rules.find((css) => css.selector === StickyAnswer)?.rule?.bottom).toBe(
        `calc(${jumpToLatestBottom} + 44px + ${config.space.S200})`
      );
    });
  });
});
