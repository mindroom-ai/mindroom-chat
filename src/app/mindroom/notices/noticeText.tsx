import React, { ReactNode } from 'react';
import parse, { DOMNode, Element, HTMLReactParserOptions, domToReact } from 'html-react-parser';
import { parseInlineMDWithRules } from '../../plugins/markdown/inline/parser';
import {
  BoldRule,
  EscapeRule,
  ItalicRule1,
  ItalicRule2,
  StrikeRule,
} from '../../plugins/markdown/inline/rules';
import { InlineMDRule } from '../../plugins/markdown/inline/type';
import { sanitizeCustomHtml, sanitizeText } from '../../utils/sanitize';
import * as customHtmlCss from '../../styles/CustomHtml.css';
import { toHttpsUrl } from './notices';

// The composer's LinkRule, narrowed to https: URLs; any other link stays literal text.
const HTTPS_LINK_REG = /\[([^[\]]+)\]\((https:\/\/[^\s)]+)\)/;
const HttpsLinkRule: InlineMDRule = {
  match: (text) => text.match(HTTPS_LINK_REG),
  html: (parseInline, match) => {
    const [, label, url] = match;
    return `<a href="${url}">${parseInline(label)}</a>`;
  },
};

// Bold, italic, strikethrough and links; the parser always handles inline code.
const NOTICE_INLINE_RULES = [
  BoldRule,
  ItalicRule1,
  ItalicRule2,
  StrikeRule,
  HttpsLinkRule,
  EscapeRule,
];

const noticeHtmlOptions: HTMLReactParserOptions = {
  replace: (node) => {
    if (!(node instanceof Element)) return undefined;
    const children = domToReact(node.children as DOMNode[], noticeHtmlOptions);
    switch (node.name) {
      case 'strong':
        return <strong>{children}</strong>;
      case 'i':
        return <i>{children}</i>;
      case 's':
        return <s>{children}</s>;
      case 'code':
        return <code className={customHtmlCss.Code}>{children}</code>;
      case 'a': {
        const href = toHttpsUrl(node.attribs.href);
        return href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ) : (
          <>{children}</>
        );
      }
      default:
        return <>{children}</>;
    }
  },
};

/**
 * Renders a notice's text with inline Markdown only: `**bold**`, `*italic*`, `~~strike~~`,
 * `` `code` `` and `[label](https://…)`. Everything else, raw HTML included, is plain text,
 * and so is the whole text if parsing fails.
 */
export const renderNoticeText = (text: string): ReactNode => {
  try {
    return parse(
      sanitizeCustomHtml(parseInlineMDWithRules(sanitizeText(text), NOTICE_INLINE_RULES)),
      noticeHtmlOptions
    );
  } catch {
    return text;
  }
};
