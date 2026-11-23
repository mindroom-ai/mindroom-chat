import { describe, expect, it, vi } from 'vitest';

vi.unmock('./EventSourceViewer.css');

type StyleRule = Record<string, unknown> & { selectors?: Record<string, Record<string, unknown>> };
type CssRule = { selector: string; rule?: StyleRule };

describe('the event source viewer styles', () => {
  it('keep a pressed toggle highlighted under the pointer and technical values left to right', async () => {
    vi.resetModules();
    const adapter = await import('@vanilla-extract/css/adapter');
    const appended: unknown[] = [];
    const rules = appended as CssRule[];
    adapter.setAdapter({
      appendCss: (css) => appended.push(css),
      registerClassName: () => undefined,
      registerComposition: () => undefined,
      markCompositionUsed: () => undefined,
      onEndFileScope: () => undefined,
      getIdentOption: () => 'debug',
    });
    try {
      const { MetaChipValue, MetaChipValueTechnical, ToolbarButton } = await import(
        './EventSourceViewer.css'
      );
      const { color } = await import('folds');
      const ruleOf = (className: string) => rules.find((css) => css.selector === className)?.rule;

      // The plain hover outweighs the pressed state alone, so the pressed hover names both.
      const toolbarSelectors = ruleOf(ToolbarButton)?.selectors ?? {};
      expect(toolbarSelectors['&:hover:not(:disabled)']).toEqual({
        backgroundColor: color.SurfaceVariant.ContainerHover,
      });
      expect(toolbarSelectors['&[aria-pressed="true"]']?.backgroundColor).toBe(
        color.Primary.Container
      );
      expect(toolbarSelectors['&[aria-pressed="true"]:hover:not(:disabled)']).toEqual({
        backgroundColor: color.Primary.ContainerHover,
      });

      // An event ID, type or sender is isolated left to right; the plain value, which the
      // localized time uses, sets no direction.
      expect(ruleOf(MetaChipValueTechnical)).toEqual({ direction: 'ltr', unicodeBidi: 'isolate' });
      expect(ruleOf(MetaChipValue)).not.toHaveProperty('direction');
      expect(ruleOf(MetaChipValue)).not.toHaveProperty('unicodeBidi');
    } finally {
      adapter.removeAdapter();
    }
  });
});
