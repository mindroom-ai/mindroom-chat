import { ReactNode, memo, useMemo } from 'react';
import { isText, type ChildNode } from 'domhandler';
import { DOMNode, HTMLReactParserOptions, domToReact } from 'html-react-parser';
import { parseHtml } from '../../rich-text/parseHtml';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { color } from 'folds';
import { MessageEmptyContent } from './FallbackContent';
import { useClientConfig } from '../../config/useClientConfig';
import { sanitizeCustomHtml } from '../../rich-text/sanitize';
import { useBodySanitizeOptions } from './useBodySanitizeOptions';
import { cloneDomNodes } from '../agent-run/replyDomNodes';
import { FootnoteScopeProvider } from '../../rich-text/Footnote';
import { LinkFaviconContext } from '../../rich-text/MessageLink';
import { InlineMediaContext, type InlineMediaContextValue } from '../html/InlineImage';
import { renderTextWithLatex } from '../html/react-custom-html-parser';
import {
  HtmlReactParserOptionsSource,
  resolveHtmlReactParserOptions,
} from '../../rich-text/htmlReactParserOptions';

// Read only while highlighting: tests replace folds with partial doubles.
const highlightStyle = () => ({
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
  borderRadius: '0.2em',
});

/** Marks every match of `regex` in `text`. */
const highlightText = (regex: RegExp, text: string): ReactNode[] | undefined => {
  const pattern = new RegExp(
    regex.source,
    regex.flags.includes('g') ? regex.flags : `${regex.flags}g`
  );
  const parts: ReactNode[] = [];
  let last = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match[0] === '') {
      pattern.lastIndex += 1;
    } else {
      if (match.index > last) parts.push(text.slice(last, match.index));
      parts.push(
        <span key={match.index} style={highlightStyle()}>
          {match[0]}
        </span>
      );
      last = match.index + match[0].length;
    }
    match = pattern.exec(text);
  }
  if (parts.length === 0) return undefined;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
};

/** Highlights search matches in the HTML's text where the caller's options leave text alone. */
const withHighlight = (
  options: HTMLReactParserOptions,
  regex: RegExp | undefined
): HTMLReactParserOptions => {
  if (!regex) return options;
  return {
    ...options,
    replace: (domNode: DOMNode, index: number) => {
      const replaced = options.replace?.(domNode, index);
      if (replaced) return replaced;
      if (!isText(domNode)) return replaced;
      const parts = highlightText(regex, domNode.data);
      return parts ? <>{parts}</> : replaced;
    },
  };
};

interface RenderBodyProps {
  body: string;
  /** Sanitized and rendered instead of `body` when it is a non-empty string. */
  customBody?: string;
  /** Pre-sanitized, pre-parsed DOM nodes (skips sanitization and HTML parsing when provided). */
  parsedDom?: readonly ChildNode[];
  /** Options, or a factory called once per parse for options that keep state while parsing. */
  htmlReactParserOptions: HtmlReactParserOptionsSource;
  highlightRegex?: RegExp;
  linkifyOpts: LinkifyOpts;
  inlineMedia?: InlineMediaContextValue;
}

/**
 * A message body: the formatted HTML when there is one, otherwise the plain text with links and
 * math. Streaming replies re-render often, so the HTML is sanitized and parsed again only when
 * it, the parser options, the search highlight, or the allowed link schemes change.
 */
export const RenderBody = memo(function RenderBody({
  body,
  customBody,
  parsedDom,
  highlightRegex,
  linkifyOpts,
  htmlReactParserOptions,
  inlineMedia,
}: RenderBodyProps) {
  const clientConfig = useClientConfig();
  // Site icons come from a third party, so links show them only where the deployment allows it.
  const linkFavicons = clientConfig.messageRendering?.linkFavicons === true;
  const sanitizeOptions = useBodySanitizeOptions();

  const customContent = useMemo(() => {
    if (parsedDom !== undefined) {
      return domToReact(
        cloneDomNodes(parsedDom),
        withHighlight(resolveHtmlReactParserOptions(htmlReactParserOptions), highlightRegex)
      );
    }
    if (!customBody) return undefined;
    return parseHtml(
      sanitizeCustomHtml(customBody, sanitizeOptions),
      withHighlight(resolveHtmlReactParserOptions(htmlReactParserOptions), highlightRegex)
    );
  }, [parsedDom, customBody, highlightRegex, htmlReactParserOptions, sanitizeOptions]);

  const plainContent = useMemo(() => {
    if (customContent !== undefined || body === '') return undefined;
    return renderTextWithLatex(body, { linkify: true, linkifyOpts, highlightRegex });
  }, [body, customContent, highlightRegex, linkifyOpts]);

  if (body === '' && customContent === undefined) return <MessageEmptyContent />;
  const content = customContent ?? plainContent;
  return (
    <FootnoteScopeProvider>
      <LinkFaviconContext value={linkFavicons}>
        <InlineMediaContext value={inlineMedia}>{content}</InlineMediaContext>
      </LinkFaviconContext>
    </FootnoteScopeProvider>
  );
});
