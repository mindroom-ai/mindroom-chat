import { useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Icon, IconButton, Icons, Text } from 'folds';
import { ownDirectionLine, textDirection } from '../../ui/directional';
import { CallMemberAvatar } from '../CallTile';
import type { TranscriptLine } from './api';
import { PauseControl } from './PauseControl';
import { nameInCall, type LiveTranscript } from './transcriptionState';
import { useLiveTranscript } from './useLiveTranscript';
import * as panelCss from '../CallPanel.css';
import * as css from './LiveTranscriptPanel.css';

/** The panel reads the live call this often while it shows a call this device is not in. */
const READ_MS = 2_000;

const GAP_KEYS = {
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

/** Who is in the call, by their avatar and name. */
function Members({ room, live }: { room: Room; live: LiveTranscript }) {
  const { t } = useTranslation();
  const members = live.call?.members ?? [];
  return (
    <ul className={css.Members} aria-label={t('featureUi.calls.transcription.inCall')}>
      {members.map((userId) => (
        <li key={userId} className={css.Member}>
          <CallMemberAvatar room={room} userId={userId} size="200" />
          <Text as="span" size="T300" truncate data-live-transcript-member="" {...ownDirectionLine}>
            {nameInCall(room, live, userId)}
          </Text>
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
                <Text
                  as="span"
                  size="T300"
                  truncate
                  className={css.Name}
                  data-live-transcript-name=""
                  {...ownDirectionLine}
                >
                  {nameInCall(room, live, item.userId)}
                </Text>
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

/**
 * The live transcript of the room's call, in the room's side panel: a line saying the call is
 * transcribed, who is in it, and what each person said under their name, with the gaps. Pause is
 * in its header while it shows this device's call.
 */
export function LiveTranscriptPanel({ room, onClose }: { room: Room; onClose: () => void }) {
  const { t } = useTranslation();
  const { state, live, ownCall } = useLiveTranscript(room, READ_MS);
  const call = live?.call;
  const title = t('featureUi.calls.transcription.liveTranscript');

  // New lines keep the end in view while the reader is there.
  const bodyRef = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const lineCount = live?.lines.length ?? 0;
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body && atEnd.current) body.scrollTop = body.scrollHeight;
  }, [lineCount]);

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
        <Members room={room} live={live} />
        <Lines room={room} live={live} />
      </>
    );
  }

  return (
    <section className={panelCss.Panel} aria-label={title} data-testid="live-transcript-panel">
      <header className={panelCss.Header}>
        <div className={panelCss.HeaderTitle}>
          <Text as="h2" size="H4" truncate>
            {title}
          </Text>
          {call && (
            <Text size="T200" priority="300" truncate>
              {t('featureUi.calls.panel.inCall', { count: call.members.length })}
            </Text>
          )}
        </div>
        <div className={css.HeaderActions}>
          {ownCall && state === 'live' && call && <PauseControl room={room} small />}
          <IconButton
            size="300"
            radii="300"
            variant="Surface"
            aria-label={t('featureUi.calls.transcription.close')}
            onClick={onClose}
          >
            <Icon size="200" src={Icons.Cross} />
          </IconButton>
        </div>
      </header>
      <div
        ref={bodyRef}
        className={panelCss.Body}
        onScroll={({ currentTarget: body }) => {
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
    </section>
  );
}
