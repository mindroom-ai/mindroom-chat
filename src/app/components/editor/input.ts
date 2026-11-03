import parse from 'html-dom-parser';
import { ChildNode, Element as DomElement, isTag, isText } from 'domhandler';
import { Descendant } from 'slate';
import { escapeMarkdownInlineSequences } from '../../plugins/markdown';
import {
  getMindroomEditorMathText,
  getMindroomEditorPasteMarkerElement,
  isMindroomEditorMathBlockElement,
  parseMindroomEditorMathBlock,
} from '../../mindroom/editor/MindroomEditorExtensions';
import { BlockType, HeadingLevel } from './types';
import type {
  CodeLineElement,
  FormattedText,
  InlineContent,
  ListItemElement,
  ParagraphElement,
  QuoteLineElement,
} from './slate';
import { createEmoticonElement, createLinkElement, createMentionElement } from './utils';

type Marks = Omit<FormattedText, 'text'>;

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'pre',
  'blockquote',
  'ol',
  'ul',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'table',
  'mx-reply',
]);

const getText = (node: ChildNode): string => {
  if (isText(node)) return node.data;
  if (isTag(node)) return node.children.map(getText).join('');
  return '';
};

const isBlockNode = (node: ChildNode): boolean =>
  isTag(node) && (BLOCK_TAGS.has(node.name) || isMindroomEditorMathBlockElement(node));

const MATRIX_TO_PREFIX = 'https://matrix.to/#/';

/** Reads a user, room, or event permalink; other links stay links. */
const parseMatrixToLink = (
  href: string
): { id: string; eventId?: string; viaServers?: string[] } | undefined => {
  if (!href.startsWith(MATRIX_TO_PREFIX)) return undefined;
  const [path, query] = href.slice(MATRIX_TO_PREFIX.length).split('?');
  const [rawId, rawEventId] = path.split('/');
  if (!rawId) return undefined;
  const id = decodeURIComponent(rawId);
  if (!/^[@!#]/.test(id)) return undefined;
  const viaServers = new URLSearchParams(query ?? '').getAll('via');
  return {
    id,
    eventId: rawEventId ? decodeURIComponent(rawEventId) : undefined,
    viaServers: viaServers.length > 0 ? viaServers : undefined,
  };
};

const sameMarks = (a: FormattedText, b: FormattedText): boolean =>
  !!a.bold === !!b.bold &&
  !!a.italic === !!b.italic &&
  !!a.underline === !!b.underline &&
  !!a.strikeThrough === !!b.strikeThrough &&
  !!a.code === !!b.code &&
  !!a.spoiler === !!b.spoiler;

const isFormattedText = (node: InlineContent): node is FormattedText =>
  'text' in node && !('type' in node);

/** Joins neighbouring text leaves with the same marks and drops empty ones between them. */
const mergeTexts = (nodes: InlineContent[]): InlineContent[] => {
  const merged: InlineContent[] = [];
  nodes.forEach((node) => {
    const last = merged[merged.length - 1];
    if (isFormattedText(node) && last && isFormattedText(last) && sameMarks(last, node)) {
      merged[merged.length - 1] = { ...last, text: last.text + node.text };
      return;
    }
    if (isFormattedText(node) && node.text === '' && merged.length > 0) return;
    merged.push(node);
  });
  return merged.length > 0 ? merged : [{ text: '' }];
};

const textLeaf = (text: string, marks: Marks): FormattedText => {
  const leaf: FormattedText = { text };
  (Object.keys(marks) as (keyof Marks)[]).forEach((mark) => {
    if (marks[mark]) leaf[mark] = true;
  });
  return leaf;
};

const wrapMarkdown = (marker: string, children: InlineContent[], closing = marker) => [
  { text: marker },
  ...children,
  { text: closing },
];

function parseInline(node: ChildNode, marks: Marks, markdown: boolean): InlineContent[] {
  if (isText(node)) {
    return [textLeaf(markdown ? escapeMarkdownInlineSequences(node.data) : node.data, marks)];
  }
  if (!isTag(node)) return [];

  const pasteMarker = getMindroomEditorPasteMarkerElement(node, getText);
  if (pasteMarker) return [pasteMarker];

  const math = getMindroomEditorMathText(node, getText, markdown);
  if (math !== undefined) return [textLeaf(math, marks)];

  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  const children = (childMarks: Marks) => parseInlineChildren(node.children, childMarks, markdown);
  const md = node.attribs['data-md'];

  switch (node.name) {
    case 'img': {
      const src = node.attribs.src;
      if (src && node.attribs['data-mx-emoticon'] !== undefined) {
        const shortcode = (node.attribs.title || node.attribs.alt || '').replace(/^:|:$/g, '');
        return [createEmoticonElement(src, shortcode)];
      }
      return [textLeaf(node.attribs.alt || node.attribs.title || '', marks)];
    }
    case 'a': {
      const href = node.attribs.href ?? '';
      const permalink = parseMatrixToLink(href);
      const text = getText(node);
      if (permalink) {
        return [
          createMentionElement(
            permalink.id,
            text || permalink.id,
            permalink.id === '@room',
            permalink.eventId,
            permalink.viaServers
          ),
        ];
      }
      if (markdown) {
        if (!href || text === href) return children(marks);
        return wrapMarkdown('[', children(marks), `](${href})`);
      }
      return href ? [{ ...createLinkElement(href, text) }] : children(marks);
    }
    case 'strong':
    case 'b':
      return markdown
        ? wrapMarkdown(md || '**', children(marks))
        : children({ ...marks, bold: true });
    case 'em':
    case 'i':
      return markdown
        ? wrapMarkdown(md || '*', children(marks))
        : children({ ...marks, italic: true });
    case 'del':
    case 's':
    case 'strike':
      return markdown
        ? wrapMarkdown(md || '~~', children(marks))
        : children({ ...marks, strikeThrough: true });
    case 'u':
      return markdown ? children(marks) : children({ ...marks, underline: true });
    case 'code':
      return markdown
        ? [textLeaf(`${md || '`'}${getText(node)}${md || '`'}`, marks)]
        : children({ ...marks, code: true });
    case 'span':
      if (node.attribs['data-mx-spoiler'] !== undefined) {
        return markdown
          ? wrapMarkdown(md || '||', children(marks))
          : children({ ...marks, spoiler: true });
      }
      return children(marks);
    default:
      return children(marks);
  }
}

function parseInlineChildren(nodes: ChildNode[], marks: Marks, markdown: boolean): InlineContent[] {
  return nodes.flatMap((child) => parseInline(child, marks, markdown));
}

const paragraph = (children: InlineContent[]): ParagraphElement => ({
  type: BlockType.Paragraph,
  children: mergeTexts(children),
});

/** Prepends `prefix` to the first text leaf of a line, so Markdown markers lead the line. */
const prefixParagraph = (line: ParagraphElement, prefix: string): ParagraphElement =>
  paragraph([{ text: prefix }, ...line.children]);

const isEmptyParagraph = (line: Descendant): boolean =>
  'type' in line &&
  line.type === BlockType.Paragraph &&
  line.children.every((child) => 'text' in child && !('type' in child) && child.text === '');

const dropTrailingEmptyLine = (lines: Descendant[]): Descendant[] =>
  lines.length > 0 && isEmptyParagraph(lines[lines.length - 1]) ? lines.slice(0, -1) : lines;

const toQuoteLine = (line: Descendant): QuoteLineElement => ({
  type: BlockType.QuoteLine,
  children: 'children' in line ? (line.children as InlineContent[]) : [{ text: '' }],
});

const toListItem = (line: Descendant): ListItemElement => ({
  type: BlockType.ListItem,
  children: 'children' in line ? (line.children as InlineContent[]) : [{ text: '' }],
});

function parseBlocks(nodes: ChildNode[], markdown: boolean): Descendant[] {
  const blocks: Descendant[] = [];
  let inline: InlineContent[] = [];
  let pendingLine = false;

  const flush = (force = false) => {
    if (inline.length > 0 || force) blocks.push(paragraph(inline));
    inline = [];
    pendingLine = false;
  };

  nodes.forEach((node) => {
    if (isTag(node) && node.name === 'br') {
      flush(true);
      return;
    }
    if (!isBlockNode(node)) {
      inline.push(...parseInline(node, {}, markdown));
      pendingLine = true;
      return;
    }
    if (pendingLine) flush();
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    blocks.push(...parseBlock(node as DomElement, markdown));
  });
  if (pendingLine) flush();
  return blocks;
}

const headingLevel = (name: string): HeadingLevel => {
  const level = Number(name.slice(1));
  return (level >= 1 && level <= 3 ? level : 3) as HeadingLevel;
};

function parseBlock(node: DomElement, markdown: boolean): Descendant[] {
  if (isMindroomEditorMathBlockElement(node)) {
    return parseMindroomEditorMathBlock(node, getText, markdown);
  }
  const md = node.attribs['data-md'];

  switch (node.name) {
    case 'mx-reply':
      return [];
    case 'hr':
      return [paragraph([{ text: markdown ? '---' : '' }])];
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const children = parseInlineChildren(node.children, {}, markdown);
      if (markdown) {
        return [
          paragraph([{ text: `${md || '#'.repeat(Number(node.name.slice(1)))} ` }, ...children]),
        ];
      }
      return [
        { type: BlockType.Heading, level: headingLevel(node.name), children: mergeTexts(children) },
      ];
    }
    case 'pre': {
      const codeNode = node.children.find((child) => isTag(child) && child.name === 'code');
      const className = codeNode && isTag(codeNode) ? codeNode.attribs.class ?? '' : '';
      const language = className.match(/language-(\S+)/)?.[1] ?? '';
      const lines = getText(node).replace(/\n$/, '').split('\n');
      if (markdown) {
        const fence = md || '```';
        return [
          paragraph([{ text: `${fence}${language}` }]),
          ...lines.map((line) => paragraph([{ text: line }])),
          paragraph([{ text: fence }]),
        ];
      }
      return [
        {
          type: BlockType.CodeBlock,
          children: lines.map<CodeLineElement>((line) => ({
            type: BlockType.CodeLine,
            children: [{ text: line }],
          })),
        },
      ];
    }
    case 'blockquote': {
      const lines = dropTrailingEmptyLine(parseBlocks(node.children, markdown));
      if (markdown) {
        return lines.map((line) => prefixParagraph(line as ParagraphElement, `${md || '>'} `));
      }
      return [{ type: BlockType.BlockQuote, children: lines.map(toQuoteLine) }];
    }
    case 'ol':
    case 'ul': {
      const ordered = node.name === 'ol';
      const start = Number(node.attribs.start ?? '1') || 1;
      const items = node.children.filter(
        (child): child is DomElement => isTag(child) && child.name === 'li'
      );
      const lines = items.map((item) => {
        const itemLines = dropTrailingEmptyLine(parseBlocks(item.children, markdown));
        return itemLines.length > 0 ? (itemLines[0] as ParagraphElement) : paragraph([]);
      });
      if (markdown) {
        return lines.map((line, index) =>
          prefixParagraph(line, ordered ? `${start + index}. ` : `${md || '-'} `)
        );
      }
      return [
        {
          type: ordered ? BlockType.OrderedList : BlockType.UnorderedList,
          children: lines.map(toListItem),
        },
      ];
    }
    default:
      return dropTrailingEmptyLine(parseBlocks(node.children, markdown));
  }
}

/**
 * Converts `org.matrix.custom.html` into composer content, for editing a message. With
 * `markdown`, formatting becomes the Markdown that produced it (from `data-md` where the
 * sender recorded it), so the composer shows editable source text.
 */
export const htmlToEditorInput = (unsafeHtml: string, markdown?: boolean): Descendant[] => {
  const blocks = dropTrailingEmptyLine(parseBlocks(parse(unsafeHtml), !!markdown));
  return blocks.length > 0 ? blocks : [paragraph([])];
};

/** Converts plain text into composer lines. */
export const plainToEditorInput = (text: string, markdown?: boolean): Descendant[] =>
  text
    .split('\n')
    .map((line) => paragraph([{ text: markdown ? escapeMarkdownInlineSequences(line) : line }]));
