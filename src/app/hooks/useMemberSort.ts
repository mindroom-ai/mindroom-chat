import { useMemo } from 'react';
import type { RoomMember } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { IPowerLevels, readPowerLevel } from './usePowerLevels';










const membershipTs = (member: RoomMember): number => member.events.member?.getTs() ?? 0;

export const MemberSort = {
  Ascending: (a: RoomMember, b: RoomMember): number => memberName(a).localeCompare(memberName(b)),
  Descending: (a: RoomMember, b: RoomMember): number => memberName(b).localeCompare(memberName(a)),
  NewestFirst: (a: RoomMember, b: RoomMember): number => membershipTs(b) - membershipTs(a),
  OldestFirst: (a: RoomMember, b: RoomMember): number => membershipTs(a) - membershipTs(b),
};

/** The sort orders the members list offers, in menu order. */
export const useMemberSortMenu = (): MemberSortItem[] => {
  const { t } = useTranslation();
  return useMemo(
    () => [
      { name: t('sharedUi.memberSort.ascending'), sortFn: MemberSort.Ascending },
      { name: t('sharedUi.memberSort.descending'), sortFn: MemberSort.Descending },
      { name: t('sharedUi.memberSort.newestFirst'), sortFn: MemberSort.NewestFirst },
      { name: t('sharedUi.memberSort.oldestFirst'), sortFn: MemberSort.OldestFirst },
    ],
    [t]
  );
};

/** The selected sort order, falling back to the first one for an index out of range. */
export const useMemberSort = (index: number, items: MemberSortItem[]): MemberSortItem =>
  items[index] ?? items[0];

/** Sorts members by power, creators first, highest level next. */



): MemberSortFn =>
  useMemo(() => {
    const power = (member: RoomMember) =>
      creators.has(member.userId) ? Infinity : readPowerLevel.user(powerLevels, member.userId);
    return (a, b) => {
      const difference = power(b) - power(a);
      return Number.isNaN(difference) ? 0 : difference;
    };
  }, [creators, powerLevels]);
