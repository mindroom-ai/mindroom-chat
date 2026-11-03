import { useCallback, useMemo } from 'react';
import type { MatrixClient, Room, RoomMember } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { mxcUrlToHttp } from '../utils/mediaUrl';
import { type IPowerLevels, readPowerLevel } from './usePowerLevels';
import { type PowerLevelTag, type PowerLevelTagIcon, usePowerLevelTags } from './usePowerLevelTags';

/**
 * The image source of a tag icon: the emoji itself, or the HTTP URL of an `mxc://` image. Other
 * URLs are dropped, since tags come from room state anyone with permission can write.
 */
export const getPowerTagIconSrc = (
  client: MatrixClient,
  authenticatedMedia: boolean,
  icon: PowerLevelTagIcon
): string | undefined => {
  const { key } = icon;
  if (key.startsWith('mxc://')) return mxcUrlToHttp(client, key, authenticatedMedia) ?? undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(key)) return undefined;
  return key;
};

/** A member's power tag and the level it stands for; room creators rank above every level. */
export type MemberPowerTag = PowerLevelTag & { level: number };

/** The level the creators' tag sorts at (room version 12 creators outrank every power level). */
export const CREATOR_TAG_LEVEL = Number.POSITIVE_INFINITY;

/**
 * Looks up the power tag of a member: "Founder" for the room's creators, else the tag of their
 * power level, "Muted" below 0 and "Team <level>" for a level the room leaves unnamed.
 */
export const useGetMemberPowerTag = (
  room: Room,
  creators: ReadonlySet<string>,
  powerLevels: IPowerLevels
): ((userId: string) => MemberPowerTag) => {
  const { t } = useTranslation();
  const tags = usePowerLevelTags(room);
  return useCallback(
    (userId: string) => {
      if (creators.has(userId)) {
        return { name: t('sharedUi.powerLevels.founder'), level: CREATOR_TAG_LEVEL };
      }
      const level = readPowerLevel.user(powerLevels, userId);
      const tag = tags[level];
      if (tag) return { ...tag, level };
      if (level < 0) return { name: t('sharedUi.powerLevels.muted'), level };
      return { name: t('sharedUi.powerLevels.team', { power: level }), level };
    },
    [creators, powerLevels, tags, t]
  );
};

/**
 * The members grouped under their power tags, highest level first: each tag followed by its
 * members in their given order. Groups without members are left out.
 */
export const useFlattenPowerTagMembers = (
  members: RoomMember[],
  getPowerTag: (userId: string) => MemberPowerTag
): Array<MemberPowerTag | RoomMember> =>
  useMemo(() => {
    const groups = new Map<number, { tag: MemberPowerTag; members: RoomMember[] }>();
    members.forEach((member) => {
      const tag = getPowerTag(member.userId);
      const group = groups.get(tag.level);
      if (group) group.members.push(member);
      else groups.set(tag.level, { tag, members: [member] });
    });
    return Array.from(groups.values())
      .sort((a, b) => b.tag.level - a.tag.level)
      .flatMap((group) => [group.tag, ...group.members]);
  }, [members, getPowerTag]);
