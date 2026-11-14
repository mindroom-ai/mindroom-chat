import { createRef } from 'react';
import type { EventTimelineSet, MatrixEvent, Room } from 'matrix-js-sdk';
import { createEditor } from 'slate';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create, makeEvent, makeRoom } from '../test-utils/RoomTimeline.test.shared';
import { MessageLayout, type MessageSpacing } from '../../preferences/settings';
import type { IPowerLevels } from '../../matrix/hooks/usePowerLevels';
import type { TimelineMessageRow } from './types';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const ME = '@alice:example.org';
const OTHER = '@bob:example.org';

const permissionState = vi.hoisted(() => ({
  powerLevels: {} as IPowerLevels,
  creators: new Set<string>(),
}));

// The shared timeline fixtures grant every permission. This suite checks the real rules.
vi.doUnmock('../../matrix/hooks/useRoomPermissions');
vi.doMock('../../matrix/hooks/usePowerLevels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/hooks/usePowerLevels')>()),
  usePowerLevelsContext: () => permissionState.powerLevels,
}));
vi.doMock('../../matrix/hooks/useRoomCreators', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/hooks/useRoomCreators')>()),
  useRoomCreators: () => permissionState.creators,
}));

const rowFor = (event: MatrixEvent, index: number): TimelineMessageRow => ({
  eventId: event.getId()!,
  event,
  index,
  timelineSet: {} as EventTimelineSet,
  collapse: false,
  highlighted: false,
});

const emptyData = () => ({
  threadRecordMap: new Map(),
  threadEventMap: new Map(),
  handleOpenReply: vi.fn(),
  approvalTimeline: {
    hiddenEventIds: new Set<string>(),
    historyByResponseId: new Map(),
    fallbackGroupsByEventId: new Map(),
  },
  threadSummaryTimeline: {
    hiddenEventIds: new Set<string>(),
    markersByEventId: new Map(),
  },
});

/** Renders the rows and returns the `canDelete` and `canPinEvent` props each message received. */
const renderPermissions = async (events: MatrixEvent[]) => {
  const { useTimelineMessageFeature } = await import('./useTimelineMessageFeature');
  const room = makeRoom({ liveEvents: [] }) as unknown as Room;
  const editor = createEditor();
  const scrollRef = createRef<HTMLDivElement>();
  const data = emptyData() as never;
  const rows = events.map(rowFor);
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
    return feature.wrapExpansion(<>{rows.map((row) => feature.renderEvent(row, data))}</>);
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Harness />);
  });
  return Object.fromEntries(
    events.map((event) => {
      const { props } = renderer.root.findByProps({ 'data-message-id': event.getId() });
      return [event.getId(), { canDelete: props.canDelete, canPinEvent: props.canPinEvent }];
    })
  );
};

const message = (id: string, opts: { sender?: string; isRedacted?: boolean } = {}) =>
  makeEvent(id, {
    sender: opts.sender ?? ME,
    isRedacted: opts.isRedacted,
  }) as unknown as MatrixEvent;

importBeforeTests(() => import('./useTimelineMessageFeature'));

describe('timeline message permissions', () => {
  beforeEach(() => {
    permissionState.powerLevels = {};
    permissionState.creators = new Set();
  });

  it('lets a regular member delete only their own messages and pin nothing', async () => {
    const result = await renderPermissions([
      message('$mine'),
      message('$theirs', { sender: OTHER }),
    ]);
    expect(result).toEqual({
      $mine: { canDelete: true, canPinEvent: false },
      $theirs: { canDelete: false, canPinEvent: false },
    });
  });

  it("lets a user at the redact level delete other people's messages", async () => {
    permissionState.powerLevels = { redact: 50, users: { [ME]: 50 }, state_default: 100 };
    const result = await renderPermissions([message('$theirs', { sender: OTHER })]);
    expect(result.$theirs).toEqual({ canDelete: true, canPinEvent: false });
  });

  it('lets a moderator pin when the room leaves pins at the state default', async () => {
    permissionState.powerLevels = { users: { [ME]: 50 }, state_default: 50 };
    const result = await renderPermissions([message('$theirs', { sender: OTHER })]);
    expect(result.$theirs.canPinEvent).toBe(true);
  });

  it('lets a user at a custom pin level below the moderators pin', async () => {
    permissionState.powerLevels = {
      users: { [ME]: 40 },
      events: { 'm.room.pinned_events': 40 },
    };
    const result = await renderPermissions([message('$mine')]);
    expect(result.$mine.canPinEvent).toBe(true);
  });

  it('keeps delete off when sending m.room.redaction is above the user', async () => {
    permissionState.powerLevels = { events: { 'm.room.redaction': 50 }, users: { [ME]: 0 } };
    const result = await renderPermissions([message('$mine')]);
    expect(result.$mine.canDelete).toBe(false);
  });

  it('keeps delete off for an already redacted message', async () => {
    const result = await renderPermissions([message('$gone', { isRedacted: true })]);
    expect(result.$gone.canDelete).toBe(false);
  });

  it('enables pinning for an admin allowed to change the pinned events', async () => {
    permissionState.powerLevels = {
      users: { [ME]: 100 },
      events: { 'm.room.pinned_events': 50 },
    };
    const result = await renderPermissions([
      message('$mine'),
      message('$theirs', { sender: OTHER }),
    ]);
    expect(result).toEqual({
      $mine: { canDelete: true, canPinEvent: true },
      $theirs: { canDelete: true, canPinEvent: true },
    });
  });

  it('keeps pinning off for an admin below the pinned events level', async () => {
    permissionState.powerLevels = {
      users: { [ME]: 100 },
      events: { 'm.room.pinned_events': 150 },
    };
    const result = await renderPermissions([message('$mine')]);
    expect(result.$mine.canPinEvent).toBe(false);
  });

  it('gives a privileged room creator every action', async () => {
    permissionState.creators = new Set([ME]);
    permissionState.powerLevels = { users: {}, redact: 100, events: { 'm.room.redaction': 100 } };
    const result = await renderPermissions([message('$theirs', { sender: OTHER })]);
    expect(result.$theirs).toEqual({ canDelete: true, canPinEvent: true });
  });
});
