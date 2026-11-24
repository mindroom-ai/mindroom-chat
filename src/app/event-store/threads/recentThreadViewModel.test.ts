import { describe, expect, it } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { RECENT_THREAD_SUMMARY_LIMIT } from './recentThreadSummaryUtils';
import { buildRecentThreadViewModelFromRecord } from './recentThreadViewModel';
import type { ThreadRecord } from './types';

const makeRoom = (overrides: Partial<Room> = {}): Room =>
  ({
    roomId: '!room:example.org',
    hasEncryptionStateEvent: () => false,
    ...overrides,
  } as Room);

const makeRecord = (overrides: Partial<ThreadRecord> = {}): ThreadRecord => ({
  roomId: '!room:example.org',
  threadRootId: '$canonical',
  rootEventId: '$canonical',
  presentation: {
    summaryInfo: undefined,
    summaryText: undefined,
    rootPreviewText: undefined,
    latestReplyPreviewText: undefined,
    lastSenderId: undefined,
    lastSenderDisplayName: undefined,
    messageCount: 0,
    participantIds: [],
    replyParticipantIds: [],
    primarySummaryText: undefined,
    recentThreadSummaryText: undefined,
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 0,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    tags: [],
  },
  cache: {
    eventCount: 0,
    relationSnapshotComplete: false,
    tailLoaded: false,
  },
  absoluteIndex: 0,
  ...overrides,
});

describe('buildRecentThreadViewModelFromRecord', () => {
  it('uses the canonical ThreadRecord recent summary before the stored snapshot', () => {
    const viewModel = buildRecentThreadViewModelFromRecord({
      record: makeRecord({
        presentation: {
          ...makeRecord().presentation,
          recentThreadSummaryText: 'Canonical summary',
        },
      }),
      room: makeRoom(),
      roomName: 'General',
      storedThreadId: '$old-thread-id',
      openedAt: 123,
      fallbackSummaryText: 'Stored summary',
    });

    expect(viewModel).toEqual({
      id: {
        roomId: '!room:example.org',
        threadRootId: '$canonical',
      },
      storedThreadId: '$old-thread-id',
      openedAt: 123,
      roomName: 'General',
      summaryText: 'Canonical summary',
      persistableSummaryText: 'Canonical summary',
      shouldRekey: true,
    });
  });

  it('falls back to the stored recent-thread summary snapshot', () => {
    const viewModel = buildRecentThreadViewModelFromRecord({
      record: makeRecord(),
      room: makeRoom(),
      roomName: 'General',
      storedThreadId: '$canonical',
      openedAt: 123,
      fallbackSummaryText: 'Stored summary',
    });

    expect(viewModel.summaryText).toBe('Stored summary');
    expect(viewModel.persistableSummaryText).toBe('Stored summary');
    expect(viewModel.shouldRekey).toBe(false);
  });

  it('uses but does not persist the synthetic room fallback', () => {
    const viewModel = buildRecentThreadViewModelFromRecord({
      record: makeRecord(),
      room: makeRoom(),
      roomName: 'General',
      storedThreadId: '$canonical',
      openedAt: 123,
    });

    expect(viewModel.summaryText).toBe('Thread in General');
    expect(viewModel.persistableSummaryText).toBeUndefined();
  });

  it('truncates long stored snapshots consistently with recent-thread summaries', () => {
    const viewModel = buildRecentThreadViewModelFromRecord({
      record: makeRecord(),
      room: makeRoom(),
      roomName: 'General',
      storedThreadId: '$canonical',
      openedAt: 123,
      fallbackSummaryText: 'x'.repeat(200),
    });

    expect(viewModel.summaryText).toHaveLength(RECENT_THREAD_SUMMARY_LIMIT);
    expect(viewModel.summaryText.endsWith('...')).toBe(true);
  });
});

describe('direction controls in a recent thread', () => {
  it('shows the room name and summary with code points and keeps the summary to save exact', () => {
    const viewModel = buildRecentThreadViewModelFromRecord({
      record: makeRecord({
        threadRootId: '$old-thread-id',
        presentation: {
          ...makeRecord().presentation,
          recentThreadSummaryText: 'Audit of ‮xslx.exe‬ before Friday',
        },
      }),
      room: makeRoom(),
      roomName: 'Payroll ‮sevihcra‬',
      storedThreadId: '$old-thread-id',
      openedAt: 123,
    });
    expect(viewModel.roomName).toBe('Payroll <U+202E>sevihcra<U+202C>');
    expect(viewModel.summaryText).toBe('Audit of <U+202E>xslx.exe<U+202C> before Friday');
    expect(viewModel.persistableSummaryText).toBe('Audit of ‮xslx.exe‬ before Friday');
  });
});
