import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRoomInputDrafts,
  composerOfferAtom,
  composerReplyDraftAtom,
  composerUploadItemsAtom,
  pendingVoiceSendDraftAtom,
  threadViewVoiceComposersAtom,
  forgetComposerStateOfSession,
  getHomeAskDraftKey,
  getRoomInputDraftKey,
  getSpaceThreadsDraftKey,
  keepStagedFileNames,
  spaceThreadsDestinationAtomFamily,
  homeAskDestinationAtomFamily,
  homeAskPendingAtomFamily,
  restoreTextToDraft,
  roomIdToMsgDraftAtomFamily,
} from './roomInputDrafts';
import { confirmedVoiceThreadId } from './RoomInputExtensions';

const KEY = JSON.stringify(['@alice:example.org', '!room:example.org', '$thread']);
const draft = [{ type: 'paragraph' as const, children: [{ text: 'Unsent draft', bold: true }] }];

describe('message draft persistence', () => {
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map();
    vi.stubGlobal('localStorage', {
      get length() {
        return values.size;
      },
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    roomIdToMsgDraftAtomFamily.remove(KEY);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('restores formatted text after all in-memory draft state is lost', () => {
    createStore().set(roomIdToMsgDraftAtomFamily(KEY), draft);
    roomIdToMsgDraftAtomFamily.remove(KEY);
    expect(createStore().get(roomIdToMsgDraftAtomFamily(KEY))).toEqual(draft);
  });

  it('removes a cleared draft from storage', () => {
    const store = createStore();
    const atom = roomIdToMsgDraftAtomFamily(KEY);
    store.set(atom, draft);
    expect(values.size).toBe(1);
    store.set(atom, []);
    expect(values.size).toBe(0);
    roomIdToMsgDraftAtomFamily.remove(KEY);
    expect(createStore().get(roomIdToMsgDraftAtomFamily(KEY))).toEqual([]);
  });

  it('revokes stale writes after account cleanup while permitting a fresh session', () => {
    const store = createStore();
    const staleAtom = roomIdToMsgDraftAtomFamily(KEY);
    store.set(staleAtom, draft);
    clearRoomInputDrafts('@alice:example.org');
    store.set(staleAtom, draft);
    expect(values.size).toBe(0);
    const freshAtom = roomIdToMsgDraftAtomFamily(KEY);
    expect(store.get(freshAtom)).toEqual([]);
    store.set(freshAtom, draft);
    expect(values.size).toBe(1);
  });

  it('keeps drafts usable when storage writes fail', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage blocked');
      },
      setItem: () => {
        throw new Error('Storage full');
      },
      removeItem: () => {
        throw new Error('Storage blocked');
      },
    });
    const store = createStore();
    const atom = roomIdToMsgDraftAtomFamily(KEY);
    expect(() => store.set(atom, draft)).not.toThrow();
    expect(store.get(atom)).toEqual(draft);
  });

  it.each(['{invalid', '{}', '[{"type":"paragraph","children":[]}]', '[{"text":5}]'])(
    'ignores corrupt stored editor content: %s',
    (invalid) => {
      createStore().set(roomIdToMsgDraftAtomFamily(KEY), draft);
      values.forEach((_, key) => values.set(key, invalid));
      roomIdToMsgDraftAtomFamily.remove(KEY);
      expect(createStore().get(roomIdToMsgDraftAtomFamily(KEY))).toEqual([]);
    }
  );

  describe("Home's ask draft", () => {
    const ROBIN = '@robin:example.org';
    const HOME_KEY = getHomeAskDraftKey(ROBIN);
    // Read anew for each test: clearing the account's drafts revokes the atoms it had.
    let homeDraft: ReturnType<typeof roomIdToMsgDraftAtomFamily>;
    let destination: ReturnType<typeof homeAskDestinationAtomFamily>;
    const text = (words: string) => [{ type: 'paragraph' as const, children: [{ text: words }] }];
    const toDirect = { agentId: '@mindroom_helper:example.org', roomId: '!direct', isDirect: true };
    const toShared = { agentId: '@mindroom_helper:example.org', roomId: '!shared' };
    const stored = () => JSON.parse(values.get(`roomInputDraft:${HOME_KEY}`) ?? 'null') as unknown;

    beforeEach(() => {
      clearRoomInputDrafts(ROBIN);
      homeDraft = roomIdToMsgDraftAtomFamily(HOME_KEY);
      destination = homeAskDestinationAtomFamily(ROBIN);
    });

    it('stores the text and where it goes in one entry, which no other tab can split', () => {
      // Two tabs of the account, each a store of its own over the one storage.
      const tabA = createStore();
      const tabB = createStore();
      tabA.set(destination, toDirect);
      tabA.set(homeDraft, text('Private note'));
      expect(stored()).toEqual({ draft: text('Private note'), destination: toDirect });

      // The other tab shows the stored draft, sends it to a shared room and types on.
      expect(tabB.get(homeDraft)).toEqual(text('Private note'));
      tabB.set(destination, toShared);
      tabB.set(homeDraft, text('For everyone'));
      expect(stored()).toEqual({ draft: text('For everyone'), destination: toShared });

      // Typing on in the first tab stores its text with its own destination, never the other's.
      tabA.set(homeDraft, text('Private note, longer'));
      expect(stored()).toEqual({ draft: text('Private note, longer'), destination: toDirect });
      expect(values.size).toBe(1);
      // What a reload of either tab finds is that pair.
      roomIdToMsgDraftAtomFamily.remove(HOME_KEY);
      expect(createStore().get(roomIdToMsgDraftAtomFamily(HOME_KEY))).toEqual(
        text('Private note, longer')
      );
      expect(createStore().get(destination)).toEqual(toDirect);
    });

    it('reads the text and where it goes in one snapshot, whatever is stored between the two', () => {
      const writer = createStore();
      writer.set(destination, toDirect);
      writer.set(homeDraft, text('Private note'));
      // A tab reads the text; another tab stores its own entry before the first reads where
      // its text goes.
      const tab = createStore();
      expect(tab.get(homeDraft)).toEqual(text('Private note'));
      writer.set(destination, toShared);
      writer.set(homeDraft, text('For everyone'));
      expect(tab.get(destination)).toEqual(toDirect);

      // In the other order too.
      const late = createStore();
      expect(late.get(destination)).toEqual(toShared);
      writer.set(destination, toDirect);
      writer.set(homeDraft, text('Private note'));
      expect(late.get(homeDraft)).toEqual(text('For everyone'));
    });

    it('writes nothing as a page shows what is stored, so never over a newer entry of another tab', () => {
      const writer = createStore();
      writer.set(destination, toDirect);
      writer.set(homeDraft, text('Private note'));
      const tab = createStore();
      expect(tab.get(homeDraft)).toEqual(text('Private note'));
      const empty = createStore();
      writer.set(homeDraft, []);
      expect(empty.get(homeDraft)).toEqual([]);
      writer.set(destination, toShared);
      writer.set(homeDraft, text('For everyone'));
      const newer = values.get(`roomInputDraft:${HOME_KEY}`);

      // Home opens in the first tab on the draft it read, and sets where that goes: to what it is.
      tab.set(destination, { ...toDirect });
      // Home opens in a tab without a draft, and sets where a question would go.
      empty.set(destination, toDirect);
      expect(values.get(`roomInputDraft:${HOME_KEY}`)).toBe(newer);
      expect(empty.get(destination)).toEqual(toDirect);
    });

    it('stores a changed destination with the text its own tab shows', () => {
      createStore().set(homeDraft, text('Kept over a reload'));
      // A tab opens on the stored draft, then another tab stores a draft of its own.
      const tab = createStore();
      expect(tab.get(homeDraft)).toEqual(text('Kept over a reload'));
      const other = createStore();
      other.set(destination, toShared);
      other.set(homeDraft, text('For everyone'));

      tab.set(destination, toDirect);
      expect(stored()).toEqual({ draft: text('Kept over a reload'), destination: toDirect });
      // A destination alone stores nothing: an emptied draft leaves no entry.
      tab.set(homeDraft, []);
      tab.set(destination, toShared);
      expect(values.size).toBe(0);
    });

    it('reads a stored draft whose destination is missing or corrupt as having none', () => {
      const entry = `roomInputDraft:${HOME_KEY}`;
      values.set(entry, JSON.stringify({ draft: text('Orphaned'), destination: { roomId: 5 } }));
      const orphaned = createStore();
      expect(orphaned.get(homeDraft)).toEqual(text('Orphaned'));
      expect(orphaned.get(destination)).toBeUndefined();
      values.set(entry, JSON.stringify(text('An array, as a room draft is stored')));
      expect(createStore().get(destination)).toBeUndefined();
    });

    it("is cleared with the account's other drafts, in storage and in memory", () => {
      const store = createStore();
      store.set(destination, toDirect);
      store.set(homeDraft, text('Private note'));
      expect(values.size).toBe(1);
      clearRoomInputDrafts(ROBIN);
      expect(values.size).toBe(0);
      expect(createStore().get(homeAskDestinationAtomFamily(ROBIN))).toBeUndefined();
      expect(store.get(homeAskDestinationAtomFamily(ROBIN))).toBeUndefined();
    });

    it("forgets a question on its way with the account's drafts, and as its session ends", () => {
      const store = createStore();
      const sending = { state: 'sending' as const, ...toDirect, isDirect: true };
      store.set(homeAskPendingAtomFamily(ROBIN), sending);
      clearRoomInputDrafts(ROBIN);
      expect(store.get(homeAskPendingAtomFamily(ROBIN))).toBeUndefined();

      store.set(homeAskPendingAtomFamily(ROBIN), sending);
      forgetComposerStateOfSession(store);
      expect(store.get(homeAskPendingAtomFamily(ROBIN))).toBeUndefined();
    });
  });

  describe('Space All threads draft', () => {
    const ROBIN = '@robin:example.org';
    const SPACE = '!space:example.org';

    afterEach(() => clearRoomInputDrafts(ROBIN));

    it('keeps draft paired across account switch, persists file-only destination, and cleans up', () => {
      const spaceKey = getSpaceThreadsDraftKey(ROBIN, SPACE);
      const store = createStore();
      store.set(spaceThreadsDestinationAtomFamily(spaceKey), '!eng:example.org');
      store.set(roomIdToMsgDraftAtomFamily(spaceKey), draft);

      // Switching account and back keeps text and destination atoms paired.
      forgetComposerStateOfSession(store);
      const edited = [{ type: 'paragraph' as const, children: [{ text: 'Updated' }] }];
      store.set(spaceThreadsDestinationAtomFamily(spaceKey), '!des:example.org');
      store.set(roomIdToMsgDraftAtomFamily(spaceKey), edited);

      const reloaded = createStore();
      expect(reloaded.get(roomIdToMsgDraftAtomFamily(spaceKey))).toEqual(edited);
      expect(reloaded.get(spaceThreadsDestinationAtomFamily(spaceKey))).toBe('!des:example.org');

      // File-only draft persists destination until kept files are gone.
      clearRoomInputDrafts(ROBIN);
      const fileStore = createStore();
      const file = new File(['x'], 'deck.pdf', { type: 'application/pdf' });
      const staged = {
        file,
        originalFile: file,
        encInfo: undefined,
        metadata: { markedAsSpoiler: false },
      };
      fileStore.set(spaceThreadsDestinationAtomFamily(spaceKey), '!des:example.org');
      keepStagedFileNames(ROBIN, spaceKey, [staged], fileStore);
      expect(createStore().get(spaceThreadsDestinationAtomFamily(spaceKey))).toBe(
        '!des:example.org'
      );

      keepStagedFileNames(ROBIN, spaceKey, [], fileStore);
      expect(values.has(`roomInputDraft:${spaceKey}`)).toBe(false);
      expect(createStore().get(spaceThreadsDestinationAtomFamily(spaceKey))).toBeUndefined();
    });
  });
});

describe('restoreTextToDraft', () => {
  it("puts a failed caption after the text a composer's stored draft holds, losing neither", () => {
    const store = createStore();
    const key = getRoomInputDraftKey('@alice:example.org', '!restore:example.org');
    const typed = [{ type: 'paragraph', children: [{ text: 'typed since' }] }] as never[];
    const caption = [{ type: 'paragraph', children: [{ text: 'the caption' }] }] as never[];
    store.set(roomIdToMsgDraftAtomFamily(key), typed);
    restoreTextToDraft(store, key, caption);
    expect(store.get(roomIdToMsgDraftAtomFamily(key))).toEqual([...typed, ...caption]);
    store.set(roomIdToMsgDraftAtomFamily(key), []);
  });
});

describe('composerOfferAtom', () => {
  it("is busy only with the destination's own work, in a composer mounted for it", () => {
    const store = createStore();
    const roomId = '!offer:example.org';
    const key: [string, string, string] = ['@alice:example.org', roomId, '$thread'];
    const offer = [{ type: 'paragraph', children: [{ text: 'Text version, please' }] }] as never[];
    const draft = roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(...key));
    const state = composerOfferAtom(key, offer, confirmedVoiceThreadId);
    const roomState = composerOfferAtom([key[0], roomId], offer, confirmedVoiceThreadId);
    const file = new File(['x'], 'notes.txt');
    const staged = [
      { file, originalFile: file, encInfo: undefined, metadata: { markedAsSpoiler: false } },
    ];
    const reply = { userId: '@bob:example.org', eventId: '$event', body: 'Earlier message' };
    expect(store.get(state)).toBe('empty');
    store.set(draft, offer);
    expect(store.get(state)).toBe('offered');
    store.set(draft, [{ type: 'paragraph', children: [{ text: 'my own words' }] }] as never[]);
    expect(store.get(state)).toBe('busy');
    store.set(draft, []);
    // Another thread's text, and the room page's files and reply, are not the thread's work.
    store.set(roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(key[0], roomId, '$other')), offer);
    store.set(composerUploadItemsAtom(roomId, undefined), { type: 'PUT', item: staged });
    store.set(composerReplyDraftAtom(roomId, undefined), reply);
    expect(store.get(state)).toBe('empty');
    expect(store.get(roomState)).toBe('busy');
    store.set(composerUploadItemsAtom(roomId, undefined), { type: 'RESET' });
    store.set(composerReplyDraftAtom(roomId, undefined), undefined);
    expect(store.get(roomState)).toBe('empty');
    // A thread view's composer, mounted for the thread (folded too), holds files or a reply.
    store.set(composerUploadItemsAtom(roomId, 'column'), { type: 'PUT', item: staged });
    store.set(composerReplyDraftAtom(roomId, 'panel'), reply);
    expect(store.get(state)).toBe('empty');
    const mounted = (threadId: string, view: string) => ({
      key: JSON.stringify([roomId, threadId]),
      view,
    });
    store.set(threadViewVoiceComposersAtom, [mounted('$other', 'column')]);
    expect(store.get(state)).toBe('empty');
    store.set(threadViewVoiceComposersAtom, [mounted('$thread', 'column')]);
    expect(store.get(state)).toBe('busy');
    store.set(threadViewVoiceComposersAtom, [mounted('$thread', 'panel')]);
    expect(store.get(state)).toBe('busy');
    store.set(threadViewVoiceComposersAtom, []);
    // A voice message waiting to be sent belongs to the composer that recorded it.
    // The thread's root was still a local echo when this one was recorded; it is '$thread' now.
    const room = {
      getThread: (id: string) =>
        id === '~echo' ? { rootEvent: { getId: () => '$thread' } } : null,
    };
    const voice = (threadId: string | undefined, threadView: boolean) =>
      store.set(pendingVoiceSendDraftAtom, {
        file,
        duration: 1,
        context: { roomId, room, threadId, threadView } as never,
      });
    voice('$other', true);
    expect(store.get(state)).toBe('empty');
    voice(undefined, false);
    expect(store.get(state)).toBe('empty');
    expect(store.get(roomState)).toBe('busy');
    voice('$thread', true);
    expect(store.get(state)).toBe('busy');
    voice('~echo', true);
    expect(store.get(state)).toBe('busy');
    store.set(pendingVoiceSendDraftAtom, undefined);
  });
});
