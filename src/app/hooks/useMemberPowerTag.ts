import { useCallback, useMemo } from 'react';
import chroma from 'chroma-js';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { mxcUrlToHttp } from '../utils/mediaUrl';
import { ThemeKind } from './useTheme';
import { IPowerLevels, readPowerLevel } from './usePowerLevels';
import {
  getPowerLevelTag,
  PowerLevelTag,
  PowerLevelTagIcon,
  PowerLevelTags,
} from './usePowerLevelTags';

/** The member's tag and its power level; creators of version 12 rooms get the creator tag. */
export type MemberPowerTag = PowerLevelTag & { powerLevel: number; creator?: boolean };

export const CREATOR_POWER_TAG: PowerLevelTag = { name: 'Founder' };

/**
 * The image source of a tag icon: the emoji itself, or the HTTP URL of an `mxc://` image. Other
 * URLs are dropped, since tags come from room state anyone with permission can write.
 */





  const { key } = icon;
  if (key.startsWith('mxc://')) return mxcUrlToHttp(mx, key, useAuthentication) ?? undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(key)) return undefined;
  return key;
};

/** Looks up each member's power tag. */




  tags: PowerLevelTags,
  creatorTag: PowerLevelTag = CREATOR_POWER_TAG
): ((userId: string) => MemberPowerTag) =>
  useCallback(
    (userId: string) => {
      void room;
      if (creators.has(userId)) {
        return { ...creatorTag, powerLevel: Infinity, creator: true };
      }
      const powerLevel = readPowerLevel.user(powerLevels, userId);
      return { ...getPowerLevelTag(tags, powerLevel), powerLevel };
    },
    [room, creators, powerLevels, tags, creatorTag]
  );

const MIN_CONTRAST = 4.5;

const readableColor = (color: string, themeKind: ThemeKind): string | undefined => {
  if (!chroma.valid(color)) return undefined;
  const background = themeKind === ThemeKind.Dark ? '#1a1a1a' : '#ffffff';
  let adjusted = chroma(color);
  for (let step = 0; step < 10 && chroma.contrast(adjusted, background) < MIN_CONTRAST; step += 1) {
    adjusted = themeKind === ThemeKind.Dark ? adjusted.brighten(0.5) : adjusted.darken(0.5);
  }
  return adjusted.hex();
};

/** Tag colors by power level, adjusted to stay readable on the theme's background. */
export const useAccessiblePowerTagColors = (
  themeKind: ThemeKind,
  creatorTag: PowerLevelTag | undefined,
  tags: PowerLevelTags
): Map<number, string> =>
  useMemo(() => {
    const colors = new Map<number, string>();
    Object.entries(tags).forEach(([level, tag]) => {
      const color = tag.color ? readableColor(tag.color, themeKind) : undefined;
      if (color) colors.set(Number(level), color);
    });
    const creatorColor = creatorTag?.color ? readableColor(creatorTag.color, themeKind) : undefined;
    if (creatorColor) colors.set(Infinity, creatorColor);
    return colors;
  }, [themeKind, creatorTag, tags]);
