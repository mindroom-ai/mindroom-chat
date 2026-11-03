import { useMemo } from 'react';
import type { Room } from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';
import { IPowerLevels } from './usePowerLevels';
import { useStateEvent } from './useStateEvent';

/** An emoji, or the `mxc://` URL of an image. */












  100: { name: 'Admin' },
  50: { name: 'Moderator' },
  0: { name: 'Member' },
};

const readTag = (value: unknown): PowerLevelTag | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const { name, color, icon } = value as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim().length === 0) return undefined;
  const tag: PowerLevelTag = { name };
  if (typeof color === 'string') tag.color = color;
  if (icon && typeof icon === 'object' && typeof (icon as { key?: unknown }).key === 'string') {
    tag.icon = { key: (icon as { key: string }).key };
  }
  return tag;
};

export const readPowerLevelTags = (content: unknown): PowerLevelTags => {
  const tags: PowerLevelTags = {};
  if (!content || typeof content !== 'object') return tags;
  Object.entries(content as Record<string, unknown>).forEach(([level, value]) => {
    const powerLevel = Number(level);
    const tag = readTag(value);
    if (Number.isFinite(powerLevel) && tag) tags[powerLevel] = tag;
  });










  return useMemo(() => {
    const tags: PowerLevelTags = {
      ...DEFAULT_POWER_LEVEL_TAGS,
      ...readPowerLevelTags(tagsEvent?.getContent()),
    };
    Object.values(powerLevels.users ?? {}).forEach((level) => {
      if (!(level in tags)) tags[level] = { name: `Level ${level}` };
    });
    return tags;
  }, [tagsEvent, powerLevels]);
};

/** The tag of the highest level at or below `powerLevel`. */
export const getPowerLevelTag = (tags: PowerLevelTags, powerLevel: number): PowerLevelTag => {
  const levels = Object.keys(tags)
    .map(Number)
    .filter((level) => level <= powerLevel)
    .sort((a, b) => b - a);
  const level = levels[0];
  return level === undefined ? { name: `Level ${powerLevel}` } : tags[level];
};
