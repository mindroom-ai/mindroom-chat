import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { HTMLReactParserOptions } from 'html-react-parser';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import { isScrollNearBottom } from '../event-store/timeline/timelineScrollUtils';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { useResizeObserver } from '../lib/hooks/useResizeObserver';
import { formatCallDuration } from '../lib/time';
import type { LiveDocs } from '../matrix/protocol/liveFrame';
import { isActiveSubagentStatus } from '../matrix/protocol/subagentFrame';
import { RenderMessageContent } from '../messages/content/RenderMessageContent';
import { LINKIFY_OPTS } from '../messages/html/react-custom-html-parser';
import { MessageBase, ModernLayout, UsernameBold } from '../messages/layout/layout';
import { useLiveMarkdownReady } from '../messages/live/liveMarkdown';
import { liveDocsContent } from '../messages/live/useLiveReplyContent';
import { Time } from '../messages/Time';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useHour24Clock } from '../preferences/useHour24Clock';
import { Header as SidePanelHeader } from '../ui/panels/SidePanel.css';
import {
  AgentAvatar,
  RunStatus,
  SubagentRunCard,
  elapsedSeconds,
  latestTurn,
  useAgentProfile,
  type AgentProfile,
  type SubagentNode,
  type SubagentTurn,
} from './SubagentRunCard';
import * as css from './subagentsPanel.css';

/** A reader this close to the end still follows the newest text. */
const FOLLOW_SLACK_PX = 24;

const nearEnd = ({ scrollHeight, scrollTop, clientHeight }: HTMLElement): boolean =>
  isScrollNearBottom({ scrollHeight, scrollTop, clientHeight, thresholdPx: FOLLOW_SLACK_PX });

/** One message of the run, laid out as a thread's: picture, name and time, then the body. */
function RunMessage({
  sender,
  ts,
  children,
}: {
  sender: AgentProfile;
  ts: number;
  children: React.ReactNode;
}) {
  const [hour24Clock] = useHour24Clock();
  return (
    <MessageBase space="400" data-subagent-message="">
      <ModernLayout before={<AgentAvatar agent={sender} size="300" />}>
        <Box justifyContent="SpaceBetween" alignItems="Center" gap="300">
          {/* A thread's sender opens their profile; an agent's name here only names it. */}
          <Text as="span" size="T400" truncate>
            <UsernameBold>{sender.name}</UsernameBold>
          </Text>
          <Time ts={ts} hour24Clock={hour24Clock} />
        </Box>
        {children}
      </ModernLayout>
    </MessageBase>
  );
}

/** The documents as a reply's content, for `RenderMessageContent`: Markdown once its renderer is in. */
const useDocsContent = (docs: LiveDocs) => {
  const markdownReady = useLiveMarkdownReady();
  const content = useMemo(() => liveDocsContent(docs, markdownReady), [docs, markdownReady]);
  return useCallback(() => content, [content]) as <T>() => T;
};

type TurnProps = {
  room: Room;
  turn: SubagentTurn;
  /** Whether it is the sub-agent's newest turn; an older one still at it only missed its end. */
  newest: boolean;
  now: number;
  parserOptions: HTMLReactParserOptions;
  onOpen: (subagent: string) => void;
};

/**
 * One turn: the caller's task, cards for the sub-agents the turn started, then its reply as it
 * streams, with its tool calls, and why it ended when it ended badly.
 */
function RunTurn({ room, turn, newest, now, parserOptions, onOpen }: TurnProps) {
  const { t } = useTranslation();
  const { run, nested } = turn;
  const { meta } = run;
  const agent = useAgentProfile(room, meta.agent);
  const caller = useAgentProfile(room, meta.caller);
  // Only the newest turn, running, shows the typing dots: one waiting for approval still has
  // `streaming` documents and a paused or ended one `pending`, and both would read as a reply about
  // to stream. A run that wrote nothing answers with its result, unless that says why it failed.
  const working = newest && meta.status === 'running';
  const failed = (meta.status === 'failed' || meta.status === 'denied') && !!meta.result;
  const docs = useMemo((): LiveDocs => {
    const status = working ? run.docs.status : 'completed';
    const quiet = run.docs.md === '' && run.docs.tools.length === 0;
    return quiet && meta.result && !failed
      ? { ...run.docs, md: meta.result, status }
      : { ...run.docs, status };
  }, [failed, meta.result, run.docs, working]);
  const getContent = useDocsContent(docs);
  // A run that wrote nothing has no reply; one at work shows the thinking placeholder.
  const wrote = docs.md !== '' || docs.tools.length > 0 || working;

  return (
    <>
      {meta.task && (
        <RunMessage sender={caller} ts={meta.startedAt * 1000}>
          <Text
            as="p"
            size="T400"
            priority="300"
            className={css.Task}
            dir="auto"
            data-subagent-task=""
          >
            {meta.task}
          </Text>
        </RunMessage>
      )}
      {nested.length > 0 && (
        <section className={css.NestedRuns} aria-label={t('mindroomUi.subagents.title')}>
          <Text as="h3" size="L400" priority="300" className={css.Divider}>
            {t('mindroomUi.subagents.title')}
          </Text>
          <ul className={css.List}>
            {nested.map((child) => (
              <li key={child.id}>
                <SubagentRunCard room={room} node={child} now={now} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* The sub-agents it started, then its reply, which grows at the end where a reader follows it. */}
      {(wrote || failed) && (
        <RunMessage sender={agent} ts={meta.startedAt * 1000}>
          {wrote && (
            <div className={css.Reply} data-subagent-transcript="">
              <RenderMessageContent
                msgType="m.text"
                displayName={agent.name}
                roomId={room.roomId}
                threadId={meta.threadId ?? undefined}
                ts={meta.startedAt * 1000}
                getContent={getContent}
                htmlReactParserOptions={parserOptions}
                linkifyOpts={LINKIFY_OPTS}
              />
            </div>
          )}
          {failed && docs.md !== meta.result && (
            <Text as="p" size="T300" className={css.Failure} dir="auto" data-subagent-failure="">
              {meta.result}
            </Text>
          )}
        </RunMessage>
      )}
    </>
  );
}

type ViewProps = {
  room: Room;
  node: SubagentNode;
  /** The panel's clock, in Unix milliseconds. */
  now: number;
  parserOptions: HTMLReactParserOptions;
  onBack: () => void;
  onOpen: (subagent: string) => void;
  onClose: () => void;
};

/**
 * One sub-agent, as a thread shows a conversation: each turn the caller's task, cards for the
 * sub-agents that turn started, then its reply. A reader at the end follows new text until they
 * scroll up.
 */
export function SubagentRunView({
  room,
  node,
  now,
  parserOptions,
  onBack,
  onOpen,
  onClose,
}: ViewProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const { navigateRoomThread } = useRoomNavigate();
  const { run: newestRun, meta } = latestTurn(node);
  const agent = useAgentProfile(room, meta.agent);
  const active = isActiveSubagentStatus(meta.status);
  const elapsed = elapsedSeconds(meta, now);
  const { threadId } = meta;

  // A sub-agent at work opens at its newest text; an ended one at its first task.
  const box = useRef<HTMLDivElement>(null);
  const following = useRef(active);
  /** Where keeping the end left the box, so the scroll event that move fires is not the reader's. */
  const pinnedTop = useRef<number>();
  /** Whether the reader saw the end before the latest change: after it, or since they scrolled. */
  const atEnd = useRef(false);
  const keepEnd = useCallback(() => {
    const element = box.current;
    if (!element) return;
    if (following.current) {
      element.scrollTop = element.scrollHeight;
      pinnedTop.current = element.scrollTop;
    }
    atEnd.current = nearEnd(element);
  }, []);
  // A turn that starts while the reader is at the end is followed, as a sub-agent at work is on
  // opening; one who scrolled up keeps their place.
  const shownNewest = useRef(newestRun);
  useLayoutEffect(() => {
    if (shownNewest.current !== newestRun) {
      shownNewest.current = newestRun;
      if (atEnd.current) following.current = true;
    }
    keepEnd();
  }, [keepEnd, newestRun, node]);
  // Text that grows without new frames (the Markdown renderer arriving, a block unfolding).
  const getThread = useCallback(() => box.current?.firstElementChild, []);
  useResizeObserver(keepEnd, getThread);
  // The card that opened it is gone, so focus moves to the way back. Before the panel's own
  // layout effect, which gives focus to the card of a sub-agent Back closed.
  const backButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => backButton.current?.focus(), []);

  return (
    <>
      <header className={SidePanelHeader}>
        <IconButton
          ref={backButton}
          size="300"
          radii="300"
          variant="Surface"
          aria-label={t('mindroomUi.subagents.back')}
          onClick={onBack}
        >
          <Icon size="200" src={Icons.ArrowLeft} />
        </IconButton>
        <div className={css.Heading}>
          <Text as="h2" size="H4" truncate>
            {agent.name}
          </Text>
          <Text as="div" size="T200" priority="300" className={css.Standing}>
            <RunStatus status={meta.status} />
            {elapsed !== undefined && <span>{formatCallDuration(elapsed, language)}</span>}
          </Text>
        </div>
        {threadId && (
          <IconButton
            size="300"
            radii="300"
            variant="Surface"
            aria-label={t('threadActions.open')}
            title={t('threadActions.open')}
            onClick={() => navigateRoomThread(room.roomId, threadId)}
          >
            <Icon size="200" src={Icons.Thread} />
          </IconButton>
        )}
        <IconButton
          size="300"
          radii="300"
          variant="Surface"
          aria-label={t('mindroomUi.subagents.close')}
          onClick={onClose}
        >
          <Icon size="200" src={Icons.Cross} />
        </IconButton>
      </header>
      <div
        ref={box}
        className={css.Body}
        data-subagent-view={node.id}
        onScroll={({ currentTarget }) => {
          if (currentTarget.scrollTop === pinnedTop.current) return;
          pinnedTop.current = undefined;
          atEnd.current = nearEnd(currentTarget);
          following.current = atEnd.current;
        }}
      >
        <div className={css.Thread}>
          {node.turns.map((turn, index) => (
            <RunTurn
              key={turn.run.run}
              room={room}
              turn={turn}
              newest={index === node.turns.length - 1}
              now={now}
              parserOptions={parserOptions}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </>
  );
}
