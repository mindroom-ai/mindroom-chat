import { createEditor, Editor, Transforms, type Descendant } from 'slate';
import { describe, expect, it } from 'vitest';
import { cpuNow } from '../../test/utils/cpuNow';
import { createMarkdownDecorate, findBlockCue, type MarkdownRange } from './markdownDecorations';
import { toMatrixCustomHTML } from './output';
import type { InlineContent } from './slate';
import { BlockType } from './types';
import { createMentionElement, withInlineElements } from './utils';

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

const decorated = (document: Descendant[], linkSchemes?: readonly string[]): string[] => {
  const editor = editorWith(document);
  return describeRanges(editor, createMarkdownDecorate(linkSchemes)([editor, []]));
};

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

  it.each(['/plain **a**', '/html **a**', '/plain'])(
    'styles nothing in %s, sent as typed',
    (text) => {
      expect(decorated([paragraph({ text }), paragraph({ text: '**b**' })])).toEqual([]);
    }
  );

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

  it.each([
    [
      '## **Title**',
      ['bold "## **Title**"', 'marker "## "', 'bold "Title"', 'marker "**"', 'marker "**"'],
    ],
    ['> quoted', ['marker "> "']],
    ['- item', ['marker "- "']],
    ['12. item', ['marker "12. "']],
  ])('shows the block cue of %s', (text, ranges) => {
    expect(decoratedLine(text)).toEqual(ranges);
  });

  it('links only the schemes sending links', () => {
    expect(decoratedLine('[a](matrix:r/room:example.org)')).toEqual([]);
    expect(decorated([paragraph({ text: '[a](matrix:r/room:example.org)' })], ['matrix'])).toEqual([
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
  ])('decorates a line of 16k delimiters of %s in under a second', (_name, text) => {
    const editor = editorWith([paragraph({ text })]);
    const start = cpuNow();
    expect(createMarkdownDecorate()([editor, []]).length).toBeGreaterThan(0);
    expect(cpuNow() - start).toBeLessThan(1000);
  });
});

describe('findBlockCue', () => {
  it.each([
    ['# a', { marker: 2, heading: true }],
    ['###### a', { marker: 7, heading: true }],
    ['#\ta', { marker: 2, heading: true }],
    ['>a', { marker: 1, heading: false }],
    ['> a', { marker: 2, heading: false }],
    ['* a', { marker: 2, heading: false }],
    ['   1. a', { marker: 6, heading: false }],
  ])('reads %s', (line, cue) => {
    expect(findBlockCue(line)).toEqual(cue);
  });

  it.each(['#a', '# ', '####### a', '-a', '    - a', '1.a', 'a # b'])(
    'finds no cue in %s',
    (line) => {
      expect(findBlockCue(line)).toBeUndefined();
    }
  );
});
