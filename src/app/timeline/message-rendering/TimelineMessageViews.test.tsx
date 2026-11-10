import { createRef, type ReactNode } from 'react';
import { getDefaultStore } from 'jotai';
import { EventTimelineSet, MatrixEvent, type Room } from 'matrix-js-sdk';
import { createEditor, type Editor } from 'slate';
import { ReactEditor } from 'slate-react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { create, makeRoom } from '../test-utils/RoomTimeline.test.shared';
import { useKeyDown } from '../../lib/hooks/useKeyDown';
import { MessageLayout, type MessageSpacing } from '../../preferences/settings';
import { BlockType } from '../../editor/types';
import { ConversationViewContext, composerStateKey } from '../../navigation/conversationView';
import type { TimelineMessageRow } from './types';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

// Two views of one room: the room's page and another conversation view (a plugin's thread view),
// each with its timeline and the composer that shares its editor. The reply target is real jotai
// state here, and message selection and the editor guards are the real ones.
vi.doUnmock('../../matrix/room');
vi.doUnmock('../../lib/dom');
vi.doMock('../../editor/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../editor/utils')>()),
}));
vi.doUnmock('../../composer/roomInputDrafts');
vi.doMock('jotai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('jotai')>()),
  useAtomValue: () => [],
}));

const ROOM = '!room:example.org';
const VIEW = 'thread-view';
const ME = '@alice:example.org';

const message = (id: string, content = {}) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM,
    sender: ME,
    type: 'm.room.message',
    content: { msgtype: 'm.text', body: id, ...content },
  });

const rowFor = (event: MatrixEvent): TimelineMessageRow => ({
  eventId: event.getId()!,
  event,
  index: 0,
  timelineSet: {} as EventTimelineSet,
  collapse: false,
  highlighted: false,
});

const emptyData = {
  threadRecordMap: new Map(),
  threadEventMap: new Map(),
  handleOpenReply: vi.fn(),
  approvalTimeline: {
    hiddenEventIds: new Set<string>(),
    historyByResponseId: new Map(),
    fallbackGroupsByEventId: new Map(),
  },
  threadSummaryTimeline: { hiddenEventIds: new Set<string>(), markersByEventId: new Map() },
} as never;

const emptyEditor = () => {
  const editor = createEditor();
  editor.children = [{ type: BlockType.Paragraph, children: [{ text: '' }] }];
  return editor;
};

/** Mounts the room page's timeline of the room and a thread view's timeline of its thread. */
const drafts = () => import('../../composer/roomInputDrafts');

const mountTwoViews = async () => {
  const { useTimelineMessageFeature } = await import('./useTimelineMessageFeature');
  const root = message('$root');
  const pageMessage = message('$page-message');
  const threadReply = message('$thread-reply', {
    'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
  });
  const room = makeRoom({ liveEvents: [] }) as unknown as Room;
  const live = new EventTimelineSet(undefined).getLiveTimeline();
  live.getEvents().push(root, pageMessage);
  const threadLive = new EventTimelineSet(undefined).getLiveTimeline();
  threadLive.getEvents().push(threadReply);
  room.getLiveTimeline = () => live;
  room.getUnfilteredTimelineSet = () => new EventTimelineSet(undefined);
  room.findEventById = (id: string) =>
    [root, pageMessage, threadReply].find((event) => event.getId() === id);
  room.getThread = vi.fn(() => ({
    liveTimeline: threadLive,
    rootEvent: root,
  })) as unknown as Room['getThread'];
  const editors = { page: emptyEditor(), view: emptyEditor() };
  const features: Record<string, ReturnType<typeof useTimelineMessageFeature>> = {};
  const Timeline = ({
    name,
    editor,
    threadId,
  }: {
    name: string;
    editor: Editor;
    threadId?: string;
  }) => {
    const feature = useTimelineMessageFeature({
      room,
      editor,
      threadId,
      scrollRef: createRef<HTMLDivElement>(),
      showThreadRepliesInRoom: false,
      messageLayout: MessageLayout.Compact,
      messageSpacing: '400' as MessageSpacing,
      hideActivity: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
      showHiddenEvents: false,
    });
    features[name] = feature;
    return (
      <div data-timeline={name}>{feature.renderEvent(rowFor(root), emptyData) as ReactNode}</div>
    );
  };
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <>
        <Timeline name="page" editor={editors.page} />
        <ConversationViewContext.Provider value={VIEW}>
          <Timeline name="view" editor={editors.view} threadId="$root" />
        </ConversationViewContext.Provider>
      </>
    );
  });
  const rootRowOf = (name: string) =>
    renderer.root
      .findByProps({ 'data-timeline': name })
      .findByProps({ 'data-message-id': '$root' });
  return { editors, features, rootRowOf };
};

importBeforeTests(() => import('./useTimelineMessageFeature'));

afterEach(async () => {
  vi.restoreAllMocks();
  const { roomIdToReplyDraftAtomFamily } = await drafts();
  const store = getDefaultStore();
  store.set(roomIdToReplyDraftAtomFamily(ROOM), undefined);
  store.set(roomIdToReplyDraftAtomFamily(composerStateKey(ROOM, VIEW)), undefined);
});

describe('two conversation views of one room', () => {
  it("replies in the view whose timeline the Reply was on, and focuses that view's composer", async () => {
    const focus = vi.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined);
    const { editors, rootRowOf } = await mountTwoViews();

    act(() => (rootRowOf('view').props.onReplyClick as (id: string) => void)('$root'));

    const { roomIdToReplyDraftAtomFamily } = await drafts();
    const store = getDefaultStore();
    expect(store.get(roomIdToReplyDraftAtomFamily(composerStateKey(ROOM, VIEW)))).toMatchObject({
      eventId: '$root',
    });
    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM))).toBeUndefined();
    expect(focus).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith(editors.view);
  });

  it("keeps the room page's reply under the room's own key", async () => {
    vi.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined);
    const { rootRowOf } = await mountTwoViews();

    act(() => (rootRowOf('page').props.onReplyClick as (id: string) => void)('$root'));

    const { roomIdToReplyDraftAtomFamily } = await drafts();
    const store = getDefaultStore();
    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM))).toMatchObject({ eventId: '$root' });
    expect(store.get(roomIdToReplyDraftAtomFamily(composerStateKey(ROOM, VIEW)))).toBeUndefined();
  });

  it.each(['page', 'view'] as const)(
    'edits on Up only in the timeline of the focused composer (%s)',
    async (focused) => {
      const { editors, features } = await mountTwoViews();
      vi.spyOn(ReactEditor, 'isFocused').mockImplementation(
        (editor) => editor === editors[focused]
      );

      const event = { key: 'ArrowUp', preventDefault: vi.fn() } as unknown as KeyboardEvent;
      act(() => vi.mocked(useKeyDown).mock.calls.forEach(([, handler]) => handler(event)));

      expect(features.page.editingEventId).toBe(focused === 'page' ? '$page-message' : undefined);
      expect(features.view.editingEventId).toBe(focused === 'view' ? '$thread-reply' : undefined);
    }
  );
});
