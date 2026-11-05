import { ReactNode, memo, useMemo } from 'react';
import { isText } from 'domhandler';
import parse, { DOMNode, HTMLReactParserOptions } from 'html-react-parser';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { color } from 'folds';
import { MessageEmptyContent } from './FallbackContent';
import { useClientConfig } from '../../config/useClientConfig';
import { sanitizeCustomHtml } from '../../rich-text/sanitize';
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
    replace: (domNode: DOMNode) => {
      const replaced = options.replace?.(domNode);
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
  /** Options, or a factory called once per parse for options that keep state while parsing. */
  htmlReactParserOptions: HtmlReactParserOptionsSource;
  highlightRegex?: RegExp;
  linkifyOpts: LinkifyOpts;
}

/**
 * A message body: the formatted HTML when there is one, otherwise the plain text with links and
 * math. Streaming replies re-render often, so the HTML is sanitized and parsed again only when
 * it, the parser options, the search highlight, or the allowed link schemes change.
 */
export const RenderBody = memo(function RenderBody({
  body,
  customBody,
  highlightRegex,
  linkifyOpts,
  htmlReactParserOptions,
}: RenderBodyProps) {
  const clientConfig = useClientConfig();
  const allowedSchemes = clientConfig.messageRendering?.additionalAllowedUriSchemes;
  const schemesKey = JSON.stringify(allowedSchemes ?? null);

  const customContent = useMemo(() => {
    if (!customBody) return undefined;
    const additionalAllowedUriSchemes: string[] | undefined = JSON.parse(schemesKey) ?? undefined;
    return parse(
      sanitizeCustomHtml(customBody, { additionalAllowedUriSchemes }),
      withHighlight(resolveHtmlReactParserOptions(htmlReactParserOptions), highlightRegex)
    );
  }, [customBody, highlightRegex, htmlReactParserOptions, schemesKey]);

  if (customContent !== undefined) return <>{customContent}</>;
  if (body === '') return <MessageEmptyContent />;
  return (
    <>
      {renderTextWithLatex(body, {
        linkify: true,
        linkifyOpts,
        highlightRegex,
      })}
    </>
  );
});
