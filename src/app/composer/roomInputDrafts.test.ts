import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRoomInputDrafts,
  composerOfferAtom,
  composerReplyDraftAtom,
  composerUploadItemsAtom,
  pendingVoiceSendDraftAtom,
  threadViewVoiceComposersAtom,
  getRoomInputDraftKey,
  restoreTextToDraft,
  roomIdToMsgDraftAtomFamily,
} from './roomInputDrafts';

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
  it("is busy only with the destination's own work, in a composer mounted for it", () => {
    const store = createStore();
    const roomId = '!offer:example.org';
    const key: [string, string, string] = ['@alice:example.org', roomId, '$thread'];
    const offer = [{ type: 'paragraph', children: [{ text: 'Text version, please' }] }] as never[];
    const draft = roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(...key));
    const state = composerOfferAtom(key, offer);
    const roomState = composerOfferAtom([key[0], roomId], offer);
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
    const voice = (threadId: string | undefined, threadView: boolean) =>
      store.set(pendingVoiceSendDraftAtom, {
        file,
        duration: 1,
        context: { roomId, threadId, threadView } as never,
      });
    voice('$other', true);
    expect(store.get(state)).toBe('empty');
    voice(undefined, false);
    expect(store.get(state)).toBe('empty');
    expect(store.get(roomState)).toBe('busy');
    voice('$thread', true);
    expect(store.get(state)).toBe('busy');
    store.set(pendingVoiceSendDraftAtom, undefined);
  });
});
