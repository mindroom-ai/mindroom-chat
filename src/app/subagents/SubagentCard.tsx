import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { HTMLReactParserOptions } from 'html-react-parser';
import { Avatar, Icon, IconButton, Icons, Text } from 'folds';
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

/**
 * What the run was asked, two lines of it: runs of one agent tell apart by their tasks. When two
 * lines cut it short, a press shows all of it.
 */
function TaskExcerpt({ text }: { text: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  // Measured while it shows two lines; open, it keeps its press to close it again.
  const measure = useCallback(() => {
    const element = textRef.current;
    if (element && !open) setCut(element.scrollHeight > element.clientHeight);
  }, [open]);
  useLayoutEffect(() => measure(), [measure, text]);
  const getText = useCallback(() => textRef.current, []);
  useResizeObserver(measure, getText);

  return (
    <div className={css.TaskRow}>
      <Text
        as="p"
        ref={textRef}
        size="T200"
        priority="300"
        className={open ? css.Task : css.TaskExcerpt}
        dir="auto"
        data-subagent-task=""
      >
        {text}
      </Text>
      {(cut || open) && (
        <IconButton
          size="300"
          radii="300"
          variant="Surface"
          aria-label={t('mindroomUi.subagents.showTask')}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon size="50" src={open ? Icons.ChevronTop : Icons.ChevronBottom} />
        </IconButton>
      )}
    </div>
  );
}

type CardProps = {
  room: Room;
  node: SubagentRunNode;
  /** The panel's clock, in Unix milliseconds. */
  now: number;
  parserOptions: HTMLReactParserOptions;
  /** Inside the card of the run that started it, which says where it came from. */
  inParent?: boolean;
};

/**
 * One sub-agent run: the agent, how it stands, its task, and its transcript while it works. A
 * finished run shows its result, its transcript on request. A top-level card names its caller when
 * that is another agent and leads back to the caller's thread. The runs it started follow inside
 * it; one of those that finished well folds its result in with its transcript, as the run that
 * started it usually passes that result on.
 */
export function SubagentCard({ room, node, now, parserOptions, inParent = false }: CardProps) {
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
  const { threadId } = meta;
  // An agent that started a copy of itself would read "Harry, from Harry".
  const from =
    !inParent && meta.caller !== meta.agent
      ? t('mindroomUi.subagents.from', { name: caller })
      : null;
  const folded = inParent && meta.status === 'completed';
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
  const result = meta.result && (
    <Result
      text={meta.result}
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
            {from && <span>{from}</span>}
          </Text>
        </div>
        {!inParent && threadId && (
          <IconButton
            size="300"
            radii="300"
            variant="Surface"
            aria-label={t('threadActions.open')}
            title={t('threadActions.open')}
            onClick={() => navigateRoomThread(room.roomId, threadId)}
          >
            <Icon size="50" src={Icons.Thread} />
          </IconButton>
        )}
      </div>
      {meta.task && <TaskExcerpt text={meta.task} />}
      {!active && !folded && result}
      {/* A running run that wrote nothing yet shows the thinking placeholder; a quiet one, nothing. */}
      {active && (hasOutput || docs.status === 'streaming') && transcript}
      {!active && (hasOutput || (folded && result)) && (
        <ThreadActivity
          icon={<ActivityIcon src={Icons.Message} />}
          title={t('mindroomUi.subagents.showOutput')}
        >
          {folded && result}
          {hasOutput && transcript}
        </ThreadActivity>
      )}
      {nested.length > 0 && (
        <ul className={css.Nested}>
          {nested.map((child) => (
            <li key={child.run.run}>
              <SubagentCard
                room={room}
                node={child}
                now={now}
                parserOptions={parserOptions}
                inParent
              />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
