import React from 'react';
import { EventEmitter } from 'events';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelationType, RoomEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { matchesEnum } from '../../lib/matchesEnum';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import {
  type ActivityTrackedSection,
  getRoomActivityTimestamp,
  getSubRoomTreeActivityTs,
  sortRoomIdsByActivity,
  useRoomActivityListener,
} from './roomActivity';

type FakeRoom = { roomId: string; ts: number; getLastActiveTimestamp: () => number };

const makeRoom = (roomId: string, ts: number): FakeRoom => {
  const room: FakeRoom = { roomId, ts, getLastActiveTimestamp: () => room.ts };
  return room;
};

describe('roomActivity helpers', () => {
  it('guards missing, zero, negative, and non-finite activity timestamps', () => {
    expect(getRoomActivityTimestamp(undefined)).toBe(0);
    expect(getRoomActivityTimestamp({ getLastActiveTimestamp: () => 0 } as unknown as Room)).toBe(
      0
    );
    expect(getRoomActivityTimestamp({ getLastActiveTimestamp: () => -5 } as unknown as Room)).toBe(
      0
    );
    expect(
      getRoomActivityTimestamp({ getLastActiveTimestamp: () => Number.NaN } as unknown as Room)
    ).toBe(0);
    expect(
      getRoomActivityTimestamp({ getLastActiveTimestamp: () => 1234 } as unknown as Room)
    ).toBe(1234);
  });

  it('lifts parent rooms by descendant sub-room activity and breaks ties by input order', () => {
    const rooms = new Map(
      [
        makeRoom('!alpha', 100),
        makeRoom('!alpha-sub', 500),
        makeRoom('!alpha-grand', 900),
        makeRoom('!beta', 700),
        makeRoom('!gamma', 700),
      ].map((room) => [room.roomId, room])
    );
    const client = { getRoom: (id: string) => rooms.get(id) ?? null } as unknown as MatrixClient;
    const tree = {
      children: new Map([
        ['!alpha', ['!alpha-sub']],
        ['!alpha-sub', ['!alpha-grand']],
      ]),
    };

    expect(getSubRoomTreeActivityTs(client, '!alpha', tree)).toBe(900);
    expect(sortRoomIdsByActivity(client, ['!alpha', '!beta', '!gamma'], tree)).toEqual([
      '!alpha',
      '!beta',
      '!gamma',
    ]);
  });
});

describe('useRoomActivityListener', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const makeTimelineEvent = (replace = false) => ({
    isRelation: (rel?: string) =>
      rel ? replace && matchesEnum(rel, RelationType.Replace) : replace,
  });

  it('subscribes only when enabled and ignores edits, backfill, unrelated rooms, and no-op order updates', () => {
    const rooms = new Map(
      [makeRoom('!a', 3000), makeRoom('!b', 2000), makeRoom('!b-sub', 1000)].map((room) => [
        room.roomId,
        room,
      ])
    );
    const emitter = new EventEmitter();
    const onSpy = vi.spyOn(emitter, 'on');
    const offSpy = vi.spyOn(emitter, 'off');
    const client = Object.assign(emitter, {
      getRoom: (id: string) => rooms.get(id) ?? null,
    }) as unknown as MatrixClient;
    const onChange = vi.fn();

    const tree = { children: new Map([['!b', ['!b-sub']]]) };
    const section = (opts: Partial<ActivityTrackedSection>): ActivityTrackedSection => ({
      recent: false,
      showTimes: false,
      baseTop: ['!a', '!b'],
      orderedTop: ['!a', '!b'],
      tree,
      trackedRoomIds: new Set(['!a', '!b', '!b-sub']),
      ...opts,
    });

    function Harness({ sections }: { sections: ActivityTrackedSection[] }) {
      useRoomActivityListener(sections, onChange);
      return null;
    }

    // Disabled -> no Timeline listener at all.
    act(() => {
      renderer = create(
        React.createElement(
          MatrixClientProvider,
          { value: client },
          React.createElement(Harness, { sections: [section({})] })
        )
      );
    });
    expect(onSpy).not.toHaveBeenCalled();

    // Enabled for Recent mode only.
    act(() => {
      renderer!.update(
        React.createElement(
          MatrixClientProvider,
          { value: client },
          React.createElement(Harness, { sections: [section({ recent: true })] })
        )
      );
    });
    expect(onSpy).toHaveBeenCalledTimes(1);

    // Ignore history backfill, non-live events, m.replace edits, and untracked rooms.
    rooms.get('!b')!.ts = 9000;
    emitter.emit(RoomEvent.Timeline, makeTimelineEvent(false), rooms.get('!b'), true, false, {
      liveEvent: true,
    });
    emitter.emit(RoomEvent.Timeline, makeTimelineEvent(false), rooms.get('!b'), false, false, {
      liveEvent: false,
    });
    emitter.emit(RoomEvent.Timeline, makeTimelineEvent(true), rooms.get('!b'), false, false, {
      liveEvent: true,
    });
    emitter.emit(
      RoomEvent.Timeline,
      makeTimelineEvent(false),
      makeRoom('!other', 9999),
      false,
      false,
      {
        liveEvent: true,
      }
    );
    expect(onChange).not.toHaveBeenCalled();

    // Message in top room that preserves order does not bump when showTimes is off.
    rooms.get('!b')!.ts = 2000;
    rooms.get('!a')!.ts = 4000;
    emitter.emit(RoomEvent.Timeline, makeTimelineEvent(false), rooms.get('!a'), false, false, {
      liveEvent: true,
    });
    expect(onChange).not.toHaveBeenCalled();

    // Live message in nested sub-room lifts !b above !a -> bumps!
    rooms.get('!b-sub')!.ts = 5000;
    emitter.emit(RoomEvent.Timeline, makeTimelineEvent(false), rooms.get('!b-sub'), false, false, {
      liveEvent: true,
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    // With showTimes on (even in A to Z mode), a live message in a tracked room bumps to refresh "now".
    onChange.mockClear();
    act(() => {
      renderer!.update(
        React.createElement(
          MatrixClientProvider,
          { value: client },
          React.createElement(Harness, { sections: [section({ recent: false, showTimes: true })] })
        )
      );
    });
    rooms.get('!a')!.ts = 6000;
    emitter.emit(RoomEvent.Timeline, makeTimelineEvent(false), rooms.get('!a'), false, false, {
      liveEvent: true,
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    // Disabling unsubscribes cleanly.
    act(() => {
      renderer!.update(
        React.createElement(
          MatrixClientProvider,
          { value: client },
          React.createElement(Harness, { sections: [section({})] })
        )
      );
    });
    expect(offSpy).toHaveBeenCalledTimes(1);
  });
});
