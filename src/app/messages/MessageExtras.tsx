import { useTranslation } from 'react-i18next';
import React, { useCallback, useMemo, useRef } from 'react';
import {
  attributesToProps,
  domToReact,
  type DOMNode,
  Element as HtmlElement,
  type HTMLReactParserOptions,
} from 'html-react-parser';
import { isDesktopApp } from '../lib/nativeShell';
import { useDetailsRevealOnOpen } from '../ui/disclosureReveal';
import { CheckedMessageLink } from '../rich-text/CheckedMessageLink';
import { parseInlineMD } from '../rich-text/markdown/inline/parser';
import { parseBlockMD } from '../rich-text/markdown/block/parser';
import { parseHtml } from '../rich-text/parseHtml';
import { sanitizeCustomHtml, sanitizeText } from '../rich-text/sanitize';
import {
  type HtmlReactParserOptionsSource,
  resolveHtmlReactParserOptions,
} from '../rich-text/htmlReactParserOptions';
import {
  MINDROOM_MESSAGE_EXTRAS_TEXT_HTML,
  MINDROOM_MESSAGE_EXTRAS_TEXT_MARKDOWN,
  MINDROOM_MESSAGE_EXTRAS_TEXT_PLAIN,
  MessageExtras as MindroomMessageExtrasData,
  MessageExtrasSection,
} from '../matrix/protocol/messageExtrasData';
import { sanitizeMessageExtraHtml } from './messageExtrasHtml';
import { useToolTraceMarkerParserOptions } from './html/HtmlBlocks';
import { stripLinkTextBidi } from './html/react-custom-html-parser';
import { InlineSecretRequestsContext, NO_INLINE_SECRET_REQUESTS } from './inlineSecretRequests';
import { ToolApprovalsByNameContext } from './agent-run/toolCallStatus';
import * as css from './MessageExtras.css';

type MessageExtraDetailsProps = React.DetailedHTMLProps<
  React.DetailsHTMLAttributes<HTMLDetailsElement>,
  HTMLDetailsElement
> & {
  defaultOpen: boolean;
};

type MessageExtrasProps = {
  extras: MindroomMessageExtrasData;
  htmlReactParserOptions: HTMLReactParserOptions;
  /** The content whose tool and paste markers the sections render. */
  markerContent: Record<string, unknown>;
  /** Whether a tool marker draws a row: only an agent's does. */
  toolRows: boolean;
};

const isInsideSvg = (node: HtmlElement): boolean => {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent instanceof HtmlElement && parent.name.toLowerCase() === 'svg') return true;
  }
  return false;
};

// React 19 hoists HTML <title> rendered outside <svg> into document.head, overwriting the tab
// title; drop non-SVG <title> on both web and desktop. On desktop, also confirm misleading links
// before they open through the preload.
const createExtraHtmlParserOptions = (checkLinks: boolean): HTMLReactParserOptions => {
  const options: HTMLReactParserOptions = {
    replace(node) {
      if (!(node instanceof HtmlElement)) return undefined;
      if (node.name.toLowerCase() === 'title' && !isInsideSvg(node)) return <></>;
      if (checkLinks && node.name === 'a' && node.attribs.href) {
        stripLinkTextBidi(node.children);
        return (
          <CheckedMessageLink {...attributesToProps(node.attribs)}>
            {domToReact(node.children as DOMNode[], options)}
          </CheckedMessageLink>
        );
      }
      return undefined;
    },
  };
  return options;
};

const webExtraHtmlParserOptions = createExtraHtmlParserOptions(false);
const desktopExtraHtmlParserOptions = createExtraHtmlParserOptions(true);

const renderMarkdown = (content: string, htmlReactParserOptions: HtmlReactParserOptionsSource) => {
  const markdownHtml = parseBlockMD(sanitizeText(content), parseInlineMD);
  return parseHtml(
    sanitizeCustomHtml(markdownHtml),
    resolveHtmlReactParserOptions(htmlReactParserOptions)
  );
};

const renderSectionContent = (
  content: string,
  contentType: MessageExtrasSection['contentType'],
  htmlReactParserOptions: HtmlReactParserOptionsSource
) => {
  try {
    if (contentType === MINDROOM_MESSAGE_EXTRAS_TEXT_PLAIN) {
      return <pre className={css.PlainText}>{content}</pre>;
    }

    if (contentType === MINDROOM_MESSAGE_EXTRAS_TEXT_MARKDOWN) {
      return <div className={css.Markdown}>{renderMarkdown(content, htmlReactParserOptions)}</div>;
    }

    if (contentType === MINDROOM_MESSAGE_EXTRAS_TEXT_HTML) {
      const sanitizedHtml = sanitizeMessageExtraHtml(content);
      return (
        <div className={css.Html}>
          {parseHtml(
            sanitizedHtml,
            isDesktopApp() ? desktopExtraHtmlParserOptions : webExtraHtmlParserOptions
          )}
        </div>
      );
    }
  } catch {
    return null;
  }

  return null;
};

type MessageExtraSectionContentProps = {
  content: string;
  contentType: MessageExtrasSection['contentType'];
  htmlReactParserOptions: HtmlReactParserOptionsSource;
};

// Sanitizing + parsing section markdown/HTML is expensive; timeline re-renders
// (e.g. streaming m.replace bursts) must not re-parse unchanged sections.
function MessageExtraSectionContent({
  content,
  contentType,
  htmlReactParserOptions,
}: MessageExtraSectionContentProps) {
  return useMemo(
    () => renderSectionContent(content, contentType, htmlReactParserOptions),
    [content, contentType, htmlReactParserOptions]
  );
}

const getSectionKey = (section: MessageExtrasSection, index: number): string =>
  `${index}:${section.title}:${section.contentType}`;

function MessageExtraDetails({ defaultOpen, ...props }: MessageExtraDetailsProps) {
  const initializedRef = useRef(false);
  const revealRef = useDetailsRevealOnOpen();
  const handleRef = useCallback(
    (node: HTMLDetailsElement | null) => {
      revealRef(node);
      if (!node || initializedRef.current) return;

      node.open = defaultOpen;
      initializedRef.current = true;
    },
    [defaultOpen, revealRef]
  );

  return <details {...props} ref={handleRef} />;
}

export function MessageExtras({
  extras,
  htmlReactParserOptions,
  markerContent,
  toolRows,
}: MessageExtrasProps) {
  const { t } = useTranslation();
  const parserOptions = useToolTraceMarkerParserOptions(
    htmlReactParserOptions,
    markerContent,
    undefined,
    toolRows
  );
  return (
    <div
      className={css.Extras}
      aria-label={t('mindroomUi.messages.mindroomMessageExtras.messageExtras')}
    >
      {extras.sections.map((section, index) => {
        const detailsProps: MessageExtraDetailsProps = {
          className: css.Section,
          defaultOpen: !section.collapsed,
        };

        return (
          <MessageExtraDetails key={getSectionKey(section, index)} {...detailsProps}>
            <summary className={css.Summary}>{section.title}</summary>
            <div className={css.Content}>
              {/* Only the reply's body draws a secret request at its call, and gives
              approval cards to calls by their tool's name. */}
              <InlineSecretRequestsContext.Provider value={NO_INLINE_SECRET_REQUESTS}>
                <ToolApprovalsByNameContext.Provider value={false}>
                  <MessageExtraSectionContent
                    content={section.content}
                    contentType={section.contentType}
                    htmlReactParserOptions={parserOptions}
                  />
                </ToolApprovalsByNameContext.Provider>
              </InlineSecretRequestsContext.Provider>
            </div>
          </MessageExtraDetails>
        );
      })}
    </div>
  );
}
