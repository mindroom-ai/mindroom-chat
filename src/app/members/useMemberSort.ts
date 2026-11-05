import { useMemo } from 'react';
import type { RoomMember } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { compareNames } from '../lib/nameOrder';

/** Compares two members: negative puts `a` first. */
type MemberOrder = (a: RoomMember, b: RoomMember) => number;

/** One way to order the member list, named as the sort menu shows it. */
export type MemberSortItem = { name: string; sortFn: MemberOrder };

/** The name a member is listed under: the display name, else the user ID without its `@`. */
const listedName = (member: RoomMember): string =>
  (member.rawDisplayName || member.userId || '').replace(/^@/, '');

/** When the member's current membership began (their latest `m.room.member` event). */
const membershipSince = (member: RoomMember): number => member.events?.member?.getTs() ?? 0;

export const MemberSort: Record<'AtoZ' | 'ZtoA' | 'NewestFirst' | 'OldestFirst', MemberOrder> = {
  AtoZ: (a, b) => compareNames(listedName(a), listedName(b)),
  ZtoA: (a, b) => compareNames(listedName(b), listedName(a)),
  NewestFirst: (a, b) => membershipSince(b) - membershipSince(a),
  OldestFirst: (a, b) => membershipSince(a) - membershipSince(b),
};

/** The orders the member list offers, in menu order; the first is the default. */
export const useMemberSortMenu = (): MemberSortItem[] => {
  const { t } = useTranslation();
  return useMemo(
    () => [
      { name: t('sharedUi.memberSort.atoZ'), sortFn: MemberSort.AtoZ },
      { name: t('sharedUi.memberSort.ztoA'), sortFn: MemberSort.ZtoA },
      { name: t('sharedUi.memberSort.newest'), sortFn: MemberSort.NewestFirst },
      { name: t('sharedUi.memberSort.oldest'), sortFn: MemberSort.OldestFirst },
    ],
    [t]
  );
};

/** The order at `index` of the menu, or its first entry when the index is out of range. */
export const useMemberSort = (index: number, items: MemberSortItem[]): MemberSortItem | undefined =>
  items[index] ?? items[0];
