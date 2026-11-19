import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRoomInputDrafts,
  composerOfferAtom,
  composerReplyDraftAtom,
  composerUploadItemsAtom,
  getRoomInputDraftKey,
  restoreTextToDraft,
  roomIdToMsgDraftAtomFamily,
} from './roomInputDrafts';
import { shownConversationViewsAtom } from '../navigation/conversationView';

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
  it('is busy with any work in the composer: text, a staged file or a reply, not only text', () => {
    const store = createStore();
    const roomId = '!offer:example.org';
    const key: [string, string, string] = ['@alice:example.org', roomId, '$thread'];
    const offer = [{ type: 'paragraph', children: [{ text: 'Text version, please' }] }] as never[];
    const draft = roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(...key));
    const state = composerOfferAtom(key, offer);
    expect(store.get(state)).toBe('empty');
    store.set(draft, offer);
    expect(store.get(state)).toBe('offered');
    store.set(draft, [{ type: 'paragraph', children: [{ text: 'my own words' }] }] as never[]);
    expect(store.get(state)).toBe('busy');
    store.set(draft, []);
    // Another thread's text is not this composer's work.
    store.set(roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(key[0], roomId, '$other')), offer);
    expect(store.get(state)).toBe('empty');
    const file = new File(['x'], 'notes.txt');
    const staged = (f: File) => [
      { file: f, originalFile: f, encInfo: undefined, metadata: { markedAsSpoiler: false } },
    ];
    store.set(composerUploadItemsAtom(roomId, undefined), { type: 'PUT', item: staged(file) });
    expect(store.get(state)).toBe('busy');
    store.set(composerUploadItemsAtom(roomId, undefined), { type: 'RESET' });
    expect(store.get(state)).toBe('empty');
    // A view showing the thread (its column) stages files of its own.
    store.set(composerUploadItemsAtom(roomId, 'column'), { type: 'PUT', item: staged(file) });
    expect(store.get(state)).toBe('empty');
    store.set(shownConversationViewsAtom, [{ view: 'column', roomId, threadId: '$thread' }]);
    expect(store.get(state)).toBe('busy');
    store.set(shownConversationViewsAtom, [{ view: 'column', roomId, threadId: '$other' }]);
    expect(store.get(state)).toBe('empty');
    store.set(composerReplyDraftAtom(roomId, undefined), {
      userId: '@bob:example.org',
      eventId: '$event',
      body: 'Earlier message',
    });
    expect(store.get(state)).toBe('busy');
    store.set(composerReplyDraftAtom(roomId, undefined), undefined);
  });
});
