import { useMemo, useState } from 'react';
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
import { SubagentCard, type SubagentRunNode } from './SubagentCard';
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

/**
 * The room's live sub-agent runs, in the room's side panel: a card per run, the runs a run started
 * inside its card, with how many are still at it in the header.
 */
export function SubagentsPanel({ room, onClose }: { room: Room; onClose: () => void }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const runs = useRoomSubagentRuns(room.roomId);
  const nodes = useMemo(() => nestRuns(runs), [runs]);
  const active = countActiveSubagentRuns(runs);
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
    <section className={css.Panel} aria-label={title} data-testid="subagents-panel">
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
      <div className={css.Runs}>
        {nodes.length === 0 ? (
          <Text size="T300" priority="300" className={css.Empty}>
            {t('mindroomUi.subagents.empty')}
          </Text>
        ) : (
          <ul className={css.List}>
            {nodes.map((node) => (
              <li key={node.run.run}>
                <SubagentCard room={room} node={node} now={now} parserOptions={parserOptions} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
