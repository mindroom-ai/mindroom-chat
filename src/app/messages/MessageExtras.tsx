import { useTranslation } from 'react-i18next';
import React, { useCallback, useMemo, useRef } from 'react';
import parse, {
  attributesToProps,
  domToReact,
  type DOMNode,
  Element as HtmlElement,
  type HTMLReactParserOptions,
} from 'html-react-parser';
import { isDesktopApp } from '../lib/nativeShell';
import { CheckedMessageLink } from '../rich-text/CheckedMessageLink';
import { parseInlineMD } from '../rich-text/markdown/inline/parser';
import { parseBlockMD } from '../rich-text/markdown/block/parser';
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

// Desktop app only: a link there opens through the preload, so a misleading one is asked about
// first. Everywhere else the anchor stays as it is.
const extraHtmlParserOptions: HTMLReactParserOptions = {
  replace(node) {
    if (!(node instanceof HtmlElement) || node.name !== 'a' || !node.attribs.href) return undefined;
    stripLinkTextBidi(node.children);
    return (
      <CheckedMessageLink {...attributesToProps(node.attribs)}>
        {domToReact(node.children as DOMNode[], extraHtmlParserOptions)}
      </CheckedMessageLink>
    );
  },
};

const renderMarkdown = (content: string, htmlReactParserOptions: HtmlReactParserOptionsSource) => {
  const markdownHtml = parseBlockMD(sanitizeText(content), parseInlineMD);
  return parse(
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
          {parse(sanitizedHtml, isDesktopApp() ? extraHtmlParserOptions : undefined)}
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
  const handleRef = useCallback(
    (node: HTMLDetailsElement | null) => {
      if (!node || initializedRef.current) return;

      node.open = defaultOpen;
      initializedRef.current = true;
    },
    [defaultOpen]
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
