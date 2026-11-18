import { createRef } from 'react';
import { MatrixEvent, MatrixEventEvent, type EventTimelineSet, type Room } from 'matrix-js-sdk';
import { createEditor } from 'slate';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { create, makeRoom } from '../test-utils/RoomTimeline.test.shared';
import { MessageLayout, type MessageSpacing } from '../../preferences/settings';
import { MessageEvent } from '../../matrix/types/room';
import type { TimelineMessageData, TimelineMessageRow } from './types';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

// The shared timeline fixtures know no pending edits. Here each event has those the test gives it.
const pendingEdits = vi.hoisted(() => new Map<string, unknown[]>());
vi.doMock('../../matrix/room', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/room')>()),
  getPendingEdits: (eventId: string) => pendingEdits.get(eventId) ?? [],
}));

importBeforeTests(() => import('./useTimelineMessageFeature'));

const encrypted = (id: string) =>
  new MatrixEvent({
    event_id: id,
    type: MessageEvent.RoomMessageEncrypted,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    content: {},
  });

const rowFor = (event: MatrixEvent, index = 0): TimelineMessageRow => ({
  eventId: event.getId()!,
  event,
  index,
  timelineSet: {} as EventTimelineSet,
  collapse: false,
  highlighted: false,
});

describe('the events a watched row repaints the list for', () => {
  it('are its own, its edits still to decrypt, and those of the quiet markers beside it', async () => {
    const { useTimelineMessageFeature } = await import('./useTimelineMessageFeature');
    const room = makeRoom({ liveEvents: [] }) as unknown as Room;
    const editor = createEditor();
    const scrollRef = createRef<HTMLDivElement>();
    const [message, edit, marker, markerEdit] = [
      '$message',
      '$edit',
      '$marker',
      '$marker-edit',
    ].map(encrypted) as [MatrixEvent, MatrixEvent, MatrixEvent, MatrixEvent];
    pendingEdits.set('$message', [edit]);
    pendingEdits.set('$marker', [markerEdit]);
    const row = { ...rowFor(message), quietRun: [rowFor(marker, 1)] };
    function Harness() {
      const feature = useTimelineMessageFeature({
        room,
        editor,
        scrollRef,
        showThreadRepliesInRoom: false,
        messageLayout: MessageLayout.Compact,
        messageSpacing: '400' as MessageSpacing,
        hideActivity: false,
      });
      // The list watches each row it mounts; it need not render the row for that.
      feature.watchRowEvents(row, {} as TimelineMessageData);
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Harness />);
    });
    const watched = () =>
      [message, edit, marker, markerEdit].map((event) =>
        event.listenerCount(MatrixEventEvent.Decrypted)
      );
    expect(watched()).toEqual([1, 1, 1, 1]);
    act(() => renderer.unmount());
    expect(watched()).toEqual([0, 0, 0, 0]);
  });
});
