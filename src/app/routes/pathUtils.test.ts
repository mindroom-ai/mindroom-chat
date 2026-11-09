import { describe, expect, it } from 'vitest';
import {
  getActivityInvitesPath,
  getActivityPath,
  getActivityRoomPath,
  getThreadsRoomPath,
} from './pathUtils';

describe('Activity and Threads paths', () => {
  it('addresses the sections and their invite list', () => {
    expect(getActivityPath()).toBe('/activity/');
    expect(getActivityInvitesPath()).toBe('/activity/invites/');
  });

  it('puts a room, and an event of it, inside the section', () => {
    expect(getActivityRoomPath('!r:x')).toBe('/activity/!r%3Ax');
    expect(getActivityRoomPath('!r:x', '$e')).toBe('/activity/!r%3Ax/%24e');
    expect(getThreadsRoomPath('#a:x')).toBe('/threads/%23a%3Ax');
  });
});
