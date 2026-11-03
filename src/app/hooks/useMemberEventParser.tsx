import React, { ReactNode, useCallback } from 'react';
import { IconSrc, Icons } from 'folds';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Trans, useTranslation } from 'react-i18next';
import { Membership } from '../../types/matrix/room';
import { getMxIdLocalPart } from '../utils/matrix';

type ParsedMemberEvent = {
  icon: IconSrc;
  body: ReactNode;
};

type MemberEventParser = (event: MatrixEvent) => ParsedMemberEvent;

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

/** A membership change, named like its sentence in `sharedUi.memberEvents`. */
type MemberEventKind =
  | 'joined'
  | 'invited'
  | 'acceptedRequest'
  | 'requested'
  | 'rejectedInvitation'
  | 'revokedInvitation'
  | 'withdrewRequest'
  | 'rejectedRequest'
  | 'left'
  | 'kicked'
  | 'banned'
  | 'unbanned'
  | 'changedName'
  | 'removedName'
  | 'changedAvatar'
  | 'removedAvatar'
  | 'unchanged'
  | 'broken';

const KEYS = {
  joined: 'sharedUi.memberEvents.joined',
  invited: 'sharedUi.memberEvents.invited',
  acceptedRequest: 'sharedUi.memberEvents.acceptedRequest',
  requested: 'sharedUi.memberEvents.requested',
  rejectedInvitation: 'sharedUi.memberEvents.rejectedInvitation',
  revokedInvitation: 'sharedUi.memberEvents.revokedInvitation',
  withdrewRequest: 'sharedUi.memberEvents.withdrewRequest',
  rejectedRequest: 'sharedUi.memberEvents.rejectedRequest',
  left: 'sharedUi.memberEvents.left',
  kicked: 'sharedUi.memberEvents.kicked',
  banned: 'sharedUi.memberEvents.banned',
  unbanned: 'sharedUi.memberEvents.unbanned',
  changedName: 'sharedUi.memberEvents.changedName',
  removedName: 'sharedUi.memberEvents.removedName',
  changedAvatar: 'sharedUi.memberEvents.changedAvatar',
  removedAvatar: 'sharedUi.memberEvents.removedAvatar',
  unchanged: 'sharedUi.memberEvents.unchanged',
  broken: 'sharedUi.memberEvents.broken',
} as const satisfies Record<MemberEventKind, string>;

const ICONS: Record<MemberEventKind, IconSrc> = {
  joined: Icons.ArrowGoRight,
  invited: Icons.ArrowGoRightPlus,
  acceptedRequest: Icons.ArrowGoRightPlus,
  requested: Icons.ArrowGoRightPlus,
  rejectedInvitation: Icons.ArrowGoRightCross,
  revokedInvitation: Icons.ArrowGoRightCross,
  withdrewRequest: Icons.ArrowGoRightCross,
  rejectedRequest: Icons.ArrowGoRightCross,
  left: Icons.ArrowGoLeft,
  kicked: Icons.ArrowGoLeft,
  banned: Icons.ArrowGoLeft,
  unbanned: Icons.ArrowGoRight,
  changedName: Icons.Mention,
  removedName: Icons.Mention,
  changedAvatar: Icons.User,
  removedAvatar: Icons.User,
  unchanged: Icons.User,
  broken: Icons.User,
};

/** Classifies a membership change by the Matrix specification's membership transitions. */
const getMemberEventKind = (
  current: MemberContent,
  previous: MemberContent,
  selfChange: boolean
): MemberEventKind => {
  const { membership } = current;
  const prevMembership = previous.membership;

  if (membership === Membership.Join) {
    if (prevMembership !== Membership.Join) return 'joined';
    if (current.displayname !== previous.displayname) {
      return current.displayname ? 'changedName' : 'removedName';
    }
    if (current.avatar_url !== previous.avatar_url) {
      return current.avatar_url ? 'changedAvatar' : 'removedAvatar';
    }
    return 'unchanged';
  }
  // Approving a join request invites the member who knocked.
  if (membership === Membership.Invite) {
    return prevMembership === Membership.Knock ? 'acceptedRequest' : 'invited';
  }
  if (membership === Membership.Knock) return 'requested';
  if (membership === Membership.Ban) return 'banned';
  if (membership === Membership.Leave) {
    if (selfChange) {
      if (prevMembership === Membership.Invite) return 'rejectedInvitation';
      if (prevMembership === Membership.Knock) return 'withdrewRequest';
      return 'left';
    }
    if (prevMembership === Membership.Invite) return 'revokedInvitation';
    if (prevMembership === Membership.Knock) return 'rejectedRequest';
    if (prevMembership === Membership.Ban) return 'unbanned';
    return 'kicked';
  }
  return 'broken';
};

const nameOf = (userId: string | undefined, displayName: string | undefined): string =>
  displayName ?? (userId ? getMxIdLocalPart(userId) ?? userId : '');

type MemberEventFacts = {
  kind: MemberEventKind;
  userName: string;
  prevUserName: string;
  senderName: string;
  reason: string;
};

/** Reads who did what to whom from a member event; the sentence is chosen by `kind`. */
const describeMemberEvent = (event: MatrixEvent): MemberEventFacts => {
  const current = readMemberContent(event.getContent());
  const previous = readMemberContent(event.getPrevContent());
  const senderId = event.getSender();
  const targetId = event.getStateKey() ?? undefined;
  const selfChange = !!senderId && senderId === targetId;

  const userName = nameOf(targetId, current.displayname ?? previous.displayname);
  return {
    kind: getMemberEventKind(current, previous, selfChange),
    userName,
    prevUserName: nameOf(targetId, previous.displayname),
    senderName: selfChange ? userName : nameOf(senderId, event.sender?.rawDisplayName || undefined),
    reason: current.reason ? `(${current.reason})` : '',
  };
};

/**
 * Turns `m.room.member` events into an icon and a localized sentence, such as "Lee joined the
 * room". Names render bold; the sentence follows language changes. Names are escaped before the
 * sentence's markup is parsed and unescaped in the rendered text, so a name such as `<3` stays
 * text.
 */
export function useMemberEventParser(): MemberEventParser {
  const { t: translate } = useTranslation();

  return useCallback(
    (event) => {
      const { kind, ...values } = describeMemberEvent(event);
      return {
        icon: ICONS[kind],
        body: (
          <Trans
            t={translate}
            i18nKey={KEYS[kind]}
            values={values}
            components={{ b: <b /> }}
            tOptions={{ interpolation: { escapeValue: true } }}
            shouldUnescape
          />
        ),
      };
    },
    [translate]
  );
}
