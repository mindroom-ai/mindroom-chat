import { createEditor, Editor, Text, Transforms, type Descendant } from 'slate';
import { describe, expect, it } from 'vitest';
import { cpuNow } from '../../test/utils/cpuNow';
import { createMarkdownDecorate, MAX_LINE_RANGES, type MarkdownRange } from './markdownDecorations';
import { takeMessageCommand } from './messageCommand';
import { toMatrixCustomHTML } from './output';
import type { InlineContent } from './slate';
import { BlockType } from './types';
import { createLinkElement, createMentionElement, withInlineElements } from './utils';

const paragraph = (...children: InlineContent[]): Descendant => ({
  type: BlockType.Paragraph,
  children: children.length > 0 ? children : [{ text: '' }],
});

const editorWith = (document: Descendant[]): Editor => {
  const editor = withInlineElements(createEditor());
  editor.children = document;
  return editor;
};

/** Each range as `props "covered text"`, the covered text as Slate reads it (atoms add nothing). */
const describeRanges = (editor: Editor, ranges: MarkdownRange[]): string[] =>
  ranges.map((range) => {
    const { anchor: _anchor, focus: _focus, ...leaf } = range;
    return `${Object.keys(leaf).join('+')} ${JSON.stringify(Editor.string(editor, range))}`;
  });

const decorated = (
  document: Descendant[],
  options?: Parameters<typeof createMarkdownDecorate>[0]
): string[] => {
  const editor = editorWith(document);
  return describeRanges(editor, createMarkdownDecorate(options)([editor, []]));
};

const sent = (document: Descendant[]): string =>
  toMatrixCustomHTML(document, {
    allowInlineMarkdown: true,
    allowBlockMarkdown: true,
    allowTextFormatting: true,
  });

const decoratedLine = (text: string): string[] => decorated([paragraph({ text })]);

describe('createMarkdownDecorate', () => {
  it.each([
    ['a **b** c', ['bold "b"', 'marker "**"', 'marker "**"']],
    [
      '*b* and _c_',
      ['italic "b"', 'marker "*"', 'marker "*"', 'italic "c"', 'marker "_"', 'marker "_"'],
    ],
    ['~~b~~', ['strikeThrough "b"', 'marker "~~"', 'marker "~~"']],
    ['||b||', ['spoiler "b"', 'marker "||"', 'marker "||"']],
    ['`b`', ['code "b"', 'marker "`"', 'marker "`"']],
    [
      '[label](https://example.org)',
      ['linkLabel "label"', 'marker "["', 'marker "](https://example.org)"'],
    ],
    ['\\*b\\*', ['marker "\\\\"', 'marker "\\\\"']],
  ])('styles %s with its syntax dimmed', (text, ranges) => {
    expect(decoratedLine(text)).toEqual(ranges);
  });

  it('styles nested Markdown, the inner syntax inside the outer style', () => {
    expect(decoratedLine('a **bold _it_** b')).toEqual([
      'bold "bold _it_"',
      'marker "**"',
      'marker "**"',
      'italic "it"',
      'marker "_"',
      'marker "_"',
    ]);
  });

  it('keeps Markdown inside URLs and code unstyled, as sending does', () => {
    expect(decoratedLine('https://example.org/_a_ `**b**` _c_')).toEqual([
      'code "**b**"',
      'marker "`"',
      'marker "`"',
      'italic "c"',
      'marker "_"',
      'marker "_"',
    ]);
  });

  it('finds spans after code at their offsets in the text, not in the masked text', () => {
    const editor = editorWith([paragraph({ text: '``a`` **b**' })]);
    const [, , , bold] = createMarkdownDecorate()([editor, []]);
    expect(bold).toMatchObject({
      bold: true,
      anchor: { path: [0, 0], offset: 8 },
      focus: { path: [0, 0], offset: 9 },
    });
  });

  it('keeps an escaped delimiter literal and dims only its backslash', () => {
    expect(decoratedLine('\\**a**')).toEqual(['marker "\\\\"']);
  });

  it('maps spans in the escaped text sending reads back onto the typed characters', () => {
    // Sending reads `&lt;_a_&gt;`; the ranges still cover the typed `_a_`.
    expect(decoratedLine('<_a_> & "_b_"')).toEqual([
      'italic "a"',
      'marker "_"',
      'marker "_"',
      'italic "b"',
      'marker "_"',
      'marker "_"',
    ]);
  });

  it('styles a span across a mention pill, ending in the text after it', () => {
    const editor = editorWith([
      paragraph({ text: '**hi ' }, createMentionElement('@alice:example.org', 'Alice', false), {
        text: ' there**',
      }),
    ]);
    const ranges = createMarkdownDecorate()([editor, []]);
    expect(describeRanges(editor, ranges)).toEqual([
      'bold "hi  there"',
      'marker "**"',
      'marker "**"',
    ]);
    expect(ranges[0]).toMatchObject({
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 2], offset: 6 },
    });
  });

  it('ends a span right after a mention pill, as the sent message does', () => {
    const document = [
      paragraph({ text: '**hi ' }, createMentionElement('@alice:example.org', 'Alice', false), {
        text: '**',
      }),
    ];
    expect(decorated(document)).toEqual(['bold "hi "', 'marker "**"', 'marker "**"']);
    expect(
      toMatrixCustomHTML(document, { allowInlineMarkdown: true, allowTextFormatting: true })
    ).toContain('<strong data-md="**">hi <a href=');
  });

  it('reads a toolbar mark as its tag, as sending does', () => {
    expect(
      decorated([paragraph({ text: '_a' }, { text: 'b', code: true }, { text: '_' })])
    ).toEqual(['italic "ab"', 'marker "_"', 'marker "_"']);
  });

  it.each(['/plain **a**', '/plain'])(
    'styles nothing in %s where commands are read, sent as typed',
    (text) => {
      const document = [paragraph({ text }), paragraph({ text: '**b**' })];
      expect(decorated(document, { commands: true })).toEqual([]);
    }
  );

  it.each(['/html **a**', '/shrug **a**'])('styles %s as text, no longer a command', (text) => {
    const document = [paragraph({ text })];
    expect(decorated(document, { commands: true })).toEqual([
      'bold "a"',
      'marker "**"',
      'marker "**"',
    ]);
    expect(sent(takeMessageCommand(document).document)).toContain(
      '<strong data-md="**">a</strong>'
    );
  });

  it('styles /plain where no commands are read, as the edit box saves it', () => {
    expect(decoratedLine('/plain **a**')).toEqual(['bold "a"', 'marker "**"', 'marker "**"']);
  });

  it('styles only the Markdown inside a link, through its empty text neighbours', () => {
    const document = [
      paragraph({ text: '' }, createLinkElement('https://example.org', 'before **bold** after'), {
        text: '',
      }),
    ];
    const editor = editorWith(document);
    const ranges = createMarkdownDecorate()([editor, []]);
    expect(describeRanges(editor, ranges)).toEqual(['bold "bold"', 'marker "**"', 'marker "**"']);
    expect(ranges[0]).toMatchObject({
      anchor: { path: [0, 1, 0], offset: 9 },
      focus: { path: [0, 1, 0], offset: 13 },
    });
    expect(sent(document)).toBe(
      '<a href="https://example.org">before <strong data-md="**">bold</strong> after</a>'
    );
  });

  it.each([
    ['a fenced code block', '```'],
    ['display math', '$$'],
  ])('styles nothing inside %s, sent as written', (_name, fence) => {
    const document = [
      paragraph({ text: fence }),
      paragraph({ text: '**a**' }),
      paragraph({ text: fence }),
    ];
    expect(decorated(document)).toEqual([]);
    expect(sent(document)).not.toContain('<strong');
  });

  it('styles a fence line inside a list item as sending reads it, in the item', () => {
    const document = [
      paragraph({ text: '- a' }),
      paragraph({ text: '  ```' }),
      paragraph({ text: '  **b**' }),
      paragraph({ text: '  ```' }),
    ];
    expect(decorated(document)).toEqual(['bold "b"', 'marker "**"', 'marker "**"']);
    expect(sent(document)).toContain('<strong data-md="**">b</strong>');
  });

  it('unstyles and restyles an unchanged line as fences around it come and go', () => {
    const editor = editorWith([
      paragraph({ text: '' }),
      paragraph({ text: '**a**' }),
      paragraph({ text: '' }),
    ]);
    const middle = editor.children[1];
    const decorate = createMarkdownDecorate();
    const styled = describeRanges(editor, decorate([editor, []]));
    expect(styled).toEqual(['bold "a"', 'marker "**"', 'marker "**"']);

    Transforms.insertText(editor, '```', { at: { path: [0, 0], offset: 0 } });
    expect(describeRanges(editor, decorate([editor, []]))).toEqual(styled);
    Transforms.insertText(editor, '```', { at: { path: [2, 0], offset: 0 } });
    expect(decorate([editor, []])).toEqual([]);

    Transforms.delete(editor, { at: { path: [2, 0], offset: 0 }, distance: 3 });
    expect(editor.children[1]).toBe(middle);
    expect(describeRanges(editor, decorate([editor, []]))).toEqual(styled);
  });

  it('shows a line with more ranges than the cap plain', () => {
    // Each `**a** ` gives three ranges: the bold text and its two markers.
    const spans = Math.floor(MAX_LINE_RANGES / 3);
    expect(decoratedLine('**a** '.repeat(spans))).toHaveLength(spans * 3);
    expect(decoratedLine('**a** '.repeat(spans + 1))).toEqual([]);
  });

  it('keeps applying the ranges of a line at the cap cheap, as Slate splits its text', () => {
    // Slate's cost is about the count of ranges squared: 1,500 ranges take about 60 ms.
    const text = '**a** '.repeat(Math.floor(MAX_LINE_RANGES / 3));
    const editor = editorWith([paragraph({ text })]);
    const ranges = createMarkdownDecorate()([editor, []]);
    const start = cpuNow();
    const leaves = Text.decorations({ text }, ranges);
    expect(cpuNow() - start).toBeLessThan(25);
    expect(leaves.length).toBeGreaterThan(ranges.length);
  });

  it('styles a message after its command, at its offsets in the typed text', () => {
    const editor = editorWith([paragraph({ text: '/me **waves**' })]);
    const ranges = createMarkdownDecorate({ commands: true })([editor, []]);
    expect(describeRanges(editor, ranges)).toEqual(['bold "waves"', 'marker "**"', 'marker "**"']);
    expect(ranges[0]).toMatchObject({
      anchor: { path: [0, 0], offset: 6 },
      focus: { path: [0, 0], offset: 11 },
    });
  });

  it.each([
    ['/me ```', '```'],
    ['/me $$', '$$'],
    ['/notice ```', '```'],
  ])('styles nothing in the block %s opens, sent without the command', (first, last) => {
    const document = [
      paragraph({ text: first }),
      paragraph({ text: '**a**' }),
      paragraph({ text: last }),
    ];
    expect(decorated(document, { commands: true })).toEqual([]);
    expect(sent(takeMessageCommand(document).document)).not.toContain('<strong');
    // The edit box sends the command as text, so no block starts and the line is bold.
    expect(decorated(document)).toEqual(['bold "a"', 'marker "**"', 'marker "**"']);
    expect(sent(document)).toContain('<strong data-md="**">a</strong>');
  });

  it('styles nothing in a table, whose cells are sent one by one', () => {
    const document = [paragraph({ text: '| **a | b** |' }), paragraph({ text: '| --- | --- |' })];
    expect(decorated(document)).toEqual([]);
    expect(sent(document)).toContain('<th>**a</th><th>b**</th>');
  });

  it('styles nothing in a table cell yet, and the line after the table again', () => {
    const document = [
      paragraph({ text: '| **x** | y |' }),
      paragraph({ text: '| --- | --- |' }),
      paragraph({ text: '**after**' }),
    ];
    expect(decorated(document)).toEqual(['bold "after"', 'marker "**"', 'marker "**"']);
    expect(sent(document)).toContain('<th><strong data-md="**">x</strong></th>');
  });

  it('styles a message that starts with another command', () => {
    expect(decoratedLine('/me **waves**')).toEqual(['bold "waves"', 'marker "**"', 'marker "**"']);
  });

  it('styles every line block and none inside a code block', () => {
    const document: Descendant[] = [
      { type: BlockType.Heading, level: 1, children: [{ text: '**a**' }] },
      {
        type: BlockType.BlockQuote,
        children: [{ type: BlockType.QuoteLine, children: [{ text: '_b_' }] }],
      },
      {
        type: BlockType.UnorderedList,
        children: [{ type: BlockType.ListItem, children: [{ text: '~~c~~' }] }],
      },
      {
        type: BlockType.CodeBlock,
        children: [{ type: BlockType.CodeLine, children: [{ text: '**d**' }] }],
      },
    ];
    expect(decorated(document)).toEqual([
      'bold "a"',
      'marker "**"',
      'marker "**"',
      'italic "b"',
      'marker "_"',
      'marker "_"',
      'strikeThrough "c"',
      'marker "~~"',
      'marker "~~"',
    ]);
  });

  it('links only the schemes sending links', () => {
    expect(decoratedLine('[a](matrix:r/room:example.org)')).toEqual([]);
    const document = [paragraph({ text: '[a](matrix:r/room:example.org)' })];
    expect(decorated(document, { linkSchemes: ['matrix'] })).toEqual([
      'linkLabel "a"',
      'marker "["',
      'marker "](matrix:r/room:example.org)"',
    ]);
  });

  it('answers only at the editor, for the whole document', () => {
    const editor = editorWith([paragraph({ text: '**a**' })]);
    const decorate = createMarkdownDecorate();
    expect(decorate([editor.children[0]!, [0]])).toEqual([]);
    expect(decorate([editor, []])).toHaveLength(3);
  });

  it('reads a line again only once it changes or moves', () => {
    const editor = editorWith([paragraph({ text: '**a**' }), paragraph({ text: '_b_' })]);
    const decorate = createMarkdownDecorate();
    const first = decorate([editor, []]);
    const again = decorate([editor, []]);
    first.forEach((range, index) => expect(again[index]).toBe(range));

    Transforms.insertText(editor, 'c', { at: { path: [1, 0], offset: 3 } });
    const edited = decorate([editor, []]);
    expect(edited[0]).toBe(first[0]);
    expect(edited[3]).not.toBe(first[3]);

    Transforms.insertNodes(editor, paragraph({ text: 'x' }), { at: [0] });
    const moved = decorate([editor, []]);
    expect(moved[0]).toMatchObject({ anchor: { path: [1, 0] } });
  });

  it.each([
    ['bold', '**a** '.repeat(4_000)],
    ['code and links', '`a` [b](https://example.org) '.repeat(4_000)],
    ['underscores', '_'.repeat(16_000)],
  ])('reads a line of 16k delimiters of %s in under a second', (_name, text) => {
    const editor = editorWith([paragraph({ text })]);
    const start = cpuNow();
    expect(createMarkdownDecorate()([editor, []]).length).toBeLessThanOrEqual(MAX_LINE_RANGES);
    expect(cpuNow() - start).toBeLessThan(1000);
  });
});
