import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearKeptPastes,
  forgetPastesOutsideDraft,
  keepPasteText,
  readKeptPasteTexts,
} from './keptPastes';

const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';
const ROOM_DRAFT = JSON.stringify([ALICE, '!room:example.org']);
const THREAD_DRAFT = JSON.stringify([ALICE, '!room:example.org', '$thread']);
const LOG = 'line\n'.repeat(30_000);

afterEach(async () => {
  await clearKeptPastes(ALICE);
  await clearKeptPastes(BOB);
});

describe('kept paste texts', () => {
  it('gives back the text kept for a paste, and nothing for one never kept', async () => {
    await keepPasteText(ALICE, ROOM_DRAFT, 'mindroom-paste-a1b2c3.txt', LOG);
    const texts = await readKeptPasteTexts(ALICE, [
      'mindroom-paste-a1b2c3.txt',
      'mindroom-paste-ffffff.txt',
    ]);
    expect([...texts.keys()]).toEqual(['mindroom-paste-a1b2c3.txt']);
    expect(texts.get('mindroom-paste-a1b2c3.txt')).toBe(LOG);
  });

  it("keeps each account's pastes apart", async () => {
    await keepPasteText(BOB, ROOM_DRAFT, 'mindroom-paste-a1b2c3.txt', 'bob');
    expect((await readKeptPasteTexts(ALICE, ['mindroom-paste-a1b2c3.txt'])).size).toBe(0);
  });

  it('forgets the pastes a draft no longer holds, and only that draft’s', async () => {
    await keepPasteText(ALICE, ROOM_DRAFT, 'mindroom-paste-000001.txt', 'sent');
    await keepPasteText(ALICE, ROOM_DRAFT, 'mindroom-paste-000002.txt', 'still in the draft');
    await keepPasteText(ALICE, THREAD_DRAFT, 'mindroom-paste-000003.txt', 'in a thread draft');
    await forgetPastesOutsideDraft(ALICE, ROOM_DRAFT, new Set(['mindroom-paste-000002.txt']));
    const texts = await readKeptPasteTexts(ALICE, [
      'mindroom-paste-000001.txt',
      'mindroom-paste-000002.txt',
      'mindroom-paste-000003.txt',
    ]);
    expect([...texts.keys()].sort()).toEqual([
      'mindroom-paste-000002.txt',
      'mindroom-paste-000003.txt',
    ]);
  });

  it("forgets every paste of an account at sign-out, and no other account's", async () => {
    await keepPasteText(ALICE, ROOM_DRAFT, 'mindroom-paste-000001.txt', 'alice');
    await keepPasteText(ALICE, THREAD_DRAFT, 'mindroom-paste-000002.txt', 'alice');
    await keepPasteText(BOB, ROOM_DRAFT, 'mindroom-paste-000003.txt', 'bob');
    await clearKeptPastes(ALICE);
    const names = ['mindroom-paste-000001.txt', 'mindroom-paste-000002.txt'];
    expect((await readKeptPasteTexts(ALICE, names)).size).toBe(0);
    expect((await readKeptPasteTexts(BOB, ['mindroom-paste-000003.txt'])).size).toBe(1);
  });
});
