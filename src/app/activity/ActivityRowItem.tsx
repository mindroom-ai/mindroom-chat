import { memo, useState, type MouseEvent } from 'react';
import classNames from 'classnames';
import type { TFunction } from 'i18next';
import type { Room } from 'matrix-js-sdk';
import { Avatar, Button, Icon, Icons, Text, type IconSrc } from 'folds';
import { useTranslation } from 'react-i18next';
import { UserAvatar } from '../avatars/UserAvatar';
import { useRelativeTime } from '../i18n/useRelativeTime';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../matrix/mediaUrl';
import { getMemberAvatarMxc } from '../matrix/room';
import { acceptInvite } from '../notifications/inbox/acceptInvite';
import { declineInvite } from '../notifications/inbox/declineInvite';
import { ownDirectionLine, revealDirectionControls } from '../ui/directional';
import {
  threadActorName,
  threadIndexReplyPreview,
  threadPreviewText,
  threadTitleText,
} from '../threads/cross-room/threadText';
import type { ActivityRow, ActivityThreadRow } from './activityRows';
import { needsYou } from './activityRows';
import { answerApproval, answerQuestion } from './activityActions';
import * as css from './ActivityList.css';

const sentence = (t: TFunction, row: ActivityRow, names: string[]): string => {
  const [name = '', other = ''] = names;
  switch (row.kind) {
    case 'approval':
    case 'question':
    case 'mention':
    case 'finished':
    case 'stopped':
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
    const parts = [
      t('activity.runMinutes', { count: Math.max(1, Math.round(outcome.durationMs / 60_000)) }),
    ];
    if (outcome.toolCount) parts.push(t('activity.toolCount', { count: outcome.toolCount }));
    return parts.join(', ');
  }
  return newCount > 0 ? t('activity.newCount', { count: newCount }) : '';
};

const firstStringArgument = (args: Record<string, unknown>): string =>
  Object.values(args).find((value): value is string => typeof value === 'string') ?? '';

const KIND_ICONS: Record<ActivityRow['kind'], { icon: IconSrc; className?: string }> = {
  approval: { icon: Icons.Lock, className: css.KindAttention },
  question: { icon: Icons.Info, className: css.KindAttention },
  invite: { icon: Icons.Mail, className: css.KindAttention },
  mention: { icon: Icons.Mention, className: css.KindMention },
  reply: { icon: Icons.ReplyArrow },
  finished: { icon: Icons.Check, className: css.KindDone },
  stopped: { icon: Icons.Cross, className: css.KindStopped },
};

type ActionState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'error' }
  | { status: 'done'; label: string };

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
      ...(record.approval.approvable
        ? [
            <Button
              key="approve"
              size="300"
              variant="Success"
              fill="Soft"
              radii="300"
              disabled={busy}
              onClick={run(
                () => answerApproval(mx, roomId, record, 'approved'),
                t('activity.actions.approved')
              )}
            >
              <Text size="B300">{t('activity.actions.approve')}</Text>
            </Button>,
          ]
        : []),
      <Button
        key="deny"
        size="300"
        variant="Secondary"
        fill="Soft"
        radii="300"
        disabled={busy}
        onClick={run(
          () => answerApproval(mx, roomId, record, 'denied'),
          t('activity.actions.denied')
        )}
      >
        <Text size="B300">{t('activity.actions.deny')}</Text>
      </Button>,
      <Button
        key="details"
        size="300"
        variant="Secondary"
        fill="None"
        radii="300"
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          onDetails();
        }}
      >
        <Text size="B300">{t('activity.actions.details')}</Text>
      </Button>,
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
        disabled={busy}
        onClick={run(
          () => answerQuestion(mx, room, threadId, question, option.key),
          t('activity.actions.answered', { label: option.label })
        )}
      >
        <Text size="B300" {...ownDirectionLine}>
          {option.label}
        </Text>
      </Button>
    ));
  }
  if (buttons.length === 0) return null;
  return (
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
  );
}

const rowContext = (row: ActivityThreadRow): { title: string; room: string } => ({
  title: threadTitleText(row.entry),
  room: revealDirectionControls(row.entry.roomName),
});

/** One Activity row: who did what, a preview, the thread and room, and its answer buttons. */
export const ActivityRowItem = memo(function ActivityRowItem({
  row,
  onOpen,
}: {
  row: ActivityRow;
  onOpen: (row: ActivityRow) => void;
  /** Changes when a member list arrives, so the row names its senders again. */
  namesVersion?: number;
}) {
  const mx = useMatrixClient();
  const room = mx.getRoom(row.type === 'thread' ? row.entry.roomId : row.roomId);
  const { t } = useTranslation();
  const useAuthentication = useMediaAuthentication();
  const time = useRelativeTime(row.ts, 'compact');
  const actorIds = row.type === 'thread' ? row.actorIds : row.inviterId ? [row.inviterId] : [];
  const names = actorIds.map((userId) => threadActorName(mx, room, userId));
  const own = row.kind === 'reply' && actorIds.length === 1 && actorIds[0] === mx.getUserId();
  const lead = actorIds[0];
  const avatarMxc = room && lead ? getMemberAvatarMxc(room, lead) : undefined;
  const avatarUrl = avatarMxc
    ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 48, 48, 'crop') ?? undefined
    : undefined;
  const suffix = sentenceSuffix(t, row);
  const kind = KIND_ICONS[row.kind];

  let preview = '';
  if (row.type === 'invite') preview = revealDirectionControls(room?.name ?? row.roomId);
  else if (row.kind === 'approval' && row.signals.pendingApproval) {
    const { approval } = row.signals.pendingApproval;
    preview = revealDirectionControls(
      `${approval.toolName} ${firstStringArgument(approval.arguments)}`.trim()
    );
  } else if (row.kind === 'question' && row.signals.pendingQuestion) {
    preview = revealDirectionControls(row.signals.pendingQuestion.text);
  } else if (row.signals.lastReply) preview = threadPreviewText(t, row.signals.lastReply.preview);
  else preview = threadIndexReplyPreview(row.entry)?.text ?? '';
  const context = row.type === 'thread' ? rowContext(row) : undefined;

  return (
    <div
      data-activity-row={row.kind}
      className={classNames(css.Row, needsYou(row) && css.RowNeedsYou, !row.unread && css.RowRead)}
    >
      <div className={css.AvatarSlot}>
        <Avatar size="300" radii="Pill">
          <UserAvatar
            userId={lead ?? row.key}
            src={avatarUrl}
            alt={names[0] ?? ''}
            renderFallback={() => <Icon size="100" src={Icons.User} filled />}
          />
        </Avatar>
        <span className={classNames(css.KindBadge, kind.className)} aria-hidden>
          <Icon size="50" src={kind.icon} />
        </span>
      </div>
      <div className={css.Body}>
        <button
          type="button"
          className={css.OpenButton}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row);
          }}
        >
          <span className={css.Line}>
            <Text as="span" size="T300" className={css.Sentence}>
              {row.unread ? (
                <b>{own ? t('activity.sentence.youReplied') : sentence(t, row, names)}</b>
              ) : (
                <span>{own ? t('activity.sentence.youReplied') : sentence(t, row, names)}</span>
              )}
              {suffix && (
                <>
                  <span className={css.Muted} aria-hidden>
                    {' · '}
                  </span>
                  <span className={css.Muted}>{suffix}</span>
                </>
              )}
            </Text>
            {row.ts > 0 && (
              <Text as="span" size="T200" priority="300">
                {time}
              </Text>
            )}
            {row.unread && <span className={css.UnreadDot} aria-hidden />}
          </span>
          {preview && (
            <Text
              as="span"
              size="T200"
              priority="400"
              className={css.Preview}
              {...ownDirectionLine}
            >
              {preview}
            </Text>
          )}
          {context && (
            <span className={css.Context}>
              <Text as="span" size="T200" priority="300" truncate {...ownDirectionLine}>
                {context.title}
              </Text>
              <Text as="span" size="T200" priority="300" aria-hidden>
                ·
              </Text>
              <Text as="span" size="T200" priority="300" truncate {...ownDirectionLine}>
                {context.room}
              </Text>
            </span>
          )}
        </button>
        <RowActions row={row} room={room} onDetails={() => onOpen(row)} />
      </div>
    </div>
  );
});
