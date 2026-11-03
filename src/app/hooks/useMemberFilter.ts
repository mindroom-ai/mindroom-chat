import { useMemo } from 'react';
import type { RoomMember } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { Membership } from '../../types/matrix/room';

export type MembershipFilterFn = (member: RoomMember) => boolean;








  filterJoined: (member: RoomMember): boolean => member.membership === Membership.Join,
  filterInvited: (member: RoomMember): boolean => member.membership === Membership.Invite,
  /** Pending join requests (`knock`). */
  filterKnocked: (member: RoomMember): boolean => member.membership === Membership.Knock,
  filterLeaved: (member: RoomMember): boolean => member.membership === Membership.Leave,
  filterBanned: (member: RoomMember): boolean => member.membership === Membership.Ban,
};

/** The membership filters the members list offers, in menu order. */
export const useMembershipFilterMenu = (): MembershipFilterItem[] => {
  const { t } = useTranslation();
  return useMemo(
    () => [
      { name: t('sharedUi.memberFilter.joined'), filterFn: MembershipFilter.filterJoined },
      { name: t('sharedUi.memberFilter.invited'), filterFn: MembershipFilter.filterInvited },
      { name: t('sharedUi.memberFilter.joinRequests'), filterFn: MembershipFilter.filterKnocked },
      { name: t('sharedUi.memberFilter.left'), filterFn: MembershipFilter.filterLeaved },
      {
        name: t('sharedUi.memberFilter.banned'),










  index: number,
  items: MembershipFilterItem[]
): MembershipFilterItem => items[index] ?? items[0];
