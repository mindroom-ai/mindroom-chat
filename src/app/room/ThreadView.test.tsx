// @vitest-environment jsdom
import { useEffect, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createClient, Room, type RoomMember } from 'matrix-js-sdk';
import type { Editor } from 'slate';
import { Editable, Slate } from 'slate-react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePowerLevelsContext } from '../matrix/hooks/usePowerLevels';
import type { RoomTimelineProps } from '../timeline/RoomTimeline';
import { ThreadView } from './ThreadView';

const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');
const THREAD = '$root';

const LEVELS = vi.hoisted(() => ({ users_default: 0 }));
const state = vi.hoisted(() => ({
  mayPost: true,
  tombstone: false,
  members: [] as RoomMember[],
  timeline: undefined as RoomTimelineProps | undefined,
  timelineLevels: undefined as unknown,
  dropTarget: undefined as HTMLElement | null | undefined,
  approvals: undefined as
    | { room: Room; threadId?: string; focusConversation?: () => void }
    | undefined,
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => state.members }));
vi.mock('../matrix/hooks/usePowerLevels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/hooks/usePowerLevels')>()),
  usePowerLevels: () => LEVELS,
}));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    event: (type: string, userId: string) =>
      state.mayPost && type === 'm.room.message' && userId === '@alice:example.org',
  }),
}));
vi.mock('../matrix/hooks/useStateEvent', () => ({
  useStateEvent: () => (state.tombstone ? {} : undefined),
}));
vi.mock('../timeline/RoomTimeline', () => ({
  RoomTimeline: (props: RoomTimelineProps) => {
    state.timeline = props;
    state.timelineLevels = usePowerLevelsContext();
    return <div data-testid="timeline" />;
  },
}));
vi.mock('../approvals/ThreadApprovalProvider', () => ({
  ThreadApprovalProvider: ({
    children,
    ...props
  }: {
    children: ReactNode;
    room: Room;
    threadId?: string;
    focusConversation?: () => void;
  }) => {
    state.approvals = props;
    return children;
  },
}));
vi.mock('../approvals/ThreadApprovalControls', () => ({
  ThreadApprovalQueue: () => <div data-testid="approvals" />,
}));
// The composer is its Slate text box.
vi.mock('../composer/RoomInput', () => ({
  RoomInput: ({
    editor,
    threadId,
    fileDropContainerRef,
  }: {
    editor: Editor;
    threadId?: string;
    fileDropContainerRef: RefObject<HTMLElement>;
  }) => {
    useEffect(() => {
      state.dropTarget = fileDropContainerRef.current;
    });
    return (
      <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '' }] }]}>
        <Editable aria-label={`Reply in ${threadId ?? 'the room'}`} />
      </Slate>
    );
  },
}));

beforeEach(() => {
  state.mayPost = true;
  state.tombstone = false;
  state.members = [];
  state.timeline = undefined;
  state.timelineLevels = undefined;
  state.dropTarget = undefined;
  state.approvals = undefined;
});
afterEach(cleanup);

const composer = () => screen.queryByRole('textbox', { name: `Reply in ${THREAD}` });

it("shows the thread's root and replies, its approvals under them and the reply box under those", () => {
  render(<ThreadView room={room} threadId={THREAD} />);
  expect(state.timeline).toMatchObject({
    room,
    threadId: THREAD,
    viewMode: 'threaded',
    hasMindroomAgents: false,
  });
  expect(state.timeline?.summaryMap.size).toBe(0);
  expect(state.approvals).toMatchObject({ room, threadId: THREAD });
  const [timeline, approvals, reply] = [
    screen.getByTestId('timeline'),
    screen.getByTestId('approvals'),
    composer(),
  ];
  expect(
    timeline.compareDocumentPosition(approvals) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  expect(
    reply && approvals.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
});

it('shares one editor between the timeline and the reply box, which an approval focuses', () => {
  render(<ThreadView room={room} threadId={THREAD} />);
  state.approvals?.focusConversation?.();
  expect(document.activeElement).toBe(composer());
  expect(state.timeline?.editor).toBeDefined();
});

it('tells the timeline whether a MindRoom agent is in the room', () => {
  state.members = [{ userId: '@mindroom_helper:example.org', membership: 'join' } as RoomMember];
  render(<ThreadView room={room} threadId={THREAD} />);
  expect(state.timeline?.hasMindroomAgents).toBe(true);
});

it('shows no reply box where the account may not post, nor in an upgraded room', () => {
  state.mayPost = false;
  const { rerender } = render(<ThreadView room={room} threadId={THREAD} />);
  expect(screen.getByTestId('timeline')).toBeDefined();
  expect(composer()).toBeNull();
  state.mayPost = true;
  state.tombstone = true;
  rerender(<ThreadView room={room} threadId={THREAD} />);
  expect(composer()).toBeNull();
});

it('lets an Escape the reply box leaves bubble out of it', () => {
  const heard = vi.fn((event: KeyboardEvent) => event.defaultPrevented);
  render(
    <div onKeyDown={heard}>
      <ThreadView room={room} threadId={THREAD} />
    </div>
  );
  fireEvent.keyDown(composer() as HTMLElement, { key: 'Escape' });
  expect(heard).toHaveReturnedWith(false);
});

it("gives the timeline its room's power levels, also outside that room's page, and takes files dropped anywhere on it", () => {
  const { container } = render(<ThreadView room={room} threadId={THREAD} />);
  expect(state.timelineLevels).toBe(LEVELS);
  expect(state.dropTarget).toBe(container.firstElementChild);
});

it("sets the room view's insets to none, as no floating header or composer covers its rows", () => {
  const { container } = render(<ThreadView room={room} threadId={THREAD} />);
  const view = container.firstElementChild as HTMLElement;
  ['--room-header-height', '--room-footer-height', '--room-composer-height'].forEach((name) =>
    expect(view.style.getPropertyValue(name)).toBe('0px')
  );
});
