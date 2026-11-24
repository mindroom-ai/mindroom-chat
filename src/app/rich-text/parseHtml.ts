import parseHtmlToReact, {
  htmlToDOM as rawHtmlToDOM,
  type DOMNode,
  type HTMLReactParserOptions,
} from 'html-react-parser';

// HTML5 input stream preprocessing normalizes CRLF and lone CR to LF.
// html-dom-parser 5's browser entry replaces `\r` with a placeholder string that is only restored
// in text nodes, which corrupts tags containing `\r` (such as `<a\r\n href=...>`) and multiline
// attributes (such as `data-mx-maths`). Normalize line endings before parsing everywhere.
export const normalizeHtmlLineEndings = (html: string): string => html.replace(/\r\n?/g, '\n');

export const parseHtml = (
  html: string,
  options?: HTMLReactParserOptions
): ReturnType<typeof parseHtmlToReact> => parseHtmlToReact(normalizeHtmlLineEndings(html), options);

export const parseHtmlToDom = (
  html: string,
  options?: Parameters<typeof rawHtmlToDOM>[1]
): DOMNode[] => rawHtmlToDOM(normalizeHtmlLineEndings(html), options);
