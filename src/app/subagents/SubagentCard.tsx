import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { HTMLReactParserOptions } from 'html-react-parser';
import { Avatar, Icons, Text } from 'folds';
import { agentMember } from '../approvals/approvalPeople';
import { UserAvatar } from '../avatars/UserAvatar';
import { isScrollNearBottom } from '../event-store/timeline/timelineScrollUtils';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { nameInitials } from '../lib/common';
import { useResizeObserver } from '../lib/hooks/useResizeObserver';
import { formatCallDuration } from '../lib/time';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../matrix/matrix';
import type { LiveDocs } from '../matrix/protocol/liveFrame';
import { isActiveSubagentStatus, type SubagentMeta } from '../matrix/protocol/subagentFrame';
import { getMemberAvatarMxc, getMemberDisplayName } from '../matrix/room';
import { RenderMessageContent } from '../messages/content/RenderMessageContent';
import { LINKIFY_OPTS } from '../messages/html/react-custom-html-parser';
import { useLiveMarkdownReady } from '../messages/live/liveMarkdown';
import type { SubagentRun } from '../messages/live/subagentRunStore';
import { liveDocsContent } from '../messages/live/useLiveReplyContent';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { ActivityIcon, ThreadActivity } from '../ui/ThreadActivity';
import * as css from './subagentsPanel.css';

/** A run and the runs it started, as the panel nests them. */
export type SubagentRunNode = { run: SubagentRun; nested: SubagentRunNode[] };

/** Pictures show 24 px wide; twice that keeps them sharp on dense screens. */
const PICTURE_SIZE = 48;
/** A reader this close to a transcript's end still follows its newest text. */
const FOLLOW_SLACK_PX = 24;

/**
 * The name and picture of the agent MindRoom calls `agent`: those of its account in the room
 * (`mindroom_<agent>`, or `mindroom_<agent>_<namespace>`), or the name itself.
 */
const useAgentProfile = (room: Room, agent: string) => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const userId = agentMember(room, agent)?.userId;
  if (!userId) return { name: agent, colorId: agent };
  const picture = getMemberAvatarMxc(room, userId);
  const src = picture
    ? mxcUrlToHttp(mx, picture, useAuthentication, PICTURE_SIZE, PICTURE_SIZE, 'crop')
    : null;
  return {
    name: getMemberDisplayName(room, userId) ?? agent,
    colorId: userId,
    avatarSrc: src ?? undefined,
  };
};

/** How long the run has been at it, or took; unknown for an ended run without an end time. */
const elapsedSeconds = (meta: SubagentMeta, now: number): number | undefined => {
  if (isActiveSubagentStatus(meta.status)) return now / 1000 - meta.startedAt;
  return meta.endedAt === null ? undefined : meta.endedAt - meta.startedAt;
};

type TranscriptProps = {
  docs: LiveDocs;
  name: string;
  roomId: string;
  threadId?: string;
  startedAt: number;
  parserOptions: HTMLReactParserOptions;
};

/**
 * What the run wrote, as a streamed reply shows it, in a box of its own that keeps the newest text
 * in view until the reader scrolls up from the end. Memoized: the panel's clock does not touch it.
 */
/** The documents as a reply's content, for `RenderMessageContent`: Markdown once its renderer is in. */
const useDocsContent = (docs: LiveDocs) => {
  const markdownReady = useLiveMarkdownReady();
  const content = useMemo(() => liveDocsContent(docs, markdownReady), [docs, markdownReady]);
  return useCallback(() => content, [content]) as <T>() => T;
};

type ResultProps = Omit<TranscriptProps, 'docs'> & { text: string };

/** A finished run's answer. Agents answer in Markdown, so it shows formatted, like the transcript. */
const Result = memo(function Result({
  text,
  name,
  roomId,
  threadId,
  startedAt,
  parserOptions,
}: ResultProps) {
  const docs = useMemo(
    (): LiveDocs => ({ md: text, reasoning: '', tools: [], status: 'completed', activity: '' }),
    [text]
  );
  const getContent = useDocsContent(docs);
  return (
    <div className={css.Result} dir="auto" data-subagent-result="">
      <RenderMessageContent
        msgType="m.text"
        displayName={name}
        roomId={roomId}
        threadId={threadId}
        ts={startedAt * 1000}
        getContent={getContent}
        htmlReactParserOptions={parserOptions}
        linkifyOpts={LINKIFY_OPTS}
      />
    </div>
  );
});

const Transcript = memo(function Transcript({
  docs,
  name,
  roomId,
  threadId,
  startedAt,
  parserOptions,
}: TranscriptProps) {
  const getContent = useDocsContent(docs);

  const box = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  /** Where keeping the end left the box, so the scroll event that move fires is not the reader's. */
  const pinnedTop = useRef<number>();
  const keepEnd = useCallback(() => {
    const element = box.current;
    if (!element || !following.current) return;
    element.scrollTop = element.scrollHeight;
    pinnedTop.current = element.scrollTop;
  }, []);
  useLayoutEffect(() => keepEnd(), [keepEnd, getContent]);
  // Text that grows without new documents (the Markdown renderer arriving, a block unfolding).
  const getText = useCallback(() => box.current?.firstElementChild, []);
  useResizeObserver(keepEnd, getText);

  return (
    <div
      ref={box}
      className={css.Transcript}
      data-subagent-transcript=""
      onScroll={({ currentTarget }) => {
        if (currentTarget.scrollTop === pinnedTop.current) return;
        pinnedTop.current = undefined;
        following.current = isScrollNearBottom({
          scrollHeight: currentTarget.scrollHeight,
          scrollTop: currentTarget.scrollTop,
          clientHeight: currentTarget.clientHeight,
          thresholdPx: FOLLOW_SLACK_PX,
        });
      }}
    >
      <div>
        <RenderMessageContent
          msgType="m.text"
          displayName={name}
          roomId={roomId}
          threadId={threadId}
          ts={startedAt * 1000}
          getContent={getContent}
          htmlReactParserOptions={parserOptions}
          linkifyOpts={LINKIFY_OPTS}
        />
      </div>
    </div>
  );
});

type CardProps = {
  room: Room;
  node: SubagentRunNode;
  /** The panel's clock, in Unix milliseconds. */
  now: number;
  parserOptions: HTMLReactParserOptions;
};

/**
 * One sub-agent run: the agent, how it stands and the caller it works for (a way back to the
 * caller's thread), its task on request, and its transcript while it works. A finished run shows
 * its result, its transcript on request. The runs it started follow inside it.
 */
export function SubagentCard({ room, node, now, parserOptions }: CardProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const nameId = useId();
  const { navigateRoomThread } = useRoomNavigate();
  const { run, nested } = node;
  const { meta } = run;
  const agent = useAgentProfile(room, meta.agent);
  const caller = useAgentProfile(room, meta.caller).name;

  const active = isActiveSubagentStatus(meta.status);
  // Only a running run shows the typing dots: one waiting for approval still has `streaming`
  // documents and a paused or ended one `pending`, and both would read as a reply about to stream.
  const docs = useMemo(
    () => (meta.status === 'running' ? run.docs : { ...run.docs, status: 'completed' }),
    [meta.status, run.docs]
  );
  const hasOutput = docs.md !== '' || docs.tools.length > 0;
  const elapsed = elapsedSeconds(meta, now);
  const from = t('mindroomUi.subagents.from', { name: caller });
  const { threadId } = meta;
  const transcript = (
    <Transcript
      docs={docs}
      name={agent.name}
      roomId={room.roomId}
      threadId={threadId ?? undefined}
      startedAt={meta.startedAt}
      parserOptions={parserOptions}
    />
  );

  return (
    <article className={css.Card} data-subagent-run={run.run} aria-labelledby={nameId}>
      <div className={css.Who}>
        <Avatar size="200" radii="Pill" aria-hidden>
          <UserAvatar
            alt=""
            userId={agent.colorId}
            src={agent.avatarSrc}
            renderFallback={() => (
              <Text as="span" size="L400">
                {nameInitials(agent.name)}
              </Text>
            )}
          />
        </Avatar>
        <div>
          <Text as="h3" id={nameId} size="T300" className={css.Name} truncate>
            {agent.name}
          </Text>
          <Text as="div" size="T200" className={css.Standing}>
            <span>
              <span className={css.StatusDot[meta.status]} />
              {t(`mindroomUi.subagents.${meta.status}`)}
            </span>
            {elapsed !== undefined && <span>{formatCallDuration(elapsed, language)}</span>}
            {threadId ? (
              <button
                type="button"
                className={css.TextButton}
                onClick={() => navigateRoomThread(room.roomId, threadId)}
              >
                {from}
              </button>
            ) : (
              <span>{from}</span>
            )}
          </Text>
        </div>
      </div>
      {!active && meta.result && (
        <Result
          text={meta.result}
          name={agent.name}
          roomId={room.roomId}
          threadId={threadId ?? undefined}
          startedAt={meta.startedAt}
          parserOptions={parserOptions}
        />
      )}
      {meta.task && (
        <ThreadActivity
          icon={<ActivityIcon src={Icons.Info} />}
          title={t('mindroomUi.subagents.showTask')}
        >
          <Text as="p" size="T300" className={css.Task} dir="auto">
            {meta.task}
          </Text>
        </ThreadActivity>
      )}
      {/* A running run that wrote nothing yet shows the thinking placeholder; a quiet one, nothing. */}
      {active && (hasOutput || docs.status === 'streaming') && transcript}
      {!active && hasOutput && (
        <ThreadActivity
          icon={<ActivityIcon src={Icons.Message} />}
          title={t('mindroomUi.subagents.showOutput')}
        >
          {transcript}
        </ThreadActivity>
      )}
      {nested.length > 0 && (
        <ul className={css.Nested}>
          {nested.map((child) => (
            <li key={child.run.run}>
              <SubagentCard room={room} node={child} now={now} parserOptions={parserOptions} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
