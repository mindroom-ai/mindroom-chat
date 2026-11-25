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

describe('the dock styles', () => {
  it('let listed jobs span the line, beside a typing strip that holds the keyboard', async () => {
    await withCssRules(async (rules) => {
      await import('./RoomView.css');
      const { Bar, Listed } = await import('../background-jobs/BackgroundJobsBar.css');
      const { TypingStrip } = await import('../timeline/typing/RoomViewTyping.css');
      const { DockBars } = await import('../ui/styles/RoomOverlay.css');
      const ruleFor = (selector: string) => rules.find((css) => css.selector === selector)?.rule;
      // Over the strip, which keeps its place in the line.
      expect(ruleFor(`${Listed} > ${Bar}`)).toEqual({
        position: 'absolute',
        insetInline: 0,
        zIndex: 1,
      });
      // Beside it while it holds the keyboard, so its focused button is not covered.
      expect(
        ruleFor(`${DockBars}:has(> ${TypingStrip}:focus-within) > ${Listed} > ${Bar}`)
      ).toEqual({ position: 'relative' });
    });
  });

  it('share the dock row beside Jump to Latest and lift it over full-width bars', async () => {
    await withCssRules(async (rules) => {
      const { config } = await import('folds');
      const { RoomArea } = await import('./RoomView.css');
      const { Following } = await import('../timeline/RoomViewFollowing.css');
      const { DockBars, DockRow, composerInset, footerInset, jumpLane } =
        await import('../ui/styles/RoomOverlay.css');
      const { narrowRoomArea } = await import('../ui/styles/roomArea.css');
      const ruleFor = (selector: string) => rules.find((css) => css.selector === selector)?.rule;

      expect(composerInset).toBe('var(--room-composer-height, 0px)');

      const sharedDock = `${RoomArea}:has([data-jump-to-latest]):not(:has([data-jobs-bar], [data-approvals-bar]))`;
      expect(ruleFor(`${sharedDock} ${DockRow}`)).toEqual({
        vars: { [jumpLane]: '11rem' },
        display: 'grid',
        gridTemplateColumns: `minmax(0, 1fr) ${jumpLane} minmax(0, 1fr)`,
        alignItems: 'end',
        columnGap: config.space.S300,
        '@container': { [narrowRoomArea]: { vars: { [jumpLane]: '2.75rem' } } },
      });
      expect(ruleFor(`${sharedDock} ${DockBars}`)).toEqual({
        gridColumn: '1',
        minWidth: 0,
      });
      expect(ruleFor(`${sharedDock} ${Following}`)).toEqual({
        gridColumn: '3',
        justifySelf: 'end',
        maxInlineSize: '100%',
        marginInlineStart: 0,
      });

      const blockedDock = `${RoomArea}:has([data-jobs-bar], [data-approvals-bar])`;
      expect(ruleFor(`${blockedDock} [data-jump-to-latest]`)).toEqual({
        bottom: `calc(${footerInset} + ${config.space.S400})`,
        maxWidth: `calc(100% - ${config.space.S400} * 2)`,
      });
    });
  });
});
