import { config, toRem } from 'folds';
import { describe, expect, it } from 'vitest';
import { MESSAGE_AVATAR_SIZE, MESSAGE_AVATAR_WIDTH_PX } from '../layout/config';
import { getModelBadgeMaxWidth } from './modelBadgeLayout';

describe('Mindroom model badge avatar layout', () => {
  it('lets the centred badge hang the same overhang past each side of the avatar', () => {
    const avatarWidth = toRem(MESSAGE_AVATAR_WIDTH_PX);

    expect(MESSAGE_AVATAR_SIZE).toBe('300');
    expect(MESSAGE_AVATAR_WIDTH_PX).toBe(36);
    expect(getModelBadgeMaxWidth(avatarWidth, config.space.S100)).toBe(
      `calc(${avatarWidth} + 2 * ${config.space.S100})`
    );
  });
});
