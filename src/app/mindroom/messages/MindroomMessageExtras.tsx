import React, { useCallback, useRef } from 'react';
import parse, { HTMLReactParserOptions } from 'html-react-parser';
import { parseBlockMD, parseInlineMD } from '../../plugins/markdown';
import { sanitizeCustomHtml, sanitizeText } from '../../utils/sanitize';
import {
  MINDROOM_MESSAGE_EXTRAS_TEXT_HTML,
  MINDROOM_MESSAGE_EXTRAS_TEXT_MARKDOWN,
  MINDROOM_MESSAGE_EXTRAS_TEXT_PLAIN,
  MindroomMessageExtras as MindroomMessageExtrasData,
  MindroomMessageExtrasSection,
} from './messageExtrasData';
import { sanitizeMindroomMessageExtraHtml } from './messageExtrasHtml';
import * as css from './MindroomMessageExtras.css';

type MindroomMessageExtraDetailsProps = React.DetailedHTMLProps<
  React.DetailsHTMLAttributes<HTMLDetailsElement>,
  HTMLDetailsElement
> & {
  defaultOpen: boolean;
};

type MindroomMessageExtrasProps = {
  extras: MindroomMessageExtrasData;
  htmlReactParserOptions: HTMLReactParserOptions;
};

const renderMarkdown = (
  section: MindroomMessageExtrasSection,
  htmlReactParserOptions: HTMLReactParserOptions
) => {
  const markdownHtml = parseBlockMD(sanitizeText(section.content), parseInlineMD);
  return parse(sanitizeCustomHtml(markdownHtml), htmlReactParserOptions);
};

const renderSectionContent = (
  section: MindroomMessageExtrasSection,
  htmlReactParserOptions: HTMLReactParserOptions
) => {
  try {
    if (section.contentType === MINDROOM_MESSAGE_EXTRAS_TEXT_PLAIN) {
      return <pre className={css.PlainText}>{section.content}</pre>;
    }

    if (section.contentType === MINDROOM_MESSAGE_EXTRAS_TEXT_MARKDOWN) {
      return <div className={css.Markdown}>{renderMarkdown(section, htmlReactParserOptions)}</div>;
    }

    if (section.contentType === MINDROOM_MESSAGE_EXTRAS_TEXT_HTML) {
      const sanitizedHtml = sanitizeMindroomMessageExtraHtml(section.content);
      return <div className={css.Html}>{parse(sanitizedHtml)}</div>;
    }
  } catch {
    return null;
  }

  return null;
};

const getSectionKey = (section: MindroomMessageExtrasSection, index: number): string =>
  `${index}:${section.title}:${section.contentType}`;

function MindroomMessageExtraDetails({ defaultOpen, ...props }: MindroomMessageExtraDetailsProps) {
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

export function MindroomMessageExtras({
  extras,
  htmlReactParserOptions,
}: MindroomMessageExtrasProps) {
  return (
    <div className={css.Extras} aria-label="Message extras">
      {extras.sections.map((section, index) => {
        const detailsProps: MindroomMessageExtraDetailsProps = {
          className: css.Section,
          defaultOpen: !section.collapsed,
        };

        return (
          <MindroomMessageExtraDetails key={getSectionKey(section, index)} {...detailsProps}>
            <summary className={css.Summary}>{section.title}</summary>
            <div className={css.Content}>
              {renderSectionContent(section, htmlReactParserOptions)}
            </div>
          </MindroomMessageExtraDetails>
        );
      })}
    </div>
  );
}
