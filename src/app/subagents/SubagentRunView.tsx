import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { HTMLReactParserOptions } from 'html-react-parser';
import { Box, Icon, IconButton, Icons, Spinner, Text } from 'folds';
import { IconPlayerStopFilled } from '@tabler/icons-react';
import { useAtomValue } from 'jotai';
import classNames from 'classnames';
import { isScrollNearBottom } from '../event-store/timeline/timelineScrollUtils';
import { subagentsPanelAtom } from '../navigation/subagentsPanel';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { useResizeObserver } from '../lib/hooks/useResizeObserver';
import { formatWorkDuration } from '../lib/time';
import type { LiveDocs } from '../matrix/protocol/liveFrame';
import {
  isActiveSubagentStatus,
  isRestartInterrupted,
  type SubagentUsage,
} from '../matrix/protocol/subagentFrame';
import { getAiRunCompactModelLabel, getAiRunModelLabel } from '../matrix/protocol/aiRunModelLabel';
import { formatCostUsd } from '../messages/agent-run/aiRunDisplay';
import { ToolCallClockContext } from '../messages/agent-run/toolCallStatus';
import { RenderMessageContent } from '../messages/content/RenderMessageContent';
import { LINKIFY_OPTS } from '../messages/html/react-custom-html-parser';
import { MessageBase, ModernLayout, UsernameBold } from '../messages/layout/layout';
import { useLiveMarkdownReady } from '../messages/live/liveMarkdown';
import { liveDocsContent } from '../messages/live/useLiveReplyContent';
import { Time } from '../messages/Time';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { settingsAtom } from '../preferences/settings';
import { useHour24Clock } from '../preferences/useHour24Clock';
import { useSettingValue } from '../preferences/useSettingValue';
import { Header as SidePanelHeader } from '../ui/panels/SidePanel.css';
import { AgentAvatar, useAgentProfile, type AgentProfile } from './AgentAvatar';
import { RunLogo, runLogoState } from './RunLogo';
import { runToolCall } from './runActivity';
import { formatTokens, runTotals, usageTexts, type RunTotals } from './runUsage';
import {
  RunStatus,
  SubagentRunCard,
  ToolCallText,
  latestTurn,
  nodeTitle,
  turnTitle,
  useRunTime,
  type SubagentNode,
  type SubagentTurn,
} from './SubagentRunCard';
import * as css from './subagentsPanel.css';
import { useRunStop } from './useRunStop';

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
  const ended = !newest || !isActiveSubagentStatus(meta.status);
  const didNotComplete =
    meta.status === 'failed' || meta.status === 'cancelled' || meta.status === 'denied';
  const failed = (meta.status === 'failed' || meta.status === 'denied') && !!meta.result;
  const interrupted = isRestartInterrupted(meta);
  const docs = useMemo((): LiveDocs => {
    const status = working ? run.docs.status : 'completed';
    // An ended turn (or an older turn whose end frame was missed) cannot still run a tool call;
    // settle any lingering started entries so the transcript and cog stop spinning.
    const tools =
      ended && run.docs.tools.some((tool) => tool.type === 'tool_call_started')
        ? run.docs.tools.map((tool) =>
            tool.type === 'tool_call_started'
              ? {
                  ...tool,
                  type: 'tool_call_completed',
                  ...(didNotComplete ? { is_error: true } : {}),
                }
              : tool
          )
        : run.docs.tools;
    const quiet = run.docs.md === '' && tools.length === 0;
    return quiet && meta.result && !failed
      ? { ...run.docs, md: meta.result, status, tools }
      : { ...run.docs, status, tools };
  }, [didNotComplete, ended, failed, meta.result, run.docs, working]);
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
            data-subagent-turn={run.run}
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
              {/* Its running calls show how long they have run while the turn is at it; an
                  ended turn's call that never completed has no clock to grow on. */}
              <ToolCallClockContext.Provider value={working ? now : undefined}>
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
              </ToolCallClockContext.Provider>
            </div>
          )}
          {failed && docs.md !== meta.result && (
            <Text
              as="p"
              size="T300"
              priority={interrupted ? '300' : undefined}
              className={interrupted ? css.Interruption : css.Failure}
              dir="auto"
              data-subagent-failure={interrupted ? undefined : ''}
              data-subagent-interruption={interrupted ? '' : undefined}
            >
              {meta.result}
            </Text>
          )}
        </RunMessage>
      )}
    </>
  );
}

/** What every run below `node` used, its own turns excluded. */
const nestedTotals = (node: SubagentNode): RunTotals => {
  const below: (SubagentUsage | undefined)[] = [];
  const add = (child: SubagentNode) =>
    child.turns.forEach(({ run, nested }) => {
      below.push(run.meta.usage);
      nested.forEach(add);
    });
  node.turns.forEach(({ nested }) => nested.forEach(add));
  return runTotals(below);
};

/**
 * Under the open run's header, four cells: how it stands and its time, its calls and turns, its
 * tokens in and out, and its cost with what the runs it started cost. The numbers are all its
 * turns' (`runTotals`); a count it does not send is left out. In the Usage disclosure
 * its cells are what it used alone.
 */
function RunStrip({ node, totals, time }: { node: SubagentNode; totals: RunTotals; time: string }) {
  const details = useSettingValue(settingsAtom, 'showUsageDetails');
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const { meta } = latestTurn(node);
  const texts = usageTexts(totals, t, language);
  const below = nestedTotals(node);
  let costNote: string | undefined;
  if (!below.tokens) costNote = t('mindroomUi.subagents.costOwn');
  else if (below.costUsd !== undefined)
    costNote = t('mindroomUi.subagents.costNested', {
      cost: formatCostUsd(below.costUsd, language),
    });
  const status = {
    key: 'status',
    name: t('mindroomUi.subagents.status'),
    value: <RunStatus meta={meta} />,
    note: time,
  };
  const used = [
    {
      key: 'calls',
      name: t('mindroomUi.backgroundJobs.column.calls'),
      value: texts.calls?.compact ?? '0',
      note:
        node.turns.length > 1
          ? t('mindroomUi.subagents.turns', { count: node.turns.length })
          : t('mindroomUi.subagents.toolCallsNote'),
    },
    {
      key: 'tokens',
      name: t('mindroomUi.backgroundJobs.column.tokens'),
      value: texts.tokens?.compact ?? '0',
      note: t('mindroomUi.subagents.tokensSplit', {
        input: formatTokens(totals.inputTokens ?? 0, language),
        output: formatTokens(totals.outputTokens ?? 0, language),
      }),
    },
    ...(texts.cost
      ? [
          {
            key: 'cost',
            name: t('mindroomUi.backgroundJobs.column.cost'),
            value: texts.cost.compact,
            note: costNote,
          },
        ]
      : []),
  ];
  const cells = details ? [status, ...used] : used;
  const strip = (
    <dl className={css.Strip} data-subagent-strip="">
      {cells.map((cell) => (
        <div key={cell.key} className={css.StripCell} data-subagent-cell={cell.key}>
          <Text as="dt" size="T200" priority="300" className={css.StripName}>
            {cell.name}
          </Text>
          <Text as="dd" size="T300" className={css.StripValue}>
            {cell.value}
          </Text>
          <Text
            as="dd"
            size="T200"
            priority="300"
            className={css.StripNote}
            title={cell.note}
            truncate
          >
            {cell.note ?? ' '}
          </Text>
        </div>
      ))}
    </dl>
  );
  return details ? (
    strip
  ) : (
    <details className={css.Usage} data-subagent-usage="">
      <summary className={css.UsageSummary}>
        <Icon size="50" src={Icons.ChevronRight} className={css.UsageChevron} aria-hidden />
        {t('mindroomUi.subagents.usage')}
      </summary>
      {strip}
    </details>
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
  /** The conversation the panel lists runs of; a run in it needs no button to its thread. */
  viewThreadId?: string | null;
  /** A fork draft is on screen: its thread is read-only there, so no run of it can be stopped. */
  readOnly?: boolean;
  /** Inert swipe preview underneath a sliding child run: must not steal focus or scroll the page. */
  preview?: boolean;
};

/**
 * One sub-agent, as a thread shows a conversation: each turn the caller's task, cards for the
 * sub-agents that turn started, then its reply. A reader at the end follows new text until they
 * scroll up. Without the usage details (`showUsageDetails`) no line says what it does now, and what
 * it used folds into a closed Usage; its model stays in the header.
 */
export function SubagentRunView({
  room,
  node,
  now,
  parserOptions,
  onBack,
  onOpen,
  onClose,
  viewThreadId,
  readOnly = false,
  preview = false,
}: ViewProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const { navigateRoomThread } = useRoomNavigate();
  const newest = latestTurn(node);
  const { run: newestRun, meta } = newest;
  const agent = useAgentProfile(room, meta.agent);
  const active = isActiveSubagentStatus(meta.status);
  const details = useSettingValue(settingsAtom, 'showUsageDetails');
  const modelLabel = meta.model && getAiRunCompactModelLabel(meta.model);
  const { threadId } = meta;
  const first = node.turns[0].run.meta;
  const title = nodeTitle(node, agent.name);
  const time = useRunTime(meta, now);
  const totals = useMemo(() => runTotals(node.turns.map(({ run }) => run.meta.usage)), [node]);
  const used = totals.calls !== undefined;
  // Stop cancels the newest turn's job, so it is named for that turn's task.
  const turnName = turnTitle(meta, agent.name);
  const stop = useRunStop(room, newest, turnName, readOnly);
  const activity = details ? runToolCall(newest) : undefined;
  const stopLabel = t('mindroomUi.backgroundJobs.stopTaskFor', { tool: turnName });
  // A pressed Stop turns into "Stopping…", so focus moves to the run's title.
  const heading = useRef<HTMLHeadingElement>(null);

  // A sub-agent at work opens at its newest text; an ended one at its first task.
  const box = useRef<HTMLDivElement>(null);
  // Opened for one of its turns (the jobs bar's Open), it opens at that turn's task.
  const opened = useAtomValue(subagentsPanelAtom);
  const asked = opened?.run;
  const openAt = node.turns.some(({ run }) => run.run === asked) ? asked : undefined;
  const following = useRef(active && !openAt);
  /** Where keeping the end left the box, so the scroll event that move fires is not the reader's. */
  const pinnedTop = useRef<number>(undefined);
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
  // Each Open asks anew (a new atom value); frames do not.
  useLayoutEffect(() => {
    if (preview || !openAt) return;
    following.current = false;
    box.current?.querySelector(`[data-subagent-turn="${openAt}"]`)?.scrollIntoView();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on each Open
  }, [opened, preview]);
  // Text that grows without new frames (the Markdown renderer arriving, a block unfolding), or a box
  // that shrinks (the Usage above it opening).
  const getThread = useCallback(
    () =>
      [box.current, box.current?.firstElementChild].filter(
        (element): element is Element => !!element
      ),
    []
  );
  useResizeObserver(keepEnd, getThread);
  // The card that opened it is gone, so focus moves to the way back. Before the panel's own
  // layout effect, which gives focus to the card of a sub-agent Back closed.
  const backButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!preview) backButton.current?.focus();
  }, [preview]);

  return (
    <>
      <header className={classNames(SidePanelHeader, css.RunHeader)}>
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
        <RunLogo
          model={meta.model}
          agent={agent}
          kind="agent"
          state={runLogoState(meta)}
          className={css.HeaderLogo}
        />
        <div className={css.Heading}>
          <Text
            ref={heading}
            as="h2"
            size="H4"
            tabIndex={-1}
            className={css.RunTitle}
            title={first.task}
            dir="auto"
          >
            {title}
          </Text>
          <Text as="div" size="T200" priority="300" className={css.Standing}>
            <span className={css.StandingModel} data-subagent-agent="">
              {agent.name}
            </span>
            {modelLabel && (
              <span
                className={css.StandingModel}
                title={meta.model && getAiRunModelLabel(meta.model)}
                data-subagent-model=""
              >
                {modelLabel}
              </span>
            )}
            {node.turns.length > 1 && (
              <span>{t('mindroomUi.subagents.turnNumber', { number: node.turns.length })}</span>
            )}
            {/* Without what the run used (older MindRoom), or with it folded away, how it stands
                stays up here. */}
            {(!used || !details) && (
              <>
                <RunStatus meta={meta} />
                <span>{time}</span>
              </>
            )}
          </Text>
        </div>
        {threadId && threadId !== viewThreadId && (
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
        {active && stop.stopping && (
          <span className={css.HeaderStopping} title={t('mindroomUi.backgroundJobs.stopping')}>
            <Spinner size="100" variant="Secondary" aria-hidden />
            <span className={css.VisuallyHidden}>{t('mindroomUi.backgroundJobs.stopping')}</span>
          </span>
        )}
        {active && stop.stop && (
          <IconButton
            size="300"
            radii="300"
            variant="Surface"
            className={css.HeaderStop}
            aria-label={stopLabel}
            title={stopLabel}
            onClick={() => {
              heading.current?.focus();
              stop.stop?.();
            }}
            data-subagent-stop=""
          >
            <IconPlayerStopFilled size={16} aria-hidden />
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
      {used && <RunStrip node={node} totals={totals} time={time} />}
      {activity && (
        <Text as="div" size="T200" className={css.NowLine} data-subagent-now="">
          {meta.status === 'running' ? (
            <>
              <span className={css.Tick} aria-hidden />
              <span className={css.VisuallyHidden}>{t('mindroomUi.subagents.now')}</span>
            </>
          ) : (
            <span className={css.LineLabel.approval}>
              <span className={css.LineMark} aria-hidden>
                !
              </span>
              {t('mindroomUi.subagents.needsApproval')}
            </span>
          )}
          <ToolCallText activity={activity} />
          {meta.status === 'running' && activity.startedAt !== undefined && (
            <span className={css.NowTime}>
              {formatWorkDuration(Math.max(0, now - activity.startedAt * 1000), language)}
            </span>
          )}
        </Text>
      )}
      {stop.failure && (
        <Text as="div" size="T200" role="alert" className={css.StopFailure}>
          {stop.failure}
        </Text>
      )}
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
