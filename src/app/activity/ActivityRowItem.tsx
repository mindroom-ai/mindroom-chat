import { memo, useState, type MouseEvent, type JSX } from 'react';
import type { TFunction } from 'i18next';
import type { Room } from 'matrix-js-sdk';
import { Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useRelativeTime } from '../i18n/useRelativeTime';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../matrix/mediaUrl';
import { getMxIdLocalPart } from '../matrix/matrix';
import { getMemberAvatarMxc, getMemberRawDisplayName, withoutNameDisguises } from '../matrix/room';
import { acceptInvite } from '../notifications/inbox/acceptInvite';
import { declineInvite } from '../notifications/inbox/declineInvite';
import { useMessagePreview } from '../plugins/messageRenderers';
import { ownDirectionBlock, revealDirectionControls } from '../ui/directional';
import {
  threadActorName,
  threadIndexReplyPreview,
  threadPreviewText,
  threadTitleText,
} from '../threads/cross-room/threadText';
import { threadRootPluginEvent } from '../threads/cross-room/threadSignals';
import type { ActivityRow } from './activityRows';
import { needsYou } from './activityRows';
import { answerQuestion } from '../messages/reactions/answerQuestion';
import { answerApproval } from './activityActions';
import { agentMember } from '../approvals/approvalPeople';
import { ApprovalArguments } from '../approvals/ApprovalArguments';
import { ActivityApprovalButtons, ActivityRowView } from './ActivityListChrome';
import * as css from './ActivityList.css';

const sentence = (t: TFunction, row: ActivityRow, names: string[]): string => {
  const [name = '', other = ''] = names;
  switch (row.kind) {
    case 'approval':
    case 'question':
    case 'mention':
    case 'finished':
    case 'stopped':
      if (row.kind === 'approval' && !name) return t('activity.sentence.approvalUnknown');
      // A mention the highlight count tells of, from a message not loaded, has no known sender.
      if (row.kind === 'mention' && row.type === 'thread' && !row.signals.mentionedBy) {
        return t('activity.sentence.mentionUnknown');
      }
      if (row.kind === 'mention' && other) {
        return t('activity.sentence.mentionAndReply', { name, other });
      }
      return t(`activity.sentence.${row.kind}`, { name });
    case 'invite':
      return name ? t('activity.sentence.invite', { name }) : t('activity.sentence.inviteUnknown');
    case 'reply':
      if (names.length > 2) {
        return t('activity.sentence.replyAndOthers', { name, count: names.length - 1 });
      }
      if (other) return t('activity.sentence.replyAndOther', { name, other });
      return t('activity.sentence.reply', { name });
  }
};

/** What follows the sentence: how much is new, or how long the run took and with how many tools. */
const sentenceSuffix = (t: TFunction, row: ActivityRow): string => {
  if (row.type !== 'thread') return '';
  const { outcome, newCount } = row.signals;
  if ((row.kind === 'finished' || row.kind === 'stopped') && outcome) {
    // A run that ended within a minute (often an error) has no length worth telling.
    const parts =
      outcome.durationMs >= 60_000
        ? [t('activity.runMinutes', { count: Math.round(outcome.durationMs / 60_000) })]
        : [];
    if (outcome.toolCount) parts.push(t('activity.toolCount', { count: outcome.toolCount }));
    return parts.join(', ');
  }
  return newCount > 0 ? t('activity.newCount', { count: newCount }) : '';
};

type ActionState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'error' }
  | { status: 'done'; label: string };

/** What a row's buttons answer, so a row that comes to wait on something else starts afresh. */
const actionTarget = (row: ActivityRow): string => {
  if (row.type === 'invite') return row.roomId;
  return row.signals.pendingApproval?.eventId ?? row.signals.pendingQuestion?.eventId ?? '';
};

/** The answer buttons of a row that waits for one, with their sending state and error. */
function RowActions({
  row,
  room,
  onDetails,
}: {
  row: ActivityRow;
  room: Room | null;
  onDetails: () => void;
}) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  const run = (action: () => Promise<void>, doneLabel: string) => (event: MouseEvent) => {
    event.stopPropagation();
    setState({ status: 'sending' });
    action().then(
      () => setState({ status: 'done', label: doneLabel }),
      () => setState({ status: 'error' })
    );
  };

  if (state.status === 'done') {
    return (
      <Text size="T200" priority="300" className={css.Actions}>
        {state.label}
      </Text>
    );
  }
  const busy = state.status === 'sending';
  let buttons: JSX.Element[] = [];
  if (row.type === 'invite') {
    buttons = [
      <Button
        key="join"
        size="300"
        variant="Primary"
        radii="300"
        className={css.ActionButton}
        disabled={busy || !room}
        onClick={run(
          () => (room ? acceptInvite(mx, room) : Promise.reject()),
          t('activity.actions.joined')
        )}
      >
        <Text size="B300">{t('activity.actions.join')}</Text>
      </Button>,
      <Button
        key="decline"
        size="300"
        variant="Secondary"
        fill="Soft"
        radii="300"
        className={css.ActionButton}
        disabled={busy}
        onClick={run(() => declineInvite(mx, row.roomId), t('activity.actions.declined'))}
      >
        <Text size="B300">{t('activity.actions.decline')}</Text>
      </Button>,
    ];
  } else if (row.kind === 'approval' && row.signals.pendingApproval) {
    const record = row.signals.pendingApproval;
    const { roomId } = row.entry;
    buttons = [
      <ActivityApprovalButtons
        key="approval"
        approvable={record.approval.approvable}
        disabled={busy}
        onApprove={run(
          () => answerApproval(mx, roomId, record, 'approved'),
          t('activity.actions.approved')
        )}
        onDeny={run(
          () => answerApproval(mx, roomId, record, 'denied'),
          t('activity.actions.denied')
        )}
        onDetails={(event) => {
          event.stopPropagation();
          onDetails();
        }}
      />,
    ];
  } else if (row.kind === 'question' && row.signals.pendingQuestion && room) {
    const question = row.signals.pendingQuestion;
    const threadId = row.entry.threadRootId;
    buttons = question.options.map((option) => (
      <Button
        key={option.key}
        size="300"
        variant="Primary"
        fill="Soft"
        radii="300"
        className={css.ActionButton}
        disabled={busy}
        onClick={run(
          () => answerQuestion(mx, room, threadId, question, option.key),
          t('activity.actions.answered', { label: option.label })
        )}
      >
        <Text size="B300" {...ownDirectionBlock}>
          {option.label}
        </Text>
      </Button>
    ));
  }
  if (buttons.length === 0) return null;
  // An approval shows what it runs above its buttons: the arguments, all of them on request, and
  // whether they were cut short, as the thread's approval card shows them.
  const approval =
    row.type === 'thread' && row.kind === 'approval' ? row.signals.pendingApproval : undefined;
  return (
    <>
      {approval && <ApprovalArguments approval={approval.approval} />}
      <div className={css.Actions}>
        {buttons}
        {busy && (
          <Text size="T200" priority="300">
            {t('activity.actions.sending')}
          </Text>
        )}
        {state.status === 'error' && (
          <Text size="T200" className={css.ErrorText} role="alert">
            {t('activity.actions.failed')}
          </Text>
        )}
      </div>
    </>
  );
}

/** One Activity row: who did what, a preview, the thread and room, and its answer buttons. */
export const ActivityRowItem = memo(function ActivityRowItem({
  row,
  onOpen,
  current = false,
}: {
  row: ActivityRow;
  onOpen: (row: ActivityRow) => void;
  /** Whether the row's thread (or invite) is the one shown beside the list. */
  current?: boolean;
  /** Changes when a member list arrives, so the row names its senders again. */
  namesVersion?: number;
}) {
  const mx = useMatrixClient();
  const room = mx.getRoom(row.type === 'thread' ? row.entry.roomId : row.roomId);
  const { t } = useTranslation();
  const useAuthentication = useMediaAuthentication();
  const time = useRelativeTime(row.ts, 'compact');
  // Use the approval card's named agent, not necessarily its sender, as the thread's card does.
  const asking =
    row.kind === 'approval' && row.signals.pendingApproval && room
      ? agentMember(room, row.signals.pendingApproval.approval.agentName)?.userId
      : undefined;
  let actorIds = row.type === 'thread' ? row.actorIds : [];
  if (row.type === 'invite') actorIds = row.inviterId ? [row.inviterId] : [];
  if (asking) actorIds = [asking];
  // An inviter is named by the invite's member event, its user ID on a line of its own: an
  // invited room has no member list to tell a copied name apart, and the ID does that.
  const names = actorIds.map((userId) =>
    row.type === 'invite'
      ? revealDirectionControls(
          withoutNameDisguises((room && getMemberRawDisplayName(room, userId)) ?? '') ??
            getMxIdLocalPart(userId) ??
            userId
        )
      : threadActorName(mx, room, userId)
  );
  const lead = actorIds[0];
  const avatarMxc = room && lead ? getMemberAvatarMxc(room, lead) : undefined;
  const avatarUrl = avatarMxc
    ? (mxcUrlToHttp(mx, avatarMxc, useAuthentication, 48, 48, 'crop') ?? undefined)
    : undefined;
  const suffix = sentenceSuffix(t, row);
  // A plugin that renders the reply, or the root, as a card in the timeline previews it here.
  const viewerId = mx.getUserId() ?? undefined;
  const replyPreview = useMessagePreview(
    row.type === 'thread' ? row.signals.lastOtherReply?.event : undefined,
    viewerId
  );
  const pluginTitle = useMessagePreview(
    row.type === 'thread' ? threadRootPluginEvent(room, row.entry) : undefined,
    viewerId
  );

  let preview = '';
  if (row.type === 'invite') preview = revealDirectionControls(room?.name ?? row.roomId);
  else if (row.kind === 'approval' && row.signals.pendingApproval) {
    // What it runs shows beside Approve, as the thread's approval card shows it.
    preview = revealDirectionControls(row.signals.pendingApproval.approval.toolName);
  } else if (row.kind === 'question' && row.signals.pendingQuestion) {
    preview = revealDirectionControls(row.signals.pendingQuestion.text);
  } else if (row.signals.lastOtherReply) {
    preview = replyPreview ?? threadPreviewText(t, row.signals.lastOtherReply.preview);
  } else if (!row.signals.lastReply) {
    const indexed = threadIndexReplyPreview(row.entry);
    if (indexed?.senderId && indexed.senderId !== viewerId) preview = indexed.text;
  }
  const context =
    row.type === 'thread'
      ? {
          title: pluginTitle ?? threadTitleText(row.entry),
          room: revealDirectionControls(row.entry.roomName),
        }
      : undefined;

  return (
    <ActivityRowView
      data-activity-row={row.kind}
      kind={row.kind}
      needsYou={needsYou(row)}
      unread={row.unread}
      current={current}
      avatarUserId={lead ?? row.key}
      avatarUrl={avatarUrl}
      avatarAlt={names[0] ?? ''}
      sentence={sentence(t, row, names)}
      suffix={suffix || undefined}
      time={row.ts > 0 ? time : undefined}
      preview={preview || undefined}
      wholeId={
        row.type === 'invite' && row.inviterId ? revealDirectionControls(row.inviterId) : undefined
      }
      context={context}
      onOpen={(event) => {
        event.stopPropagation();
        onOpen(row);
      }}
      actions={
        /* A thread can wait on another approval or question once one is answered. */
        <RowActions key={actionTarget(row)} row={row} room={room} onDetails={() => onOpen(row)} />
      }
    />
  );
});
