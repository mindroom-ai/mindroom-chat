import { Icons } from 'folds';
import { JoinRule } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { getRoomIconSrc } from './roomIconSrc';
import { WorkRoomGlobeIcon, WorkRoomIcon, WorkRoomLockIcon } from './workRoomIcons';

describe('getRoomIconSrc', () => {
  it('frames the hash of a work room and keeps its join rule badge', () => {
    expect(getRoomIconSrc(false, JoinRule.Invite, true)).toBe(WorkRoomLockIcon);
    expect(getRoomIconSrc(false, JoinRule.Knock, true)).toBe(WorkRoomLockIcon);
    expect(getRoomIconSrc(false, JoinRule.Public, true)).toBe(WorkRoomGlobeIcon);
    expect(getRoomIconSrc(false, JoinRule.Restricted, true)).toBe(WorkRoomIcon);
    expect(getRoomIconSrc(false, undefined, true)).toBe(WorkRoomIcon);
  });

  it('keeps the plain hash for other rooms and the space icons for spaces', () => {
    expect(getRoomIconSrc(false, JoinRule.Invite)).toBe(Icons.HashLock);
    expect(getRoomIconSrc(false, JoinRule.Public)).toBe(Icons.HashGlobe);
    expect(getRoomIconSrc(false, JoinRule.Restricted)).toBe(Icons.Hash);
    expect(getRoomIconSrc(true, JoinRule.Invite, true)).toBe(Icons.SpaceLock);
  });
});
