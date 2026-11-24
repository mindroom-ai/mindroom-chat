import { use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Icon, IconButton, Icons, Text } from 'folds';
import { useAtomValue } from 'jotai';
import { useInert } from '../lib/hooks/useInert';
import { useInterval } from '../lib/hooks/useInterval';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useLoadedRoomMembers } from '../matrix/hooks/useLoadedRoomMembers';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { isActiveSubagentStatus } from '../matrix/protocol/subagentFrame';
import { getReactCustomHtmlParser, LINKIFY_OPTS } from '../messages/html/react-custom-html-parser';
import {
  countActiveSubagents,
  runsStartedIn,
  useRoomSubagentRuns,
  type SubagentRun,
} from '../messages/live/subagentRunStore';
import { useMentionClickHandler } from '../messages/useMentionClickHandler';
import {
  animateSwipeElements,
  type InteractiveSwipeScene,
  SWIPE_PRIORITY,
} from '../navigation/interactiveSwipe';
import { RoomPanelEdgeSwipeContext } from '../navigation/roomPanelEdgeSwipeContext';
import { subagentsPanelAtom } from '../navigation/subagentsPanel';
import { useEdgeSwipeBack } from '../navigation/useEdgeSwipeBack';
import { settingsAtom } from '../preferences/settings';
import { useSettingValue } from '../preferences/useSettingValue';
import { Header as SidePanelHeader } from '../ui/panels/SidePanel.css';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { runTotals, usageTexts } from './runUsage';
import { SubagentRunCard, latestTurn, type SubagentNode } from './SubagentRunCard';
import { SubagentRunView } from './SubagentRunView';
import * as css from './subagentsPanel.css';

/** How often a running run's time moves on. */
const CLOCK_MS = 1_000;
const NOOP = () => undefined;

/**
 * Sub-agents at work first, the one that started first on top; then the finished, the last to end
 * first. A sub-agent stands as its newest turn does.
 */
const panelOrder = (a: SubagentNode, b: SubagentNode): number => {
  const [aNewest, bNewest] = [latestTurn(a).meta, latestTurn(b).meta];
  const aRuns = isActiveSubagentStatus(aNewest.status);
  if (aRuns !== isActiveSubagentStatus(bNewest.status)) return aRuns ? -1 : 1;
  if (aRuns) return a.turns[0].run.meta.startedAt - b.turns[0].run.meta.startedAt;
  return (bNewest.endedAt ?? bNewest.startedAt) - (aNewest.endedAt ?? aNewest.startedAt);
};

/**
 * The runs as sub-agents, each its turns in the order they started. A sub-agent sits under the
 * turn that started its first turn while that turn is listed, else on its own. Each sub-agent has
 * one such place, so the nesting ends; sub-agents that started each other in a ring, which
 * MindRoom never sends, are left out.
 */
const nestSubagents = (runs: readonly SubagentRun[]): SubagentNode[] => {
  const turnsOf = new Map<string, [SubagentRun, ...SubagentRun[]]>();
  runs.forEach((run) => {
    const turns = turnsOf.get(run.meta.subagent);
    if (turns) turns.push(run);
    else turnsOf.set(run.meta.subagent, [run]);
  });
  const subagentOf = new Map(runs.map(({ run, meta }) => [run, meta.subagent]));
  const startedBy = new Map<string, string[]>();
  const parents = new Map<string, string>();
  const unnested: string[] = [];
  turnsOf.forEach((turns, subagent) => {
    turns.sort((a, b) => a.meta.startedAt - b.meta.startedAt);
    const { parent } = turns[0].meta;
    const parentSubagent = parent === null ? undefined : subagentOf.get(parent);
    if (parent !== null && parentSubagent !== undefined && parentSubagent !== subagent) {
      startedBy.set(parent, [...(startedBy.get(parent) ?? []), subagent]);
      parents.set(subagent, parentSubagent);
    } else {
      unnested.push(subagent);
    }
  });
  const turn = (run: SubagentRun) => ({ run, nested: arrange(startedBy.get(run.run) ?? []) });
  const arrange = (level: readonly string[]): SubagentNode[] =>
    level
      .flatMap((id): SubagentNode[] => {
        const [first, ...later] = turnsOf.get(id) ?? [];
        if (!first) return [];
        return [{ id, parent: parents.get(id) ?? null, turns: [turn(first), ...later.map(turn)] }];
      })
      .sort(panelOrder);
  return arrange(unnested);
};

/** Every listed sub-agent by its ID, those nested in others too. */
const subagentsById = (nodes: readonly SubagentNode[]): Map<string, SubagentNode> => {
  const byId = new Map<string, SubagentNode>();
  const add = (node: SubagentNode) => {
    byId.set(node.id, node);
    node.turns.forEach(({ nested }) => nested.forEach(add));
  };
  nodes.forEach(add);
  return byId;
};

/**
 * The room's live sub-agents, in the room's side panel, as the room's compact view shows threads:
 * a card per sub-agent its agents started in the conversation on screen (`threadId`, as
 * `runsStartedIn` takes it), with how many are still at it in the header. Pressing a card shows
 * that sub-agent's turns as a thread, with cards for the sub-agents it started; Back leads to the
 * sub-agent that started it, or to the list.
 */
export function SubagentsPanel({
  room,
  threadId,
  onClose,
  readOnly = false,
}: {
  room: Room;
  threadId?: string | null;
  onClose: () => void;
  /** A fork draft is on screen, whose thread's jobs no Stop may cancel. */
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const roomRuns = useRoomSubagentRuns(room.roomId);
  const runs = useMemo(() => runsStartedIn(roomRuns, threadId), [roomRuns, threadId]);
  const nodes = useMemo(() => nestSubagents(runs), [runs]);
  const byId = useMemo(() => subagentsById(nodes), [nodes]);
  const active = countActiveSubagents(runs);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId === null ? undefined : byId.get(openId);
  const section = useRef<HTMLElement>(null);
  // Opened for a sub-agent (Open in the jobs bar), the panel shows its run, once it lists it: the
  // room may first have to show the run's conversation. Each opening asks once.
  const opened = useAtomValue(subagentsPanelAtom);
  const asked = useRef<typeof opened>(undefined);
  useEffect(() => {
    const wanted = opened?.roomId === room.roomId ? opened.run : undefined;
    const subagent = runs.find(({ run }) => run === wanted)?.meta.subagent;
    if (asked.current === opened || subagent === undefined || !byId.has(subagent)) return;
    asked.current = opened;
    setOpenId(subagent);
  }, [byId, opened, room.roomId, runs]);
  // A sub-agent the store let go (no frame for a while) closes, so its next frame does not reopen
  // it; the focus its view held goes to the panel, not the page.
  useEffect(() => {
    if (openId === null || open) return;
    setOpenId(null);
    if (document.activeElement === document.body) section.current?.focus();
  }, [open, openId]);
  // Back gives focus to the card of the sub-agent it closed, as the reader left it.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const back = useCallback(() => {
    setReturnTo(open?.id ?? null);
    setOpenId(open?.parent ?? null);
  }, [open]);
  const [peekingBack, setPeekingBack] = useState(false);
  const underLayerRef = useRef<HTMLDivElement>(null);
  const detailLayerRef = useRef<HTMLDivElement>(null);
  useInert(underLayerRef, peekingBack);
  useEffect(() => {
    if (!open && peekingBack) setPeekingBack(false);
  }, [open, peekingBack]);
  const openRef = useLatestRef(open);
  const backRef = useLatestRef(back);
  const beginDetailBack = useCallback(
    ({ dirSign }: { axisSign: 1 | -1; dirSign: 1 | -1 }): InteractiveSwipeScene | null => {
      const currentOpen = openRef.current;
      const rootEl = section.current;
      const detailEl = detailLayerRef.current;
      if (!currentOpen || !rootEl || !detailEl) return null;
      const extent = rootEl.getBoundingClientRect().width;
      if (extent <= 0) return null;

      const startOpenId = currentOpen.id;
      flushSync(() => setPeekingBack(true));
      const underEl = underLayerRef.current;
      if (!underEl) {
        flushSync(() => setPeekingBack(false));
        return null;
      }

      detailEl.dataset.swiping = '';
      detailEl.dataset.swipeShadow = '';
      underEl.dataset.swiping = '';

      const applyPositions = (offsetPx: number, progress: number) => {
        detailEl.style.translate = `${offsetPx * dirSign}px 0`;
        underEl.style.translate = `${-0.3 * extent * (1 - progress) * dirSign}px 0`;
      };
      applyPositions(0, 0);

      const clearStyles = () => {
        delete detailEl.dataset.swiping;
        delete detailEl.dataset.swipeShadow;
        detailEl.style.translate = '';
        delete underEl.dataset.swiping;
        underEl.style.translate = '';
      };

      return {
        extent,
        update(offsetPx, progress) {
          applyPositions(offsetPx, progress);
        },
        settle(commit, durationMs, currentOffsetPx) {
          const currentProgress =
            extent > 0 ? Math.min(1, Math.max(0, currentOffsetPx / extent)) : 0;
          const startDetailX = currentOffsetPx * dirSign;
          const targetDetailX = (commit ? extent : 0) * dirSign;
          const startUnderX = -0.3 * extent * (1 - currentProgress) * dirSign;
          const targetUnderX = (commit ? 0 : -0.3 * extent) * dirSign;
          return animateSwipeElements(
            [
              {
                element: detailEl,
                keyframes: [
                  { translate: `${startDetailX}px 0` },
                  { translate: `${targetDetailX}px 0` },
                ],
              },
              {
                element: underEl,
                keyframes: [
                  { translate: `${startUnderX}px 0` },
                  { translate: `${targetUnderX}px 0` },
                ],
              },
            ],
            durationMs
          );
        },
        commit() {
          if (openRef.current?.id !== startOpenId) return;
          flushSync(() => {
            setPeekingBack(false);
            backRef.current();
          });
          clearStyles();
        },
        cleanup() {
          clearStyles();
          setPeekingBack(false);
        },
      };
    },
    [backRef, openRef]
  );
  // On a phone the panel covers the conversation, whose thread then leaves its back swipe: inside a
  // Room, Room owns closing from the list while a detail run outranks it to go back interactively.
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  useEdgeSwipeBack(open ? back : onClose, mobile && (!!open || !use(RoomPanelEdgeSwipeContext)), {
    priority: open ? SWIPE_PRIORITY.PANEL_INNER : SWIPE_PRIORITY.PANEL,
    begin: open ? beginDetailBack : undefined,
  });
  useLayoutEffect(() => {
    if (returnTo === null) return;
    const cards = section.current?.querySelectorAll<HTMLElement>('[data-subagent]') ?? [];
    [...cards].find((card) => card.dataset.subagent === returnTo)?.focus();
    setReturnTo(null);
  }, [openId, returnTo]);
  // One clock for every card, ticking only while a run is at it.
  const [now, setNow] = useState(Date.now);
  useInterval(() => setNow(Date.now()), active > 0 ? CLOCK_MS : -1);
  // Agents show by the room's names for them, which may not have loaded yet.
  useLoadedRoomMembers(mx, [room.roomId]);

  const useAuthentication = useMediaAuthentication();
  const openMention = useMentionClickHandler(room.roomId);
  const parserOptions = useMemo(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, {
        linkifyOpts: LINKIFY_OPTS,
        useAuthentication,
        handleMentionClick: openMention,
      }),
    [mx, openMention, room.roomId, useAuthentication]
  );
  const title = t('mindroomUi.subagents.title');
  // Under the title: how many are at it, then what every run of the conversation used, which only
  // the usage details show.
  const language = useAppLanguageCode();
  const details = useSettingValue(settingsAtom, 'showUsageDetails');
  const totals = useMemo(() => runTotals(runs.map(({ meta }) => meta.usage)), [runs]);
  const { calls, tokens, cost } = usageTexts(details ? totals : {}, t, language);
  const subtitle = [
    active > 0 && t('mindroomUi.subagents.count', { count: active }),
    calls?.labelled,
    tokens?.labelled,
    cost?.labelled,
  ]
    .filter((part): part is string => !!part)
    .join(' · ');

  const parentNode = open?.parent ? byId.get(open.parent) : undefined;
  const renderList = () => (
    <>
      <header className={SidePanelHeader}>
        <div className={css.Heading}>
          <Text as="h2" size="H4" truncate>
            {title}
          </Text>
          {subtitle && (
            <Text size="T200" priority="300" truncate data-subagents-totals="">
              {subtitle}
            </Text>
          )}
        </div>
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
      <div className={css.Body}>
        {nodes.length === 0 ? (
          <Text size="T300" priority="300" className={css.Empty}>
            {t(threadId ? 'mindroomUi.subagents.emptyThread' : 'mindroomUi.subagents.empty')}
          </Text>
        ) : (
          <ul className={css.List}>
            {nodes.map((node) => (
              <li key={node.id}>
                <SubagentRunCard room={room} node={node} now={now} onOpen={setOpenId} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );

  return (
    <section
      ref={section}
      tabIndex={-1}
      className={css.Panel}
      aria-label={title}
      data-testid="subagents-panel"
    >
      {open ? (
        <>
          {peekingBack && (
            <div
              ref={underLayerRef}
              className={css.UnderLayer}
              data-subagents-swipe-under=""
              aria-hidden="true"
            >
              {parentNode ? (
                <SubagentRunView
                  key={parentNode.id}
                  room={room}
                  node={parentNode}
                  now={now}
                  parserOptions={parserOptions}
                  onBack={NOOP}
                  onOpen={NOOP}
                  onClose={NOOP}
                  viewThreadId={threadId}
                  readOnly={readOnly}
                  preview
                />
              ) : (
                renderList()
              )}
            </div>
          )}
          <div
            ref={detailLayerRef}
            key="detail"
            className={css.DetailLayer}
            data-subagents-swipe-detail=""
          >
            <SubagentRunView
              key={open.id}
              room={room}
              node={open}
              now={now}
              parserOptions={parserOptions}
              onBack={back}
              onOpen={setOpenId}
              onClose={onClose}
              viewThreadId={threadId}
              readOnly={readOnly}
            />
          </div>
        </>
      ) : (
        renderList()
      )}
    </section>
  );
}
