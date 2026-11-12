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
  countActiveSubagents,
  useRoomSubagentRuns,
  type SubagentRun,
} from '../messages/live/subagentRunStore';
import { useMentionClickHandler } from '../messages/useMentionClickHandler';
import { Header as SidePanelHeader } from '../ui/panels/SidePanel.css';
import { SubagentRunCard, latestTurn, type SubagentNode } from './SubagentRunCard';
import { SubagentRunView } from './SubagentRunView';
import * as css from './subagentsPanel.css';

/** How often a running run's time moves on. */
const CLOCK_MS = 1_000;

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
 * a card per sub-agent its agents started, with how many are still at it in the header. Pressing
 * a card shows that sub-agent's turns as a thread, with cards for the sub-agents it started; Back
 * leads to the sub-agent that started it, or to the list.
 */
export function SubagentsPanel({ room, onClose }: { room: Room; onClose: () => void }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const runs = useRoomSubagentRuns(room.roomId);
  const nodes = useMemo(() => nestSubagents(runs), [runs]);
  const byId = useMemo(() => subagentsById(nodes), [nodes]);
  const active = countActiveSubagents(runs);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId === null ? undefined : byId.get(openId);
  const section = useRef<HTMLElement>(null);
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
          key={open.id}
          room={room}
          node={open}
          now={now}
          parserOptions={parserOptions}
          onBack={back}
          onOpen={setOpenId}
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
                  <li key={node.id}>
                    <SubagentRunCard room={room} node={node} now={now} onOpen={setOpenId} />
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
