import React, { type ReactNode } from 'react';
import { Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { HTMLReactParserOptions } from 'html-react-parser';
import type { Opts } from 'linkifyjs';
import { RenderBody } from '../../components/message';
import { renderLiveMarkdown, useLiveMarkdownReady } from '../live/liveMarkdown';
import { LIVE_ACTIVITY_KEY, LIVE_REASONING_KEY } from '../live/useLiveReplyContent';
import { MindroomCollapsibleBlock } from './MindroomHtmlBlocks';

/** On a reply's terminal edit: `{ text, duration_ms }` of the model reasoning it streamed. */
export const MINDROOM_REASONING_KEY = 'io.mindroom.reasoning';

type MindroomReasoningInfo = { text: string; durationMs?: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getMindroomReasoning = (
  content: Record<string, unknown>
): MindroomReasoningInfo | undefined => {
  const live = content[LIVE_REASONING_KEY];
  if (typeof live === 'string' && live) return { text: live };
  const reasoning = content[MINDROOM_REASONING_KEY];
  if (!isRecord(reasoning) || typeof reasoning.text !== 'string' || !reasoning.text) {
    return undefined;
  }
  const durationMs = reasoning.duration_ms;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return undefined;
  }
  return { text: reasoning.text, durationMs };
};

type MindroomReasoningProps = {
  reasoning: MindroomReasoningInfo;
  htmlReactParserOptions: HTMLReactParserOptions;
  linkifyOpts: Opts;
};

/** Model reasoning: open while it streams, then collapsed with how long the model thought. */
function MindroomReasoning({
  reasoning,
  htmlReactParserOptions,
  linkifyOpts,
}: MindroomReasoningProps) {
  const { t } = useTranslation();
  const html = useLiveMarkdownReady() ? renderLiveMarkdown(reasoning.text) : undefined;
  const { durationMs } = reasoning;
  const live = durationMs === undefined;
  return (
    <MindroomCollapsibleBlock
      // The final reasoning starts collapsed, whatever the live block was.
      key={live ? 'live' : 'final'}
      icon={Icons.Bulb}
      label={
        live
          ? t('mindroomUi.messages.mindroomReasoning.thinking')
          : t('mindroomUi.messages.mindroomReasoning.thoughtFor', {
              count: Math.max(1, Math.round(durationMs / 1000)),
            })
      }
      defaultExpanded={live}
    >
      {/* The block body lays its children out in a row, so the paragraphs need one wrapper. */}
      <div>
        <RenderBody
          body={reasoning.text}
          customBody={html}
          htmlReactParserOptions={htmlReactParserOptions}
          linkifyOpts={linkifyOpts}
        />
      </div>
    </MindroomCollapsibleBlock>
  );
}

/**
 * The message body with the reply's reasoning above it and its live activity below it,
 * or the body itself when the content has neither.
 */
export const withMindroomReasoning = (
  content: Record<string, unknown>,
  body: ReactNode,
  htmlReactParserOptions: HTMLReactParserOptions,
  linkifyOpts: Opts
): ReactNode => {
  const reasoning = getMindroomReasoning(content);
  const activity = content[LIVE_ACTIVITY_KEY];
  const hasActivity = typeof activity === 'string' && activity.length > 0;
  if (!reasoning && !hasActivity) return body;
  return (
    <>
      {reasoning && (
        <MindroomReasoning
          reasoning={reasoning}
          htmlReactParserOptions={htmlReactParserOptions}
          linkifyOpts={linkifyOpts}
        />
      )}
      {body}
      {hasActivity && (
        <Text as="div" size="T200" priority="300" style={{ whiteSpace: 'pre-line' }}>
          {activity}
        </Text>
      )}
    </>
  );
};
