// @vitest-environment jsdom
import type { Page } from '@playwright/test';
import { createStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultThreadFilterState,
  createHiddenOverviewFilterState,
  seedRoomOverviewState,
} from '../../../../e2e/helpers/matrix';
import { deserializeThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';
import { roomThreadFilterAtomFamily } from './roomThreadFilterState';

describe('e2e room overview filter seed', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each([
    ['explicit All', createDefaultThreadFilterState()],
    ['default hidden overview', undefined],
  ] as const)(
    'the app reads the %s seed for the requested and active users',
    async (_, filterState) => {
      const userId = `@reader ${filterState ? 'all' : 'hidden'}:example.org`;
      const activeUserId = `@active ${filterState ? 'all' : 'hidden'}:example.org`;
      const roomId = '!project/notes:example.org';
      localStorage.setItem(
        'mindroom_multi_account_store',
        JSON.stringify({
          activeSessionId: 'session',
          sessions: [{ sessionId: 'session', userId: activeUserId }],
        })
      );
      const store = createStore();
      const atoms = [userId, activeUserId].map((id) => roomThreadFilterAtomFamily(id, roomId));
      const unsubscribe = atoms.map((atom) => store.sub(atom, () => undefined));
      const page = {
        addInitScript: vi.fn(),
        evaluate: vi.fn(async (script: (arg: unknown) => unknown, arg: unknown) => script(arg)),
      } as unknown as Page;

      try {
        expect(atoms.map((atom) => store.get(atom))).toEqual([null, null]);
        await seedRoomOverviewState({ page, roomId, userId, viewMode: 'compact', filterState });
        const expected = deserializeThreadFilterState(
          filterState ?? createHiddenOverviewFilterState()
        );
        expect(atoms.map((atom) => store.get(atom))).toEqual([expected, expected]);
        expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
          simpleThreadFilters: false,
        });
      } finally {
        unsubscribe.forEach((stop) => stop());
      }
    }
  );
});
