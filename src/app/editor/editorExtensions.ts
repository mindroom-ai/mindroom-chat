import { ChildNode, Element } from 'domhandler';

import type { ParagraphElement, PasteMarkerElement } from './slate';
import { BlockType } from './types';
import { sanitizeText } from '../rich-text/sanitize';
import {
  formatPasteMarkerAsHtml,
  parsePasteMarker,
} from '../matrix/protocol/pasteAttachmentMarker';

export type EditorTextExtractor = (node: ChildNode) => string;

export const formatEditorMathMarkdown = (latex: string, displayMode: boolean): string =>
  displayMode ? `$$${latex}$$` : `$${latex}$`;

const splitEditorMathLines = (latex: string): string[] => latex.split(/\r?\n/);

const hasEditorMathLineBreak = (latex: string): boolean => /[\r\n]/.test(latex);

const isEditorMathElement = (node: Element): boolean =>
  (node.name === 'span' || node.name === 'div') && node.attribs['data-mx-maths'] !== undefined;

export const isEditorMathBlockElement = (node: Element): boolean =>
  node.name === 'div' && node.attribs['data-mx-maths'] !== undefined;

export const getEditorMathLatex = (
  node: Element,
  getText: EditorTextExtractor
): string | undefined => {
  const latex = node.attribs['data-mx-maths'];
  if (typeof latex === 'string' && latex.length > 0) {
    return latex;
  }

  const text = getText(node);
  return text.length > 0 ? text : undefined;
};

export const getEditorMathText = (
  node: Element,
  getText: EditorTextExtractor,
  markdown?: boolean
): string | undefined => {
  if (!isEditorMathElement(node)) return undefined;

  const latex = getEditorMathLatex(node, getText);
  if (!latex) return undefined;

  const displayMode = node.name === 'div';
  return markdown ? formatEditorMathMarkdown(latex, displayMode) : latex;
};

export const parseEditorMathBlock = (
  node: Element,
  getText: EditorTextExtractor,
  markdown?: boolean
): ParagraphElement[] => {
  const latex = getEditorMathLatex(node, getText);
  if (!latex) return [];

  if (!markdown) {
    return splitEditorMathLines(latex).map<ParagraphElement>((lineText) => ({
      type: BlockType.Paragraph,
      children: [{ text: lineText }],
    }));
  }

  if (!hasEditorMathLineBreak(latex)) {
    return [
      {
        type: BlockType.Paragraph,
        children: [{ text: formatEditorMathMarkdown(latex, true) }],
      },
    ];
  }

  return [
    {
      type: BlockType.Paragraph,
      children: [{ text: '$$' }],
    },
    ...splitEditorMathLines(latex).map<ParagraphElement>((lineText) => ({
      type: BlockType.Paragraph,
      children: [{ text: lineText }],
    })),
    {
      type: BlockType.Paragraph,
      children: [{ text: '$$' }],
    },
  ];
};

export const getEditorPasteMarkerElement = (
  node: Element,
  getText: EditorTextExtractor
): PasteMarkerElement | undefined => {
  if (node.name !== 'span' || node.attribs['data-mindroom-paste-marker'] !== 'true') {
    return undefined;
  }

  const marker = parsePasteMarker(getText(node));
  if (!marker) return undefined;

  return {
    type: BlockType.PasteMarker,
    id: marker.id,
    chars: marker.chars,
    fileName: marker.fileName,
    marker: marker.raw,
    children: [{ text: '' }],
  };
};

export const editorPasteMarkerElementToCustomHtml = (node: PasteMarkerElement): string => {
  const marker = parsePasteMarker(node.marker);
  return marker ? formatPasteMarkerAsHtml(marker) : sanitizeText(node.marker);
};

export const editorPasteMarkerElementToPlainText = (node: PasteMarkerElement): string =>
  node.marker;
