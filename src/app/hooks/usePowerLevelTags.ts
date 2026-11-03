import { useMemo } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { StateEvent } from '../../types/matrix/room';
import { useStateEvent } from './useStateEvent';

/** An emoji, or the `mxc://` URL of an image. */
export type PowerLevelTagIcon = { key: string };

/**
 * The label a room shows for members at one power level (`io.mindroom.power_level_tags`).
 * `color` is a CSS color for the label.
 */
export type PowerLevelTag = { name: string; color?: string; icon?: PowerLevelTagIcon };

/** Tags keyed by the power level they label. */
export type PowerLevelTags = { [level: number]: PowerLevelTag };

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

/** The valid tags of a power level tags state event's content; anyone may write it. */
export const readPowerLevelTags = (content: unknown): PowerLevelTags => {
  const tags: PowerLevelTags = {};
  if (!content || typeof content !== 'object') return tags;
  Object.entries(content as Record<string, unknown>).forEach(([level, value]) => {
    const powerLevel = Number(level);
    const tag = readTag(value);
    if (Number.isFinite(powerLevel) && tag) tags[powerLevel] = tag;
  });
  return tags;
};

/** Translation keys of the names levels get when the room's tags leave them unnamed. */
export const DEFAULT_POWER_LEVEL_TAG_KEYS = {
  100: 'sharedUi.powerLevels.admin',
  50: 'sharedUi.powerLevels.moderator',
  0: 'sharedUi.powerLevels.member',
} as const;

/** The room's power level tags over the default names, following changes to the tags event. */
export const usePowerLevelTags = (room: Room): PowerLevelTags => {
  const { t } = useTranslation();
  const content = useStateEvent(room, StateEvent.PowerLevelTags)?.getContent();
  return useMemo(() => {
    const tags: PowerLevelTags = {};
    Object.entries(DEFAULT_POWER_LEVEL_TAG_KEYS).forEach(([level, key]) => {
      tags[Number(level)] = { name: t(key) };
    });
    return { ...tags, ...readPowerLevelTags(content) };
  }, [t, content]);
};
