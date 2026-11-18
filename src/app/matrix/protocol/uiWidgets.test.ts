import { describe, expect, it } from 'vitest';
import fixture from '../../messages/widgets/__fixtures__/ui-widgets-v1.json';
import {
  readUiMarkerId,
  readUiWidgets,
  stripUiFallbackBlocks,
  UI_WIDGETS_KEY,
  type UiWidgetsContent,
} from './uiWidgets';

type RenderCase = { name: string; ui?: UiWidgetsContent | null };
const renders = (fixture.renders as RenderCase[]).filter(
  (c): c is RenderCase & { ui: UiWidgetsContent } => !!c.ui
);

const SECTION_5_4_BODY = [
  'Signups peaked in February.',
  '',
  '```mindroom-ui-df4d729a5d',
  'Signups (line chart, users)',
  '     Signups',
  'Jan      120',
  'Feb    180.5',
  'Mar      150',
  '```',
  '',
  'March is still 25% above January.',
].join('\n');

describe('readUiWidgets', () => {
  it.each(renders.map((c) => [c.name, c] as const))('reads the fixture value: %s', (_n, c) => {
    expect(readUiWidgets({ [UI_WIDGETS_KEY]: c.ui })?.widgets).toEqual(c.ui.widgets);
  });

  it('rejects what the backend never sends', () => {
    const entry = { id: 'df4d729a5d', json: '{}' };
    const big = { id: 'aaaaaaaaaa', json: 'x'.repeat(9000) };
    const bad = [
      undefined,
      { version: 2, widgets: [entry] },
      {
        version: 1,
        widgets: Array.from({ length: 9 }, (_, i) => ({ ...entry, id: `${i}`.repeat(10) })),
      },
      { version: 1, widgets: [entry, entry] },
      { version: 1, widgets: [{ ...entry, id: 'DF4D729A5D' }] },
      { version: 1, widgets: [big, { ...big, id: 'bbbbbbbbbb' }] },
      { version: 1, widgets: [{ id: 'df4d729a5d', json: {} }] },
      { version: 1, widgets: [] },
    ];
    bad.forEach((value) => expect(readUiWidgets({ [UI_WIDGETS_KEY]: value })).toBeUndefined());
  });

  it('counts the byte limit in UTF-8 over all entries', () => {
    const json = (bytes: number) => 'x'.repeat(bytes);
    const fits = [
      { id: 'aaaaaaaaaa', json: json(8192) },
      { id: 'bbbbbbbbbb', json: `${json(8190)}é` },
    ];
    expect(readUiWidgets({ [UI_WIDGETS_KEY]: { version: 1, widgets: fits } })).toBeDefined();
    const over = [fits[0], { id: 'bbbbbbbbbb', json: `${json(8191)}é` }];
    expect(readUiWidgets({ [UI_WIDGETS_KEY]: { version: 1, widgets: over } })).toBeUndefined();
  });
});

describe('readUiMarkerId', () => {
  it('reads the marker id only from the exact class', () => {
    expect(readUiMarkerId('language-mindroom-ui-df4d729a5d')).toBe('df4d729a5d');
    expect(readUiMarkerId('language-mindroom-ui-df4d729a5d extra')).toBeUndefined();
    expect(readUiMarkerId('language-mindroom-ui-df4d729a5')).toBeUndefined();
    expect(readUiMarkerId('language-ui')).toBeUndefined();
    expect(readUiMarkerId(undefined)).toBeUndefined();
  });
});

describe('stripUiFallbackBlocks', () => {
  it('removes the fallback block and keeps the paragraphs around it', () => {
    expect(stripUiFallbackBlocks(SECTION_5_4_BODY)).toBe(
      'Signups peaked in February.\n\n\nMarch is still 25% above January.'
    );
  });

  it('leaves other code blocks alone', () => {
    const body = 'See:\n\n```python\nprint("https://example.com")\n```\n';
    expect(stripUiFallbackBlocks(body)).toBe(body);
  });

  it('leaves a marker line inside another code block alone', () => {
    const body = '~~~md\n```mindroom-ui-df4d729a5d\n~~~\n\nSee https://example.org/a';
    expect(stripUiFallbackBlocks(body)).toBe(body);
  });

  it('closes only on a fence at least as long as the opening one', () => {
    const body = 'A\n````mindroom-ui-df4d729a5d\nx ```\n```\nexample.com\n````\nB';
    expect(stripUiFallbackBlocks(body)).toBe('A\nB');
  });
});
