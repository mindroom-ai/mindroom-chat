import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Icon, IconButton, Icons, Text } from 'folds';
import { useInterval } from '../lib/hooks/useInterval';
import { useLoadedRoomMembers } from '../matrix/hooks/useLoadedRoomMembers';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { isActiveSubagentStatus } from '../matrix/protocol/subagentFrame';
import { getReactCustomHtmlParser, LINKIFY_OPTS } from '../messages/html/react-custom-html-parser';
import {
  countActiveSubagentRuns,
  useRoomSubagentRuns,
  type SubagentRun,
} from '../messages/live/subagentRunStore';
import { useMentionClickHandler } from '../messages/useMentionClickHandler';
import { Header as SidePanelHeader } from '../ui/panels/SidePanel.css';
import { SubagentRunCard, type SubagentRunNode } from './SubagentRunCard';
import { SubagentRunView } from './SubagentRunView';
import * as css from './subagentsPanel.css';

/** How often a running run's time moves on. */
const CLOCK_MS = 1_000;

/** Running runs first, the one that started first on top; then the finished, the last to end first. */
const panelOrder = (a: SubagentRun, b: SubagentRun): number => {
  const aRuns = isActiveSubagentStatus(a.meta.status);
  if (aRuns !== isActiveSubagentStatus(b.meta.status)) return aRuns ? -1 : 1;
  if (aRuns) return a.meta.startedAt - b.meta.startedAt;
  return (b.meta.endedAt ?? b.meta.startedAt) - (a.meta.endedAt ?? a.meta.startedAt);
};

/**
 * Each run under the run that started it while that one is listed too, else on its own. Every run
 * has one parent, so the nesting ends; runs whose parents name each other in a ring, which MindRoom
 * never sends, are left out.
 */
const nestRuns = (runs: readonly SubagentRun[]): SubagentRunNode[] => {
  const listed = new Set(runs.map(({ run }) => run));
  const startedBy = new Map<string, SubagentRun[]>();
  const unnested: SubagentRun[] = [];
  runs.forEach((run) => {
    const { parent } = run.meta;
    if (parent && parent !== run.run && listed.has(parent)) {
      startedBy.set(parent, [...(startedBy.get(parent) ?? []), run]);
    } else {
      unnested.push(run);
    }
  });
  const arrange = (level: readonly SubagentRun[]): SubagentRunNode[] =>
    [...level]
      .sort(panelOrder)
      .map((run) => ({ run, nested: arrange(startedBy.get(run.run) ?? []) }));
  return arrange(unnested);
};

/** Every listed run by its ID, those nested in others too. */
const runsById = (nodes: readonly SubagentRunNode[]): Map<string, SubagentRunNode> => {
  const byId = new Map<string, SubagentRunNode>();
  const add = (node: SubagentRunNode) => {
    byId.set(node.run.run, node);
    node.nested.forEach(add);
  };
  nodes.forEach(add);
  return byId;
};

/**
 * The room's live sub-agent runs, in the room's side panel, as the room's compact view shows
 * threads: a card per run its agents started, with how many are still at it in the header.
 * Pressing a card shows that run as a thread, with cards for the runs it started; Back leads to
 * the run that started it, or to the list.
 */
export function SubagentsPanel({ room, onClose }: { room: Room; onClose: () => void }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const runs = useRoomSubagentRuns(room.roomId);
  const nodes = useMemo(() => nestRuns(runs), [runs]);
  const byId = useMemo(() => runsById(nodes), [nodes]);
  const active = countActiveSubagentRuns(runs);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const open = openRun === null ? undefined : byId.get(openRun);
  const section = useRef<HTMLElement>(null);
  // A run the store let go (no frame for a while) closes, so its next frame does not reopen it;
  // the focus its view held goes to the panel, not the page.
  useEffect(() => {
    if (openRun === null || open) return;
    setOpenRun(null);
    if (document.activeElement === document.body) section.current?.focus();
  }, [open, openRun]);
  // Back gives focus to the card of the run it closed, as the reader left it.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const back = useCallback(() => {
    const parent = open?.run.meta.parent;
    setReturnTo(open?.run.run ?? null);
    setOpenRun(parent && byId.has(parent) ? parent : null);
  }, [byId, open]);
  useLayoutEffect(() => {
    if (returnTo === null) return;
    const cards = section.current?.querySelectorAll<HTMLElement>('[data-subagent-run]') ?? [];
    [...cards].find((card) => card.dataset.subagentRun === returnTo)?.focus();
    setReturnTo(null);
  }, [openRun, returnTo]);
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

  return (
    <section
      ref={section}
      tabIndex={-1}
      className={css.Panel}
      aria-label={title}
      data-testid="subagents-panel"
    >
      {open ? (
        <SubagentRunView
          key={open.run.run}
          room={room}
          node={open}
          now={now}
          parserOptions={parserOptions}
          onBack={back}
          onOpen={setOpenRun}
          onClose={onClose}
        />
      ) : (
        <>
          <header className={SidePanelHeader}>
            <div className={css.Heading}>
              <Text as="h2" size="H4" truncate>
                {title}
              </Text>
              {active > 0 && (
                <Text size="T200" priority="300" truncate>
                  {t('mindroomUi.subagents.count', { count: active })}
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
                {t('mindroomUi.subagents.empty')}
              </Text>
            ) : (
              <ul className={css.List}>
                {nodes.map((node) => (
                  <li key={node.run.run}>
                    <SubagentRunCard room={room} node={node} now={now} onOpen={setOpenRun} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
