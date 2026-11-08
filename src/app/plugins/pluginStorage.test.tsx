// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_STORE_KEY, removeSession } from '../matrix/session/sessions';
import { deletePluginStorageOfRemovedAccounts } from './pluginStorage';
import { ALICE, BOB, LOOKALIKE, signIn, storageOf } from './test-utils/pluginStorage';

beforeEach(() => {
  [ALICE, BOB, LOOKALIKE].forEach(signIn);
});

afterEach(() => {
  localStorage.clear();
});

describe('usePluginStorage', () => {
  it('keeps each value for the signed-in account and the plugin that stored it', () => {
    expect(storageOf('notes', ALICE).setItem('draft', 'Alice writes')).toBe(true);

    expect(storageOf('notes', ALICE).getItem('draft')).toBe('Alice writes');
    expect(storageOf('notes', BOB).getItem('draft')).toBeNull();
    expect(storageOf('drafts', ALICE).getItem('draft')).toBeNull();

    storageOf('notes', ALICE).removeItem('draft');
    expect(storageOf('notes', ALICE).getItem('draft')).toBeNull();
  });

  it('stores nothing once no login of the account is left, removed in this tab or another', () => {
    const notes = storageOf('notes', ALICE);

    // As sign-out does, in whichever tab, before it deletes the storage; a component that saves as
    // it unmounts then must not put the value back.
    removeSession(signIn(ALICE).sessionId);

    expect(notes.setItem('draft', 'Saved as the page goes')).toBe(false);
    expect(notes.getItem('draft')).toBeNull();
    // The account signs in again: it stores again.
    signIn(ALICE);
    expect(notes.setItem('draft', 'Alice again')).toBe(true);
    expect(notes.getItem('draft')).toBe('Alice again');
  });
});

describe('deletePluginStorageOfRemovedAccounts', () => {
  /** A value a plugin wrote for `userId` in another tab as the account signed out there. */
  const writtenInAnotherTab = (userId: string) =>
    localStorage.setItem(`mindroom.plugin:${encodeURIComponent(userId)}/notes/draft`, 'Raced');

  it('deletes the plugin storage of accounts without a stored login, and keeps the rest', () => {
    storageOf('notes', BOB).setItem('draft', 'Bob writes');
    storageOf('notes', LOOKALIKE).setItem('draft', 'Someone else');
    localStorage.setItem('unrelated', 'kept');
    removeSession(signIn(ALICE).sessionId);
    writtenInAnotherTab(ALICE);

    deletePluginStorageOfRemovedAccounts();

    expect(storageOf('notes', ALICE).getItem('draft')).toBeNull();
    expect(storageOf('notes', BOB).getItem('draft')).toBe('Bob writes');
    expect(storageOf('notes', LOOKALIKE).getItem('draft')).toBe('Someone else');
    expect(localStorage.getItem('unrelated')).toBe('kept');
  });

  it.each([
    ["a newer version's list", { version: 99, sessions: [] }],
    ['an entry of a newer kind', { version: 1, sessions: [{ kind: 'newer' }] }],
  ])(
    'keeps all of it while the account list holds %s, which this version cannot read',
    (_, list) => {
      writtenInAnotherTab(ALICE);
      localStorage.setItem(SESSION_STORE_KEY, JSON.stringify(list));

      deletePluginStorageOfRemovedAccounts();

      expect(storageOf('notes', ALICE).getItem('draft')).toBe('Raced');
    }
  );
});
