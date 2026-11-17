import { describe, expect, it, vi } from 'vitest';

vi.unmock('./Time.css');
vi.unmock('./styles.css');

type CssRule = { selector: string; rule?: { selectors?: Record<string, unknown> } };

describe('the reply time styles', () => {
  it('unfold the folded parts while the message row has the keyboard focus', async () => {
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
      const { Fold, FoldText, ReplyTime } = await import('./Time.css');
      const { MessageBase } = await import('./styles.css');
      const selectorsOf = (className: string) =>
        Object.keys(rules.find((css) => css.selector === className)?.rule?.selectors ?? {});
      [Fold, FoldText].forEach((className) => {
        const selectors = selectorsOf(className).join(', ');
        expect(selectors).toContain(`${MessageBase}:focus-visible &`);
        expect(selectors).not.toContain(`${ReplyTime}:focus-visible`);
      });
    } finally {
      adapter.removeAdapter();
    }
  });
});
