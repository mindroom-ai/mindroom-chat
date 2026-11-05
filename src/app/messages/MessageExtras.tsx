import { useTranslation } from 'react-i18next';
import React, { useCallback, useMemo, useRef } from 'react';
import parse, { type HTMLReactParserOptions } from 'html-react-parser';
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
      return <div className={css.Html}>{parse(sanitizedHtml)}</div>;
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
}: MessageExtrasProps) {
  const { t } = useTranslation();
  const parserOptions = useToolTraceMarkerParserOptions(
    htmlReactParserOptions,
    markerContent
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
              <MessageExtraSectionContent
                content={section.content}
                contentType={section.contentType}
                htmlReactParserOptions={parserOptions}
              />
            </div>
          </MessageExtraDetails>
        );
      })}
    </div>
  );
}
