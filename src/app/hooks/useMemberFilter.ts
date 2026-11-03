import { useMemo } from 'react';
import type { RoomMember } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { Membership } from '../../types/matrix/room';

export type MembershipFilterItem = {
  name: string;
  filterFn: (member: RoomMember) => boolean;
};

/** Whether the member's own account sent their latest membership event. */
const changedOwnMembership = (member: RoomMember): boolean => {
  const sender = member.events.member?.getSender();
  return !sender || sender === member.userId;
};

export const MembershipFilter = {
  filterJoined: (member: RoomMember): boolean => member.membership === Membership.Join,
  filterInvited: (member: RoomMember): boolean => member.membership === Membership.Invite,
  /** Pending join requests (`knock`). */
  filterKnocked: (member: RoomMember): boolean => member.membership === Membership.Knock,
  filterLeft: (member: RoomMember): boolean =>
    member.membership === Membership.Leave && changedOwnMembership(member),
  filterKicked: (member: RoomMember): boolean =>
    member.membership === Membership.Leave && !changedOwnMembership(member),
  filterBanned: (member: RoomMember): boolean => member.membership === Membership.Ban,
};

/** The membership filters the members list offers, in menu order. */
export const useMembershipFilterMenu = (): MembershipFilterItem[] => {
  const { t } = useTranslation();
  return useMemo(
    () => [
      { name: t('sharedUi.memberFilters.joined'), filterFn: MembershipFilter.filterJoined },
      { name: t('sharedUi.memberFilters.invited'), filterFn: MembershipFilter.filterInvited },
      { name: t('sharedUi.memberFilters.left'), filterFn: MembershipFilter.filterLeft },
      { name: t('sharedUi.memberFilters.kicked'), filterFn: MembershipFilter.filterKicked },
      { name: t('sharedUi.memberFilters.banned'), filterFn: MembershipFilter.filterBanned },
    ],
    [t]
  );
};
