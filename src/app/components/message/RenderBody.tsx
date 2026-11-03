import React, { ReactNode, memo, useMemo } from 'react';
import parse, { DOMNode, HTMLReactParserOptions } from 'html-react-parser';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { color } from 'folds';
import { MessageEmptyContent } from './content';
import { useClientConfig } from '../../hooks/useClientConfig';
import { sanitizeCustomHtml } from '../../utils/sanitize';
import { renderTextWithLatex } from '../../plugins/react-custom-html-parser';
import {
  HtmlReactParserOptionsSource,
  resolveHtmlReactParserOptions,
} from '../../utils/htmlReactParserOptions';

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
        <span key={match.index} data-search-highlight style={highlightStyle()}>
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
      if (domNode.type !== 'text' || !('data' in domNode)) return replaced;
      const parts = highlightText(regex, domNode.data);
      return parts ? <>{parts}</> : replaced;
    },
  };
};






  /** Options, or a factory called once per parse for options that keep state while parsing. */
  htmlReactParserOptions: HtmlReactParserOptionsSource;
  linkifyOpts: LinkifyOpts;
};

/**
 * A message body: the formatted HTML when there is one, otherwise the plain text with links and
 * math. Streaming replies re-render often, so the HTML is sanitized and parsed again only when
 * it, the parser options, the search highlight, or the allowed link schemes change.
 */
export const RenderBody = memo(function RenderBody({
  body,






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
