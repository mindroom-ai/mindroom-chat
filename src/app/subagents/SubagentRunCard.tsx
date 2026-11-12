import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Room } from 'matrix-js-sdk';
import { Avatar, Text } from 'folds';
import { agentMember } from '../approvals/approvalPeople';
import { UserAvatar } from '../avatars/UserAvatar';
import { getLocalizedThreadMessagePreviewText } from '../event-store/threads/threadMessagePreview';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { useRelativeTime } from '../i18n/useRelativeTime';
import { nameInitials } from '../lib/common';
import { formatCallDuration } from '../lib/time';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../matrix/matrix';
import type { LiveDocs } from '../matrix/protocol/liveFrame';
import {
  isActiveSubagentStatus,
  type SubagentMeta,
  type SubagentStatus,
} from '../matrix/protocol/subagentFrame';
import { getMemberAvatarMxc, getMemberDisplayName } from '../matrix/room';
import type { SubagentRun } from '../messages/live/subagentRunStore';
import * as css from './subagentsPanel.css';

/** One turn of a sub-agent, a run of its own, and the sub-agents that turn started. */
export type SubagentTurn = { run: SubagentRun; nested: SubagentNode[] };

/**
 * A sub-agent: its turns, the first on top, and the sub-agent that started it while that one is
 * listed too.
 */
export type SubagentNode = {
  id: string;
  parent: string | null;
  turns: [SubagentTurn, ...SubagentTurn[]];
};

/** The sub-agent's newest turn, which says how it stands. */
export const latestTurn = ({ turns }: SubagentNode): SubagentRun =>
  (turns[turns.length - 1] ?? turns[0]).run;

/** Pictures show at most 28 px wide; twice that keeps them sharp on dense screens. */
const PICTURE_SIZE = 56;

export type AgentProfile = { name: string; colorId: string; avatarSrc?: string };

/**
 * The name and picture of the agent MindRoom calls `agent`: those of its account in the room
 * (`mindroom_<agent>`, or `mindroom_<agent>_<namespace>`), or the name itself.
 */
export const useAgentProfile = (room: Room, agent: string): AgentProfile => {
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

/** The agent's picture, or its initials: small on a card, as a thread card's people; a message's size in a run. */
export function AgentAvatar({ agent, size }: { agent: AgentProfile; size: '200' | '300' }) {
  return (
    <Avatar size={size} radii={size === '200' ? '400' : undefined} aria-hidden>
      <UserAvatar
        alt=""
        userId={agent.colorId}
        src={agent.avatarSrc}
        renderFallback={() => (
          <Text as="span" size={size === '200' ? 'L400' : 'H6'}>
            {nameInitials(agent.name)}
          </Text>
        )}
      />
    </Avatar>
  );
}

/** How the run stands: a dot in the status's color, then its word. */
export function RunStatus({ status }: { status: SubagentStatus }) {
  const { t } = useTranslation();
  return (
    <span className={css.Status}>
      <span className={css.StatusDot[status]} />
      {t(`mindroomUi.subagents.${status}`)}
    </span>
  );
}

/** How long the run has been at it, or took; unknown for an ended run without an end time. */
export const elapsedSeconds = (meta: SubagentMeta, now: number): number | undefined => {
  if (isActiveSubagentStatus(meta.status)) return now / 1000 - meta.startedAt;
  return meta.endedAt === null ? undefined : meta.endedAt - meta.startedAt;
};

/** A run that ended badly says why; any other says what it wrote, as a thread card previews it. */
const runPreview = (meta: SubagentMeta, docs: LiveDocs, t: TFunction): string | undefined => {
  const failed = meta.status === 'failed' || meta.status === 'denied';
  const text = failed && meta.result ? meta.result : docs.md || meta.result;
  return text
    ? getLocalizedThreadMessagePreviewText({ msgtype: 'm.text', body: text }, t)
    : undefined;
};

type CardProps = {
  room: Room;
  node: SubagentNode;
  /** The panel's clock, in Unix milliseconds. */
  now: number;
  onOpen: (subagent: string) => void;
};

/**
 * One sub-agent as the room's compact view shows a thread: its first task as the title, how long
 * its newest turn has been at it or how long ago it ended, a line of what that turn wrote, then the
 * agent, how it stands, how many turns it took and how many sub-agents it started. Pressing it
 * opens the sub-agent.
 */
export const SubagentRunCard = memo(function SubagentRunCard({
  room,
  node,
  now,
  onOpen,
}: CardProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const run = latestTurn(node);
  const { meta } = run;
  const nested = node.turns.reduce((count, turn) => count + turn.nested.length, 0);
  const agent = useAgentProfile(room, meta.agent);
  const active = isActiveSubagentStatus(meta.status);
  const ago = useRelativeTime(
    active ? undefined : (meta.endedAt ?? meta.startedAt) * 1000,
    'compact'
  );
  const time = active ? formatCallDuration(now / 1000 - meta.startedAt, language) : ago;
  const title = node.turns[0].run.meta.task?.split('\n', 1)[0] || agent.name;
  const preview = runPreview(meta, run.docs, t);
  const failed = meta.status === 'failed' || meta.status === 'denied';

  return (
    <button
      type="button"
      className={css.Card}
      data-subagent={node.id}
      onClick={() => onOpen(node.id)}
    >
      <span className={css.TitleRow}>
        <Text as="span" size="B300" className={css.Title} dir="auto" truncate>
          {title}
        </Text>
        <Text as="span" size="T200" priority="300" className={css.Time}>
          {time}
        </Text>
      </span>
      <Text
        as="span"
        size="T200"
        priority={failed ? undefined : '300'}
        className={failed ? css.PreviewFailed : undefined}
        dir="auto"
        truncate
      >
        {preview ?? ' '}
      </Text>
      <span className={css.Meta}>
        <AgentAvatar agent={agent} size="200" />
        <Text as="span" size="T200" truncate>
          {agent.name}
        </Text>
        <Text as="span" size="T200" priority="300">
          <RunStatus status={meta.status} />
        </Text>
        {(node.turns.length > 1 || nested > 0) && (
          <Text as="span" size="T200" priority="300" className={css.Counts}>
            {node.turns.length > 1 && (
              <span>{t('mindroomUi.subagents.turns', { count: node.turns.length })}</span>
            )}
            {nested > 0 && <span>{t('mindroomUi.subagents.nested', { count: nested })}</span>}
          </Text>
        )}
      </span>
    </button>
  );
});
