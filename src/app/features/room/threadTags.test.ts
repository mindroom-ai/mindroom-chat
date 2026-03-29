import React from 'react';
import { EventTimeline } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateEvent } from '../../../types/matrix/room';
import {
  getTagNames,
  isThreadTagsTombstone,
  isThreadResolvedFromContent,
  parseThreadTagsContent,
  buildResolvedTagsContent,
  buildUnresolvedTagsContent,
} from './threadTags';
import { parseLegacyResolutionContent, useToggleThreadResolution } from './useRoomThreadTags';

const { getSafeUserIdMock, sendStateEventMock, stateEventPermissionMock } = vi.hoisted(() => ({
  getSafeUserIdMock: vi.fn(() => '@alice:example.org'),
  sendStateEventMock: vi.fn(() => Promise.resolve()),
  stateEventPermissionMock: vi.fn(() => true),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: getSafeUserIdMock,
    sendStateEvent: sendStateEventMock,
  }),
}));

vi.mock('../../hooks/usePowerLevels', () => ({
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../hooks/useRoomCreators', () => ({
  useRoomCreators: () => [],
}));

vi.mock('../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    stateEvent: stateEventPermissionMock,
  }),
}));

type ToggleHookValue = ReturnType<typeof useToggleThreadResolution>;

type ToggleHarnessProps = {
  room: Room;
  onRender: (value: ToggleHookValue) => void;
};

type MockRoom = Room & {
  getLiveTimeline: () => {
    getState: ReturnType<typeof vi.fn>;
  };
  getThread: ReturnType<typeof vi.fn>;
  findEventById: ReturnType<typeof vi.fn>;
  roomId: string;
  __mocks: {
    getState: ReturnType<typeof vi.fn>;
    getStateEvents: ReturnType<typeof vi.fn>;
  };
};

function ToggleHarness({ room, onRender }: ToggleHarnessProps) {
  const value = useToggleThreadResolution(room);
  onRender(value);
  return null;
}

const renderToggleHook = (
  room: Room
): { getSnapshot: () => ToggleHookValue; renderer: ReactTestRenderer } => {
  let latestValue: ToggleHookValue | undefined;
  let renderer: ReactTestRenderer | undefined;

  act(() => {
    renderer = create(
      React.createElement(ToggleHarness, {
        room,
        onRender: (value) => {
          latestValue = value;
        },
      })
    );
  });

  return {
    getSnapshot: () => latestValue as ToggleHookValue,
    renderer: renderer as ReactTestRenderer,
  };
};

const makeToggleRoom = (currentContent: unknown = null): MockRoom => {
  const currentEvent =
    currentContent === undefined
      ? undefined
      : {
          getContent: () => currentContent,
        };
  const getStateEvents = vi.fn(() => currentEvent);
  const getState = vi.fn(() => ({
    getStateEvents,
  }));
  const rootEvent = {
    getId: () => '$thread-1',
    isThreadRoot: true,
  };

  return {
    roomId: '!room:example.org',
    getLiveTimeline: () => ({
      getState,
    }),
    getThread: vi.fn((threadRootId: string) =>
      threadRootId === '$thread-1' ? { rootEvent } : undefined
    ),
    findEventById: vi.fn((eventId: string) => (eventId === '$thread-1' ? rootEvent : undefined)),
    __mocks: {
      getState,
      getStateEvents,
    },
  } as MockRoom;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('parseThreadTagsContent', () => {
  it('parses valid tags payload with TagMetadata', () => {
    const content = {
      tags: {
        resolved: { set_by: '@user:x', set_at: '2024-01-01T00:00:00Z' },
        blocked: { set_by: '@admin:x', set_at: '2024-01-02T00:00:00Z' },
      },
    };
    const result = parseThreadTagsContent(content);
    expect(result).not.toBeNull();
    expect(Object.keys(result!)).toEqual(['resolved', 'blocked']);
    expect(result!.resolved.set_by).toBe('@user:x');
  });

  it('returns null for tombstone (empty object)', () => {
    expect(parseThreadTagsContent({})).toBeNull();
    expect(isThreadTagsTombstone({})).toBe(true);
  });

  it('returns null for non-object values', () => {
    expect(parseThreadTagsContent(null)).toBeNull();
    expect(parseThreadTagsContent(undefined)).toBeNull();
    expect(parseThreadTagsContent('string')).toBeNull();
    expect(parseThreadTagsContent(42)).toBeNull();
  });

  it('returns null when tags is not an object', () => {
    expect(parseThreadTagsContent({ tags: 'resolved' })).toBeNull();
    expect(parseThreadTagsContent({ tags: ['resolved'] })).toBeNull();
  });

  it('skips entries without required set_by/set_at', () => {
    const content = {
      tags: {
        valid: { set_by: '@user:x', set_at: '2024-01-01T00:00:00Z' },
        invalid: { note: 'missing required fields' },
      },
    };
    const result = parseThreadTagsContent(content);
    expect(result).not.toBeNull();
    expect(Object.keys(result!)).toEqual(['valid']);
  });

  it('returns null when all entries are invalid', () => {
    expect(parseThreadTagsContent({ tags: { bad: 42 } })).toBeNull();
  });
});

describe('getTagNames', () => {
  it('returns tag names from record', () => {
    const tags = {
      resolved: { set_by: '@user:x', set_at: '2024-01-01T00:00:00Z' },
      priority: { set_by: '@user:x', set_at: '2024-01-01T00:00:00Z' },
    };
    expect(getTagNames(tags)).toEqual(['resolved', 'priority']);
  });

  it('returns empty array for null', () => {
    expect(getTagNames(null)).toEqual([]);
  });
});

describe('isThreadResolvedFromContent', () => {
  it('returns true when resolved tag exists', () => {
    expect(
      isThreadResolvedFromContent({
        tags: { resolved: { set_by: '@user:x', set_at: '2024-01-01T00:00:00Z' } },
      })
    ).toBe(true);
  });

  it('returns false when no resolved tag', () => {
    expect(
      isThreadResolvedFromContent({
        tags: { blocked: { set_by: '@user:x', set_at: '2024-01-01T00:00:00Z' } },
      })
    ).toBe(false);
  });

  it('returns false for empty/invalid content', () => {
    expect(isThreadResolvedFromContent({})).toBe(false);
    expect(isThreadResolvedFromContent(null)).toBe(false);
  });
});

describe('buildResolvedTagsContent', () => {
  it('creates content with resolved tag', () => {
    const content = buildResolvedTagsContent('@user:x', null, '2024-01-01T00:00:00Z');
    expect(content.tags.resolved).toEqual({
      set_by: '@user:x',
      set_at: '2024-01-01T00:00:00Z',
    });
  });

  it('preserves existing tags', () => {
    const existing = {
      blocked: { set_by: '@admin:x', set_at: '2024-01-01T00:00:00Z' },
    };
    const content = buildResolvedTagsContent('@user:x', existing, '2024-01-02T00:00:00Z');
    expect(Object.keys(content.tags)).toEqual(['blocked', 'resolved']);
  });
});

describe('buildUnresolvedTagsContent', () => {
  it('removes resolved tag', () => {
    const existing = {
      resolved: { set_by: '@user:x', set_at: '2024-01-01T00:00:00Z' },
      blocked: { set_by: '@admin:x', set_at: '2024-01-01T00:00:00Z' },
    };
    const content = buildUnresolvedTagsContent(existing);
    expect(Object.keys(content.tags)).toEqual(['blocked']);
  });

  it('returns empty tags for null', () => {
    expect(buildUnresolvedTagsContent(null)).toEqual({ tags: {} });
  });
});

describe('useToggleThreadResolution', () => {
  it('reads the live thread-tags state with EventTimeline.FORWARDS', async () => {
    const room = makeToggleRoom();
    const { getSnapshot, renderer } = renderToggleHook(room);

    await act(async () => {
      await getSnapshot().setResolved('$thread-1', true);
    });

    expect(room.__mocks.getState).toHaveBeenCalledWith(EventTimeline.FORWARDS);
    expect(room.__mocks.getStateEvents).toHaveBeenCalledWith(
      StateEvent.ThreadTags,
      '$thread-1'
    );

    renderer.unmount();
  });

  it('sends the thread-tags state event when resolving a thread', async () => {
    const room = makeToggleRoom({
      tags: {
        blocked: { set_by: '@mod:example.org', set_at: '2024-01-01T00:00:00Z' },
      },
    });
    const { getSnapshot, renderer } = renderToggleHook(room);

    await act(async () => {
      await getSnapshot().setResolved('$thread-1', true);
    });

    expect(sendStateEventMock).toHaveBeenCalledWith(
      '!room:example.org',
      StateEvent.ThreadTags,
      {
        tags: {
          blocked: { set_by: '@mod:example.org', set_at: '2024-01-01T00:00:00Z' },
          resolved: {
            set_by: '@alice:example.org',
            set_at: expect.any(String),
          },
        },
      },
      '$thread-1'
    );

    renderer.unmount();
  });
});

// ─── Legacy migration fallback ──────────────────────────────────────────────

describe('parseLegacyResolutionContent', () => {
  it('converts legacy { resolved: true } to tags format', () => {
    const result = parseLegacyResolutionContent({ resolved: true });
    expect(result).not.toBeNull();
    expect(result!.isResolved).toBe(true);
    expect(result!.tags).toEqual({
      resolved: { set_by: 'legacy', set_at: '' },
    });
  });

  it('converts legacy { resolved: false } to unresolved state', () => {
    const result = parseLegacyResolutionContent({ resolved: false });
    expect(result).not.toBeNull();
    expect(result!.isResolved).toBe(false);
    expect(result!.tags).toBeNull();
  });

  it('returns null for non-object values', () => {
    expect(parseLegacyResolutionContent(null)).toBeNull();
    expect(parseLegacyResolutionContent(undefined)).toBeNull();
    expect(parseLegacyResolutionContent('string')).toBeNull();
    expect(parseLegacyResolutionContent(42)).toBeNull();
  });

  it('returns null when resolved is not a boolean', () => {
    expect(parseLegacyResolutionContent({ resolved: 'yes' })).toBeNull();
    expect(parseLegacyResolutionContent({})).toBeNull();
  });

  it('returns null for arrays', () => {
    expect(parseLegacyResolutionContent([true])).toBeNull();
  });
});
