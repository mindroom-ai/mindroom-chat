import { describe, expect, it } from 'vitest';
import {
  getActivityInvitesPath,
  getActivityPath,
  getActivityRoomPath,
  getThreadsRoomPath,
  isQuickCapturePath,
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

describe('isQuickCapturePath', () => {
  it('knows the widget page, with or without its trailing slash, under the base path', () => {
    expect(isQuickCapturePath('/quick-capture/', '/')).toBe(true);
    expect(isQuickCapturePath('/quick-capture', '/')).toBe(true);
    expect(isQuickCapturePath('/chat/quick-capture/', '/chat')).toBe(true);
    expect(isQuickCapturePath('/chat/quick-capture', '/chat')).toBe(true);
  });

  it('reads the app base path when given none', () => {
    expect(isQuickCapturePath('/quick-capture/')).toBe(true);
    expect(isQuickCapturePath('/home/')).toBe(false);
  });

  it('leaves every other page to the app', () => {
    expect(isQuickCapturePath('/', '/')).toBe(false);
    expect(isQuickCapturePath('/home/', '/')).toBe(false);
    expect(isQuickCapturePath('/quick-capture/more/', '/')).toBe(false);
    expect(isQuickCapturePath('/quick-captured/', '/')).toBe(false);
    expect(isQuickCapturePath('/quick-capture/', '/chat')).toBe(false);
    expect(isQuickCapturePath('/chatter/quick-capture/', '/chat')).toBe(false);
  });
});
