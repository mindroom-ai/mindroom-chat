import { describe, expect, it } from 'vitest';
import { Icons } from 'folds';
import { type TFunction } from 'i18next';
import { translateFromEn } from '../../test/utils/i18n';
import {
  commandPaletteStaticActionPaths,
  getCommandPaletteSearchPagePath,
  getCommandPaletteQuickActions,
} from './commandPaletteActions';
import { commandPaletteSearchConfig, searchCommandPaletteSection } from './commandPaletteSearch';

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
      'page-theme',
      'toggle-theme',
      'page-message-layout',
      'page-language',
      'take-quick-tour',
      'take-full-tour',
      'logout',
    ]);
  });

  it('opens the Theme, Message Layout and App Language pages from rows of their own', () => {
    const actions = getCommandPaletteQuickActions({}, t);
    expect(actions.find((item) => item.id === 'page-theme')).toMatchObject({
      title: 'Theme',
      page: 'theme',
      sortRank: 25,
      icon: Icons.Sun,
      keywords: ['appearance', 'dark', 'light', 'colors'],
    });
    expect(actions.find((item) => item.id === 'page-message-layout')).toMatchObject({
      title: 'Message Layout',
      page: 'message-layout',
      sortRank: 18,
      icon: Icons.Message,
      keywords: ['modern', 'compact', 'bubble'],
    });
    expect(actions.find((item) => item.id === 'page-language')).toMatchObject({
      title: 'App Language',
      page: 'language',
      sortRank: 17,
      icon: Icons.Globe,
      keywords: ['locale', 'translation'],
    });
  });

  it('shows the keys of Open Settings and of resolving a thread', () => {
    const shortcutOf = (id: string, resolved: boolean) =>
      getCommandPaletteQuickActions(
        { currentThreadId: '$thread', isCurrentThreadResolved: resolved },
        t
      ).find((item) => item.id === id)?.shortcut;
    expect(shortcutOf('open-settings', false)).toBe('settings');
    expect(shortcutOf('resolve-current-thread', false)).toBe('resolveThread');
    expect(shortcutOf('unresolve-current-thread', true)).toBe('resolveThread');
  });

  it('gives every action an icon of its own', () => {
    const icons = Object.fromEntries(
      getCommandPaletteQuickActions(
        { currentRoomName: 'General', currentThreadId: '$thread' },
        t
      ).map((item) => [item.id, item.icon])
    );
    expect(icons).toEqual({
      'open-settings': Icons.Setting,
      'go-home': Icons.Home,
      'go-direct': Icons.Message,
      'go-activity': Icons.Bell,
      'create-room': Icons.HashPlus,
      'create-space': Icons.SpacePlus,
      'mark-current-room-read': Icons.CheckTwice,
      'copy-current-room-link': Icons.Link,
      'open-current-room-settings': Icons.Setting,
      'resolve-current-thread': Icons.Check,
      'page-theme': Icons.Sun,
      'toggle-theme': Icons.Sun,
      'page-message-layout': Icons.Message,
      'page-language': Icons.Globe,
      'take-quick-tour': Icons.Info,
      'take-full-tour': Icons.Info,
      logout: Icons.Power,
    });
    const unresolve = getCommandPaletteQuickActions(
      { currentThreadId: '$thread', isCurrentThreadResolved: true },
      t
    ).find((item) => item.id === 'unresolve-current-thread');
    expect(unresolve?.icon).toBe(Icons.Check);
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

  it('lists the actions in the order their ranks show them, each rank once', () => {
    const ranks = getCommandPaletteQuickActions(
      { currentRoomName: 'General', currentThreadId: '$thread' },
      t
    ).map((item) => item.sortRank ?? 0);
    expect(ranks).toEqual([...ranks].sort((left, right) => right - left));
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('offers the interface tour in both levels, found by help, tutorial and guide too', () => {
    const actions = getCommandPaletteQuickActions({}, t);
    const keywords = ['help', 'tutorial', 'guide', 'threads', 'onboarding'];
    expect(actions.find((item) => item.id === 'take-quick-tour')).toMatchObject({
      kind: 'action',
      title: 'Take the quick tour',
      description: 'See how threads work',
      keywords,
    });
    expect(actions.find((item) => item.id === 'take-full-tour')).toMatchObject({
      kind: 'action',
      title: 'Take the full tour',
      description: 'See how threads work',
      keywords,
    });
  });

  it('keeps the tour below the everyday actions, and finds both levels by "tutorial"', () => {
    const items = getCommandPaletteQuickActions({}, t);
    const shown = (query: string) =>
      searchCommandPaletteSection({ items, query, config: commandPaletteSearchConfig.actions }).map(
        (item) => item.id
      );
    expect(shown('').slice(0, 3)).toEqual(['open-settings', 'go-home', 'go-direct']);
    expect(shown('tutorial')).toEqual(['take-quick-tour', 'take-full-tour']);
    expect(shown('quick tour')[0]).toBe('take-quick-tour');
    expect(shown('full tour')[0]).toBe('take-full-tour');
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
