import React, { ReactNode, useCallback } from 'react';
import { IconSrc, Icons } from 'folds';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Trans, useTranslation } from 'react-i18next';
import { Membership } from '../../types/matrix/room';
import { getMxIdLocalPart } from '../utils/matrix';

export type ParsedMemberEvent = {
  icon: IconSrc;
  body: ReactNode;
};

export type MemberEventParser = (event: MatrixEvent) => ParsedMemberEvent;

type MemberContent = {
  membership?: string;
  displayname?: string;
  avatar_url?: string;
  reason?: string;
};

const readMemberContent = (content: unknown): MemberContent => {
  if (!content || typeof content !== 'object') return {};
  const {
    membership,
    displayname,
    avatar_url: avatarUrl,
    reason,
  } = content as Record<string, unknown>;
  return {
    membership: typeof membership === 'string' ? membership : undefined,
    displayname: typeof displayname === 'string' && displayname ? displayname : undefined,
    avatar_url: typeof avatarUrl === 'string' && avatarUrl ? avatarUrl : undefined,
    reason: typeof reason === 'string' && reason.trim() ? reason.trim() : undefined,
  };
};

type MemberEventKind =
  | 'joined'
  | 'invited'
  | 'rejectedInvite'
  | 'revokedInvite'
  | 'left'
  | 'kicked'
  | 'banned'
  | 'unbanned'
  | 'requestedToJoin'
  | 'withdrewJoinRequest'
  | 'rejectedJoinRequest'
  | 'changedName'
  | 'setName'
  | 'removedName'
  | 'changedAvatar'
  | 'removedAvatar'
  | 'noChange';

const KEYS = {
  joined: 'sharedUi.memberEvents.joined',
  invited: 'sharedUi.memberEvents.invited',
  rejectedInvite: 'sharedUi.memberEvents.rejectedInvite',
  revokedInvite: 'sharedUi.memberEvents.revokedInvite',
  left: 'sharedUi.memberEvents.left',
  kicked: 'sharedUi.memberEvents.kicked',
  banned: 'sharedUi.memberEvents.banned',
  unbanned: 'sharedUi.memberEvents.unbanned',
  requestedToJoin: 'sharedUi.memberEvents.requestedToJoin',
  withdrewJoinRequest: 'sharedUi.memberEvents.withdrewJoinRequest',
  rejectedJoinRequest: 'sharedUi.memberEvents.rejectedJoinRequest',
  changedName: 'sharedUi.memberEvents.changedName',
  setName: 'sharedUi.memberEvents.setName',
  removedName: 'sharedUi.memberEvents.removedName',
  changedAvatar: 'sharedUi.memberEvents.changedAvatar',
  removedAvatar: 'sharedUi.memberEvents.removedAvatar',
  noChange: 'sharedUi.memberEvents.noChange',
} as const;

// Leaving, removal and bans show the reason the member or moderator gave.
const REASON_KEYS = {
  left: 'sharedUi.memberEvents.leftWithReason',
  kicked: 'sharedUi.memberEvents.kickedWithReason',
  banned: 'sharedUi.memberEvents.bannedWithReason',
} as const;

const getMessageKey = (kind: MemberEventKind, hasReason: boolean) =>
  hasReason && kind in REASON_KEYS ? REASON_KEYS[kind as keyof typeof REASON_KEYS] : KEYS[kind];

const ICONS: Record<MemberEventKind, IconSrc> = {
  joined: Icons.ArrowGoRight,
  invited: Icons.ArrowGoRightPlus,
  rejectedInvite: Icons.ArrowGoRightCross,
  revokedInvite: Icons.ArrowGoRightCross,
  left: Icons.ArrowGoLeft,
  kicked: Icons.ArrowGoLeft,
  banned: Icons.ArrowGoLeft,
  unbanned: Icons.ArrowGoRight,
  requestedToJoin: Icons.ArrowGoRightPlus,
  withdrewJoinRequest: Icons.ArrowGoRightCross,
  rejectedJoinRequest: Icons.ArrowGoRightCross,
  changedName: Icons.Mention,
  setName: Icons.Mention,
  removedName: Icons.Mention,
  changedAvatar: Icons.User,
  removedAvatar: Icons.User,
  noChange: Icons.User,
};

/** Classifies a membership change by the Matrix specification's membership transitions. */
const getMemberEventKind = (
  current: MemberContent,
  previous: MemberContent,
  selfChange: boolean
): MemberEventKind => {
  const membership = current.membership;
  const prevMembership = previous.membership;

  if (membership === Membership.Join) {
    if (prevMembership !== Membership.Join) return 'joined';
    if (current.displayname !== previous.displayname) {
      if (!current.displayname) return 'removedName';
      return previous.displayname ? 'changedName' : 'setName';
    }
    if (current.avatar_url !== previous.avatar_url) {
      return current.avatar_url ? 'changedAvatar' : 'removedAvatar';
    }
    return 'noChange';
  }
  if (membership === Membership.Invite) return 'invited';
  if (membership === Membership.Knock) return 'requestedToJoin';
  if (membership === Membership.Ban) return 'banned';
  if (membership === Membership.Leave) {
    if (selfChange) {
      if (prevMembership === Membership.Invite) return 'rejectedInvite';
      if (prevMembership === Membership.Knock) return 'withdrewJoinRequest';
      return 'left';
    }
    if (prevMembership === Membership.Invite) return 'revokedInvite';
    if (prevMembership === Membership.Knock) return 'rejectedJoinRequest';
    if (prevMembership === Membership.Ban) return 'unbanned';
    return 'kicked';
  }
  return 'noChange';
};

const nameOf = (userId: string | undefined, displayName: string | undefined): string =>
  displayName ?? (userId ? getMxIdLocalPart(userId) ?? userId : '');

/**
 * Turns `m.room.member` events into an icon and a localized sentence, such as "Lee joined the
 * room". Names render bold; the sentence follows language changes. Names are escaped before the
 * sentence's markup is parsed and unescaped in the rendered text, so a name such as `<3` stays
 * text.
 */




    (event: MatrixEvent): ParsedMemberEvent => {
      const current = readMemberContent(event.getContent());
      const previous = readMemberContent(event.getPrevContent());
      const senderId = event.getSender();
      const targetId = event.getStateKey() ?? undefined;
      const selfChange = !!senderId && senderId === targetId;
      const kind = getMemberEventKind(current, previous, selfChange);

      const senderMember = senderId ? event.sender : undefined;
      const userName = nameOf(targetId, current.displayname ?? previous.displayname);
      const senderName = selfChange
        ? userName
        : nameOf(senderId, senderMember?.rawDisplayName || undefined);
      const previousName = nameOf(targetId, previous.displayname);
      const reason = current.reason;
      const key = getMessageKey(kind, !!reason);

      return {
        icon: ICONS[kind],
        body: (
          <Trans
            t={t}
            i18nKey={key}
            values={{ userName, senderName, previousName, reason }}
            components={{ b: <b /> }}
            tOptions={{ interpolation: { escapeValue: true } }}
            shouldUnescape
          />
        ),
      };
    },
    [t]
  );
};
