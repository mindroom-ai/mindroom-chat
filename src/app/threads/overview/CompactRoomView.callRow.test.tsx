// @vitest-environment jsdom
import { MatrixEvent, type IContent, type IEvent, type Room } from 'matrix-js-sdk';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import type { CallRowContent } from '../../matrix/protocol/callRow';
import {
  installEventContentGuard,
  trustAgentsOfViewer,
} from '../../matrix/protocol/untrustedContent';
import { CompactRoomView } from './CompactRoomView';
import { putSession } from '../../matrix/session/sessions';

const ROOM_ID = '!room:example.org';
const ROUTER = '@mindroom_router:example.org';
const PERSON = '@person:example.org';

const state = vi.hoisted(() => ({ models: [] as CompactThreadCardViewModel[] }));

// The call's row as a stub, with a control of its own like Join.
vi.mock('../../calls/transcription/CallRow', () => ({
  CallRow: ({ mEvent, row }: { mEvent: MatrixEvent; row: CallRowContent }) => (
    <div data-call-row-stub={mEvent.getId()}>
      {row.ended ? `ended ${row.ended.durationSeconds ?? ''}` : 'live'}
      <button type="button">Join</button>
    </div>
  ),
}));
vi.mock('./compactThreadCardViewModel', () => ({
  useCompactThreadCardViewModels: () => state.models,
}));
vi.mock('../tags/useRoomThreadTags', () => ({
  useToggleThreadResolution: () => ({
    canToggle: false,
    setResolved: vi.fn(),
    updatingThreadRootIds: new Set(),
    error: undefined,
  }),
}));
vi.mock('../../event-store/threads/useThreadPinning', () => ({
  useThreadPinning: () => ({
    canPin: false,
    pinnedEventIds: [],
    setPinned: vi.fn(),
    updating: false,
    error: undefined,
  }),
}));
vi.mock('../useInitializeShownThread', () => ({ useInitializeShownThread: () => undefined }));
vi.mock('../../ui/InsetScrollbar', () => ({ InsetScrollbar: () => null }));
vi.mock('../ThreadActionsMenu', () => ({ ThreadActionsMenu: () => null }));
vi.mock('../../i18n/useRelativeTime', () => ({ useRelativeTime: () => '' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

const message = (eventId: string, sender: string, content: IContent) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: ROOM_ID,
    event_id: eventId,
    sender,
    origin_server_ts: 1,
    content,
  } as Partial<IEvent>);

const LIVE: IContent = {
  msgtype: 'm.notice',
  body: 'Call started',
  'io.mindroom.call': { call_id: 'call-1' },
};
const ENDED: IContent = {
  msgtype: 'm.notice',
  body: 'Call ended · 12 min',
  'io.mindroom.call': {
    call_id: 'call-1',
    ended_at: '2026-11-07T10:00:00Z',
    duration_seconds: 720,
  },
};

const viewModel = (threadRootId: string, titleText: string): CompactThreadCardViewModel => ({
  id: { roomId: ROOM_ID, threadRootId },
  titleText,
  displayTitleText: titleText,
  previewText: 'No replies yet',
  messageCount: 0,
  messageCountLabel: '0 replies',
  messageCountText: '0',
  attentionState: 'idle',
  attentionStatusText: 'Idle',
  participants: [],
  tags: [],
  isResolved: false,
  isUnread: false,
  isStreaming: false,
});

let renderer: ReactTestRenderer | undefined;

/** The compact list of a room whose thread roots are `events`. */
const renderList = async (events: MatrixEvent[]) => {
  const byId = new Map(events.map((event) => [event.getId(), event]));
  const room = {
    roomId: ROOM_ID,
    getUnfilteredTimelineSet: () => ({ findEventById: (id: string) => byId.get(id) }),
    getThread: () => null,
  } as unknown as Room;
  state.models = events.map((event) =>
    viewModel(event.getId() ?? '', String(event.getContent().body))
  );
  await act(async () => {
    renderer = create(
      <CompactRoomView
        room={room}
        threadRootIds={state.models.map((model) => model.id.threadRootId)}
        threadRecordMap={new Map()}
        onThreadClick={vi.fn()}
        compactRoomScrollStateRef={{ current: new Map() }}
      />
    );
  });
  // The row loads on first use.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return defined(renderer);
};

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('nothing rendered');
  return value;
}

const rowsOf = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) => typeof node.type === 'string' && node.props['data-call-row-stub'] !== undefined
  );

/** The rows shown, by their event, so a failure prints them rather than the whole tree. */
const rowIdsOf = (tree: ReactTestRenderer) =>
  rowsOf(tree).map((node) => node.props['data-call-row-stub'] as string);

const insideButton = (node: ReactTestInstance) => {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'button') return true;
  }
  return false;
};

beforeAll(() => {
  installEventContentGuard();
  trustAgentsOfViewer('@reader:example.org');
  // Rows count from the active account's agents.
  putSession(
    {
      baseUrl: 'https://matrix.example',
      userId: '@reader:example.org',
      deviceId: 'DEVICE',
      accessToken: 'token',
    },
    { setActive: true }
  );
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('a call row in the compact thread list', () => {
  it("shows a live call's row in its card, beside the button that opens the row's thread, and drops it when the call ends", async () => {
    const row = message('$row', ROUTER, LIVE);
    const tree = await renderList([row]);

    const [shown, ...others] = rowsOf(tree);
    expect(others).toEqual([]);
    expect(shown?.props['data-call-row-stub']).toBe('$row');
    expect(shown?.children.join('')).toContain('live');
    expect(insideButton(defined(shown))).toBe(false);
    expect(
      tree.root.findAll((node) => node.type === 'button' && node.props['data-thread-root-id'])
    ).toHaveLength(1);

    const edit = message('$edit', ROUTER, {
      ...ENDED,
      body: `* ${String(ENDED.body)}`,
      'm.new_content': ENDED,
      'm.relates_to': { rel_type: 'm.replace', event_id: '$row' },
    });
    await act(async () => row.makeReplaced(edit));
    // The ended call's card is a thread like any other: its title, its notes and its replies.
    expect(rowIdsOf(tree)).toEqual([]);
  });

  it('shows no row for a call that had ended before the list opened', async () => {
    const tree = await renderList([message('$row', ROUTER, ENDED)]);
    expect(rowIdsOf(tree)).toEqual([]);
  });

  it("shows no row for a person's message that carries the key", async () => {
    const tree = await renderList([message('$person', PERSON, LIVE)]);
    expect(rowIdsOf(tree)).toEqual([]);
  });
});
