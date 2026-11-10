import { describe, expect, it } from 'vitest';
import { type TFunction } from 'i18next';
import { translateFromEn } from '../../test/utils/i18n';
import {
  commandPaletteStaticActionPaths,
  getCommandPaletteSearchPagePath,
  getCommandPaletteQuickActions,
} from './commandPaletteActions';

const t = translateFromEn as unknown as TFunction;

describe('getCommandPaletteQuickActions', () => {
  it('shows only the global action set when no room or thread is selected', () => {
    expect(getCommandPaletteQuickActions({}, t).map((item) => item.id)).toEqual([
      'open-settings',
      'go-home',
      'go-direct',
      'go-activity',
      'create-room',
      'create-space',
      'toggle-theme',
      'logout',
    ]);
  });

  it('adds room-scoped actions when a room is selected', () => {
    expect(
      getCommandPaletteQuickActions(
        {
          currentRoomName: 'General',
        },
        t
      ).map((item) => item.id)
    ).toContain('mark-current-room-read');
    expect(
      getCommandPaletteQuickActions(
        {
          currentRoomName: 'General',
        },
        t
      ).map((item) => item.id)
    ).toContain('open-current-room-settings');
  });

  it('switches between resolve and unresolve for the active thread', () => {
    expect(
      getCommandPaletteQuickActions(
        {
          currentThreadId: '$thread',
          isCurrentThreadResolved: false,
        },
        t
      ).map((item) => item.id)
    ).toContain('resolve-current-thread');
    expect(
      getCommandPaletteQuickActions(
        {
          currentThreadId: '$thread',
          isCurrentThreadResolved: false,
        },
        t
      ).map((item) => item.id)
    ).not.toContain('unresolve-current-thread');

    expect(
      getCommandPaletteQuickActions(
        {
          currentThreadId: '$thread',
          isCurrentThreadResolved: true,
        },
        t
      ).map((item) => item.id)
    ).toContain('unresolve-current-thread');
  });

  it('omits both resolution commands for pinned threads', () => {
    const ids = getCommandPaletteQuickActions(
      {
        currentThreadId: '$pinned',
        isCurrentThreadPinned: true,
      },
      t
    ).map((item) => item.id);
    expect(ids).not.toContain('resolve-current-thread');
    expect(ids).not.toContain('unresolve-current-thread');
  });

  it('describes Go to Activity, found by invites, notifications and the old Inbox too', () => {
    const goActivity = getCommandPaletteQuickActions({}, t).find(
      (item) => item.id === 'go-activity'
    );
    expect(goActivity?.title).toBe('Go to Activity');
    expect(goActivity?.description).toBe('Mentions, replies and what waits for you');
    expect(goActivity?.keywords).toEqual(['inbox', 'invites', 'notifications', 'mentions']);
  });
});

describe('getCommandPaletteSearchPagePath', () => {
  it('opens the message search page for the trimmed text across every room', () => {
    expect(getCommandPaletteSearchPagePath('  deploy checklist ')).toBe(
      '/home/search/?term=deploy+checklist&global=true'
    );
  });
});

describe('commandPaletteStaticActionPaths', () => {
  it('exposes the existing route helpers for the static navigation actions', () => {
    expect(commandPaletteStaticActionPaths).toEqual({
      goHome: '/home/',
      goDirect: '/direct/',
      goActivity: '/activity/',
    });
  });
});
