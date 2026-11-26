import { createStore, Provider } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRoomInputDrafts,
  getRoomInputDraftKey,
  getSpaceThreadsDraftKey,
  type IReplyDraft,
  keepStagedFileNames,
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  type TUploadItem,
} from './roomInputDrafts';
import { ConversationViewContext } from '../navigation/conversationView';
import { useKeptComposerState } from './useKeptComposerState';

const ME = '@me:example.org';
const ROOM = '!room:example.org';
const reply: IReplyDraft = {
  userId: '@ada:example.org',
  eventId: '$original',
  body: 'The original message',
  relation: { rel_type: 'm.thread', event_id: '$root' },
};
const staged = (name: string) =>
  ({ file: new File(['x'], name), originalFile: new File(['x'], name) }) as unknown as TUploadItem;

let values: Map<string, string>;
let renderer: ReactTestRenderer | undefined;
let kept: ReturnType<typeof useKeptComposerState> | undefined;

function Probe({
  userId,
  roomId,
  stagedDraftKey,
}: {
  userId: string;
  roomId: string;
  stagedDraftKey?: string;
}) {
  kept = useKeptComposerState(userId, roomId, stagedDraftKey);
  return null;
}

/**
 * A composer on a new page, the room page's unless `view` names another conversation view: the
 * in-memory atoms are gone, storage stays.
 */
const openPage = (store = createStore(), view?: string, stagedDraftKey?: string) => {
  act(() => {
    renderer = create(
      <Provider store={store}>
        <ConversationViewContext value={view}>
          <Probe userId={ME} roomId={ROOM} stagedDraftKey={stagedDraftKey} />
        </ConversationViewContext>
      </Provider>
    );
  });
  return store;
};

const reload = () => {
  act(() => renderer?.unmount());
  roomIdToReplyDraftAtomFamily.remove(ROOM);
  roomIdToUploadItemsAtomFamily.remove(ROOM);
  return openPage();
};

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
  roomIdToReplyDraftAtomFamily.remove(ROOM);
  roomIdToUploadItemsAtomFamily.remove(ROOM);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe('useKeptComposerState', () => {
  it('brings the reply target back after a reload, and forgets it once cancelled', () => {
    const store = openPage();
    act(() => store.set(roomIdToReplyDraftAtomFamily(ROOM), reply));

    const reloaded = reload();
    expect(reloaded.get(roomIdToReplyDraftAtomFamily(ROOM))).toEqual(reply);

    act(() => reloaded.set(roomIdToReplyDraftAtomFamily(ROOM), undefined));
    expect(reload().get(roomIdToReplyDraftAtomFamily(ROOM))).toBeUndefined();
  });

  it('names the staged files a reload lost until they are dismissed', () => {
    const store = openPage();
    expect(kept?.lostFileNames).toEqual([]);
    keepStagedFileNames(getRoomInputDraftKey(ME, ROOM), [staged('notes.txt'), staged('photo.png')], store);

    reload();
    expect(kept?.lostFileNames).toEqual(['notes.txt', 'photo.png']);
    // Still named after another reload: nothing was attached again.
    reload();
    expect(kept?.lostFileNames).toEqual(['notes.txt', 'photo.png']);

    act(() => kept?.dismissLostFiles());
    expect(kept?.lostFileNames).toEqual([]);
    reload();
    expect(kept?.lostFileNames).toEqual([]);
  });

  it('leaves large pastes out of the notice, since the draft keeps their text', () => {
    const initialStore = openPage();
    keepStagedFileNames(
      getRoomInputDraftKey(ME, ROOM),
      [staged('notes.txt'), staged('mindroom-paste-a3f19c.txt')],
      initialStore
    );
    const store = reload();
    expect(kept?.lostFileNames).toEqual(['notes.txt']);
    // The paste the composer puts back does not answer the notice of the file still missing.
    act(() =>
      store.set(roomIdToUploadItemsAtomFamily(ROOM), {
        type: 'PUT',
        item: [staged('mindroom-paste-a3f19c.txt')],
      })
    );
    expect(kept?.lostFileNames).toEqual(['notes.txt']);
  });

  it('says nothing while the files are still staged, as after switching rooms', () => {
    const store = createStore();
    const items = [staged('notes.txt')];
    store.set(roomIdToUploadItemsAtomFamily(ROOM), { type: 'PUT', item: items });
    keepStagedFileNames(getRoomInputDraftKey(ME, ROOM), items, store);
    openPage(store);
    expect(kept?.lostFileNames).toEqual([]);
  });

  it('keeps nothing of an account that signed out', () => {
    const store = openPage();
    act(() => store.set(roomIdToReplyDraftAtomFamily(ROOM), reply));
    keepStagedFileNames(getRoomInputDraftKey(ME, ROOM), [staged('notes.txt')], store);
    clearRoomInputDrafts(ME);

    expect(reload().get(roomIdToReplyDraftAtomFamily(ROOM))).toBeUndefined();
    expect(kept?.lostFileNames).toEqual([]);
    expect(values.size).toBe(0);
  });

  it("leaves what the room's page kept to that page in another conversation view", () => {
    const store = openPage();
    act(() => store.set(roomIdToReplyDraftAtomFamily(ROOM), reply));
    keepStagedFileNames(getRoomInputDraftKey(ME, ROOM), [staged('notes.txt')], store);
    act(() => renderer?.unmount());
    const kept0 = new Map(values);

    const viewStore = openPage(createStore(), 'thread-view');
    expect(kept?.lostFileNames).toEqual([]);
    expect(viewStore.get(roomIdToReplyDraftAtomFamily(ROOM))).toBeUndefined();
    act(() => kept?.dismissLostFiles());
    expect(values).toEqual(kept0);
  });

  it('scopes staged-draft lost-file notices to stagedDraftKey without restoring room replies', () => {
    const spaceKey = getSpaceThreadsDraftKey(ME, '!space:example.org');
    const roomStore = openPage();
    act(() => roomStore.set(roomIdToReplyDraftAtomFamily(ROOM), reply));
    keepStagedFileNames(getRoomInputDraftKey(ME, ROOM), [staged('room.png')], roomStore);
    keepStagedFileNames(spaceKey, [staged('space.pdf')], roomStore);
    act(() => renderer?.unmount());
    roomIdToReplyDraftAtomFamily.remove(ROOM);

    const spaceStore = openPage(createStore(), undefined, spaceKey);
    expect(kept?.lostFileNames).toEqual(['space.pdf']);
    expect(spaceStore.get(roomIdToReplyDraftAtomFamily(ROOM))).toBeUndefined();
    act(() => kept?.dismissLostFiles());
    expect(kept?.lostFileNames).toEqual([]);
    openPage(createStore());
    expect(kept?.lostFileNames).toEqual(['room.png']);
  });
});
