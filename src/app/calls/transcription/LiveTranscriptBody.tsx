import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Icon, Icons, Text } from 'folds';
import { textDirection } from '../../ui/directional';
import { useResizeObserver } from '../../lib/hooks/useResizeObserver';
import { getSenderName } from '../../matrix/room';
import { NameWithUserId } from '../../matrix/NameWithUserId';
import { CallMemberAvatar } from '../CallTile';
import type { TranscriptLine } from './api';
import type { LiveTranscript } from './transcriptionState';
import type { LiveTranscriptView } from './useLiveTranscript';
import * as panelCss from '../CallPanel.css';
import * as css from './LiveTranscriptPanel.css';

export const GAP_KEYS = {
  paused: 'featureUi.calls.transcription.gap.paused',
  'not-transcribed': 'featureUi.calls.transcription.gap.notTranscribed',
} as const;

/** A run of speech by one person, or a gap. */
type Item =
  | { kind: 'speech'; key: string; userId: string; lines: Array<{ id: string; text: string }> }
  | { kind: 'gap'; key: string; reason: keyof typeof GAP_KEYS };

/** Consecutive speech by one person under one name, as a chat groups messages; gaps apart. */
const groupLines = (lines: readonly TranscriptLine[]): Item[] =>
  lines.reduce<Item[]>((items, line) => {
    if (line.kind === 'gap') {
      items.push({ kind: 'gap', key: line.id, reason: line.reason });
      return items;
    }
    const last = items[items.length - 1];
    if (last?.kind === 'speech' && last.userId === line.userId) {
      last.lines.push({ id: line.id, text: line.text });
    } else {
      items.push({
        kind: 'speech',
        key: line.id,
        userId: line.userId,
        lines: [{ id: line.id, text: line.text }],
      });
    }
    return items;
  }, []);

/**
 * Who is in the call, by their avatar and name; the user ID follows a name until the room's members
 * are loaded (`getSenderName`), so nobody passes for someone else.
 */
function Members({ room, live }: { room: Room; live: LiveTranscript }) {
  const { t } = useTranslation();
  const members = live.call?.members ?? [];
  return (
    <ul className={css.Members} aria-label={t('featureUi.calls.transcription.inCall')}>
      {members.map((userId) => (
        <li key={userId} className={css.Member}>
          <CallMemberAvatar room={room} userId={userId} size="200" />
          <span className={css.NameRow} data-live-transcript-member="">
            <NameWithUserId name={getSenderName(room, userId)} userId={userId} size="T300" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What was said so far: each run of speech under its speaker, and the gaps. The log is there
 * before anyone speaks, so screen readers announce the first line too.
 */
function Lines({ room, live }: { room: Room; live: LiveTranscript }) {
  const { t } = useTranslation();
  const items = useMemo(() => groupLines(live.lines), [live.lines]);
  return (
    <div role="log" aria-label={t('featureUi.calls.transcription.lines')}>
      {items.length === 0 && (
        <Text size="T300" priority="300">
          {t('featureUi.calls.transcription.nothingYet')}
        </Text>
      )}
      <ol className={css.Lines}>
        {items.map((item) =>
          item.kind === 'gap' ? (
            <li key={item.key} className={css.Gap}>
              <Text as="span" size="T200" data-live-transcript-gap="">
                {t(GAP_KEYS[item.reason])}
              </Text>
            </li>
          ) : (
            <li key={item.key} className={css.Group}>
              <CallMemberAvatar room={room} userId={item.userId} size="200" />
              <div className={css.GroupBody}>
                <span className={css.NameRow} data-live-transcript-name="">
                  <NameWithUserId
                    name={getSenderName(room, item.userId)}
                    userId={item.userId}
                    size="T300"
                    className={css.Name}
                  />
                </span>
                {item.lines.map((line) => (
                  <Text
                    key={line.id}
                    as="p"
                    size="T300"
                    className={css.Text}
                    data-live-transcript-text=""
                    dir={textDirection(line.text) ?? 'auto'}
                  >
                    {line.text}
                  </Text>
                ))}
              </div>
            </li>
          )
        )}
      </ol>
    </div>
  );
}

type BodyProps = {
  room: Room;
  /** The room's live call, as `useLiveTranscript` reads it. */
  view: Pick<LiveTranscriptView, 'state' | 'live'>;
  /** The scrolling box's class: the side panel's body, or the window's transcript pane. */
  className: string;
  /** Who is in the call shows too (the window's stage shows them already). */
  members?: boolean;
};

/**
 * The live transcript itself, in the room's side panel and in the floating call window alike: a
 * line saying the call is transcribed, who is in it, and what each person said under their name,
 * with the gaps; or why there is nothing to show. It scrolls, newest at the bottom.
 */
export function LiveTranscriptBody({ room, view, className, members = true }: BodyProps) {
  const { t } = useTranslation();
  const { state, live } = view;
  const call = live?.call;

  // The end stays in view while the reader is there: when new lines come, and when the box
  // changes size (a divider moved, the window resized, another layout), which can hide the end
  // without a scroll event.
  const bodyRef = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  /** Where the box was scrolled to keep the end in view, until the reader scrolls elsewhere. */
  const pinnedTop = useRef<number>();
  const keepEnd = useCallback(() => {
    const body = bodyRef.current;
    if (!body || !atEnd.current) return;
    body.scrollTop = body.scrollHeight;
    pinnedTop.current = body.scrollTop;
  }, []);
  const lineCount = live?.lines.length ?? 0;
  useLayoutEffect(() => keepEnd(), [keepEnd, lineCount]);
  const getBody = useCallback(() => bodyRef.current, []);
  useResizeObserver(keepEnd, getBody);

  let content;
  if (state === 'unavailable' && !live) {
    // Nothing could be read yet: the notice says all there is.
    content = null;
  } else if (state === 'not-transcribed') {
    content = (
      <Text size="T300" priority="300">
        {t('featureUi.calls.transcription.notTranscribed')}
      </Text>
    );
  } else if (state === 'loading') {
    content = (
      <Text size="T300" priority="300">
        {t('featureUi.calls.panel.connecting')}
      </Text>
    );
  } else if (!live || !call) {
    content = (
      <Text size="T300" priority="300">
        {t('featureUi.calls.transcription.noCall')}
      </Text>
    );
  } else {
    content = (
      <>
        <div className={css.Transcribed}>
          <Icon size="100" src={Icons.Info} aria-hidden />
          <Text size="T300">{t('featureUi.calls.transcription.transcribed')}</Text>
        </div>
        {members && <Members room={room} live={live} />}
        <Lines room={room} live={live} />
      </>
    );
  }

  return (
    <div
      ref={bodyRef}
      className={className}
      onScroll={({ currentTarget: body }) => {
        // The scroll that kept the end says nothing of the reader, and comes a frame late: a box
        // that shrank since would no longer seem to be at its end.
        if (body.scrollTop === pinnedTop.current) return;
        pinnedTop.current = undefined;
        atEnd.current = body.scrollHeight - body.scrollTop - body.clientHeight < 32;
      }}
    >
      {state === 'unavailable' && (
        <div className={panelCss.Notice} role="status">
          <Icon size="200" src={Icons.Warning} />
          <Text className={panelCss.NoticeText} size="T300">
            {t('featureUi.calls.transcription.unavailable')}
          </Text>
        </div>
      )}
      {content}
    </div>
  );
}
