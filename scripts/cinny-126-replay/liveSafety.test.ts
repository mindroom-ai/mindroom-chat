import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  assertNoForbiddenStrings,
  assertLiveReplayRoomIsolation,
  buildSafeLiveReplayContent,
  buildSafeLiveReplayStateKey,
  buildLiveReplayRoomRequest,
  LIVE_REPLAY_CANARY_PURPOSE,
  LIVE_REPLAY_CANARY_TYPE,
  LIVE_REPLAY_ROOM_TOPIC,
  requireMappedEventId,
} from './liveSafety';
import type { TraceEvent } from './trace';

const privateRootId = '$private-root';
const privatePlaceholderId = '$private-placeholder';
const privateFinalEditId = '$private-final-edit';
const safeRootId = '$safe-root';
const safePlaceholderId = '$safe-placeholder';
const safeFinalEditId = '$safe-final-edit';
const idMap = new Map([
  [privateRootId, safeRootId],
  [privatePlaceholderId, safePlaceholderId],
  [privateFinalEditId, safeFinalEditId],
]);

const makeTraceEvent = (
  content: Record<string, unknown>,
  overrides: Partial<TraceEvent> = {}
): TraceEvent => ({
  content,
  event_id: '$private-event',
  origin_server_ts: 1,
  sender: '@private:example.org',
  type: 'm.room.message',
  ...overrides,
});

describe('CINNY-126 disposable live room safety', () => {
  const expectedUserIds = ['@user:test', '@router:test', '@agent:test'];
  const canaryNonce = 'invocation-nonce';
  const validRoomState = {
    canary: { nonce: canaryNonce, purpose: LIVE_REPLAY_CANARY_PURPOSE },
    canaryNonce,
    expectedUserIds,
    historyVisibility: 'joined',
    joinedUserIds: expectedUserIds,
    joinRule: 'invite',
    tagStatePowerLevel: 0,
    topic: LIVE_REPLAY_ROOM_TOPIC,
  };

  it('creates an invite-only room request with fixed history, topic, and canary state', () => {
    const request = buildLiveReplayRoomRequest(expectedUserIds.slice(1), canaryNonce);

    expect(request).toMatchObject({
      invite: expectedUserIds.slice(1),
      is_direct: false,
      power_level_content_override: {
        events: { 'com.mindroom.thread.tags': 0 },
      },
      preset: 'private_chat',
    });
    expect(request.initial_state).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: { history_visibility: 'joined' },
          type: 'm.room.history_visibility',
        }),
        expect.objectContaining({
          content: { topic: LIVE_REPLAY_ROOM_TOPIC },
          type: 'm.room.topic',
        }),
        expect.objectContaining({
          content: { nonce: canaryNonce, purpose: LIVE_REPLAY_CANARY_PURPOSE },
          type: LIVE_REPLAY_CANARY_TYPE,
        }),
      ])
    );
  });

  it('accepts only the exact isolated state created by this invocation', () => {
    expect(() => assertLiveReplayRoomIsolation(validRoomState)).not.toThrow();
  });

  it.each([
    [{ joinedUserIds: [...expectedUserIds, '@unexpected:test'] }, 'three test accounts'],
    [{ joinedUserIds: expectedUserIds.slice(0, 2) }, 'three test accounts'],
    [{ joinRule: 'public' }, 'invite-only'],
    [{ historyVisibility: 'shared' }, 'joined members only'],
    [{ tagStatePowerLevel: 50 }, 'write thread tags'],
    [{ topic: 'operator supplied' }, 'topic'],
    [{ canary: { nonce: 'other', purpose: LIVE_REPLAY_CANARY_PURPOSE } }, 'canary'],
  ])('rejects a non-isolated room state %#', (override, expectedMessage) => {
    expect(() => assertLiveReplayRoomIsolation({ ...validRoomState, ...override })).toThrow(
      expectedMessage
    );
  });
});

describe('CINNY-126 synthetic live payload safety', () => {
  const privateBody = 'private incident transcript';
  const threadRelation = {
    event_id: privateRootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: privateRootId },
    rel_type: 'm.thread',
  };

  it('builds only allowlisted synthetic message payloads', () => {
    const voice = buildSafeLiveReplayContent({
      event: makeTraceEvent({
        body: privateBody,
        info: { private: 'metadata' },
        'm.relates_to': threadRelation,
        msgtype: 'm.audio',
        url: 'mxc://private/media',
      }),
      idMap,
      index: 0,
      kind: 'voice',
      senderUserId: '@test-user:example.org',
    });
    const placeholder = buildSafeLiveReplayContent({
      event: makeTraceEvent({ body: privateBody, 'm.relates_to': threadRelation }),
      idMap,
      index: 0,
      kind: 'placeholder',
      senderUserId: '@test-agent:example.org',
    });
    const transcription = buildSafeLiveReplayContent({
      event: makeTraceEvent({ body: privateBody, 'm.relates_to': threadRelation }),
      idMap,
      index: 0,
      kind: 'transcription',
      senderUserId: '@test-router:example.org',
    });

    expect(voice).toEqual({
      body: 'CINNY-126 synthetic voice marker',
      'm.relates_to': {
        event_id: safeRootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: safeRootId },
        rel_type: 'm.thread',
      },
      msgtype: 'm.text',
    });
    expect(placeholder).toEqual({
      body: 'CINNY-126 synthetic placeholder',
      'io.mindroom.stream_status': 'pending',
      'm.relates_to': {
        event_id: safeRootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: safeRootId },
        rel_type: 'm.thread',
      },
      msgtype: 'm.notice',
    });
    expect(transcription).toEqual({
      body: 'CINNY-126 synthetic transcription',
      'm.relates_to': {
        event_id: safeRootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: safeRootId },
        rel_type: 'm.thread',
      },
      msgtype: 'm.text',
    });
    expect(JSON.stringify([voice, placeholder, transcription])).not.toContain(privateBody);
    expect(JSON.stringify([voice, placeholder, transcription])).not.toContain(
      'mxc://private/media'
    );
    expect(JSON.stringify([voice, placeholder, transcription])).not.toContain('metadata');
  });

  it('builds the exact synthetic streaming and final-edit payloads', () => {
    const event = makeTraceEvent({
      body: privateBody,
      'm.new_content': { body: privateBody },
      'm.relates_to': { event_id: privatePlaceholderId, rel_type: 'm.replace' },
    });

    expect(
      buildSafeLiveReplayContent({
        event,
        idMap,
        index: 0,
        kind: 'edit',
        senderUserId: '@test-agent:example.org',
      })
    ).toEqual({
      body: '* CINNY-126 synthetic stream update 1',
      'io.mindroom.stream_status': 'streaming',
      'm.new_content': {
        body: 'CINNY-126 synthetic stream update 1',
        'io.mindroom.stream_status': 'streaming',
        msgtype: 'm.notice',
      },
      'm.relates_to': { event_id: safePlaceholderId, rel_type: 'm.replace' },
      msgtype: 'm.notice',
    });
    expect(
      buildSafeLiveReplayContent({
        event,
        idMap,
        index: 16,
        kind: 'edit',
        senderUserId: '@test-agent:example.org',
      })
    ).toEqual({
      body: '* CINNY-126 synthetic final answer',
      'io.mindroom.stream_status': 'completed',
      'm.new_content': {
        body: 'CINNY-126 synthetic final answer',
        'io.mindroom.stream_status': 'completed',
        msgtype: 'm.text',
      },
      'm.relates_to': { event_id: safePlaceholderId, rel_type: 'm.replace' },
      msgtype: 'm.text',
    });
  });

  it('builds safe tag state and completion-summary payloads', () => {
    const tagEvent = makeTraceEvent(
      { note: privateBody, set_by: '@private:example.org' },
      {
        state_key: JSON.stringify([privateRootId, 'private-tag']),
        type: 'com.mindroom.thread.tags',
      }
    );
    const summaryEvent = makeTraceEvent({
      body: privateBody,
      'm.relates_to': {
        event_id: privateRootId,
        'm.in_reply_to': { event_id: privateFinalEditId },
        rel_type: 'm.thread',
      },
    });

    expect(
      buildSafeLiveReplayContent({
        event: tagEvent,
        idMap,
        index: 1,
        kind: 'tag',
        senderUserId: '@test-agent:example.org',
      })
    ).toEqual({
      set_at: '2026-01-01T00:00:01.000Z',
      set_by: '@test-agent:example.org',
    });
    expect(buildSafeLiveReplayStateKey(tagEvent, idMap, 1)).toBe(
      JSON.stringify([safeRootId, 'cinny-126-test-2'])
    );
    expect(
      buildSafeLiveReplayContent({
        event: summaryEvent,
        idMap,
        index: 0,
        kind: 'summary',
        senderUserId: '@test-agent:example.org',
      })
    ).toEqual({
      body: 'CINNY-126 synthetic completion summary',
      'm.relates_to': {
        event_id: safeRootId,
        'm.in_reply_to': { event_id: safeFinalEditId },
        rel_type: 'm.thread',
      },
      msgtype: 'm.notice',
    });
  });

  it('fails closed for missing direct, nested, and state-key mappings', () => {
    expect(() => requireMappedEventId('$missing', idMap, 'direct')).toThrow(
      'No safe event-ID mapping'
    );
    expect(() =>
      buildSafeLiveReplayContent({
        event: makeTraceEvent({
          'm.relates_to': {
            event_id: privateRootId,
            'm.in_reply_to': { event_id: '$missing' },
            rel_type: 'm.thread',
          },
        }),
        idMap,
        index: 0,
        kind: 'summary',
        senderUserId: '@test-agent:example.org',
      })
    ).toThrow('No safe event-ID mapping');
    expect(() =>
      buildSafeLiveReplayStateKey(
        makeTraceEvent({}, { state_key: JSON.stringify(['$missing', 'tag']) }),
        idMap,
        0
      )
    ).toThrow('No safe event-ID mapping');
    expect(() =>
      buildSafeLiveReplayStateKey(
        makeTraceEvent({}, { state_key: JSON.stringify([privateRootId, 'tag', 'extra']) }),
        idMap,
        0
      )
    ).toThrow('unsupported shape');
    expect(() =>
      buildSafeLiveReplayStateKey(
        makeTraceEvent({}, { state_key: JSON.stringify([privateRootId, '']) }),
        idMap,
        0
      )
    ).toThrow('unsupported shape');
  });

  it('rejects unhandled relation fields and detects private references recursively', () => {
    expect(() =>
      buildSafeLiveReplayContent({
        event: makeTraceEvent({
          'm.relates_to': {
            event_id: privateRootId,
            private_field: privateBody,
            rel_type: 'm.thread',
          },
        }),
        idMap,
        index: 0,
        kind: 'voice',
        senderUserId: '@test-user:example.org',
      })
    ).toThrow('Unhandled source relation field');
    expect(() =>
      assertNoForbiddenStrings({ nested: { eventId: privateRootId } }, new Set([privateRootId]))
    ).toThrow('private trace reference');
    expect(() =>
      assertNoForbiddenStrings({ nested: { eventId: safeRootId } }, new Set([privateRootId]))
    ).not.toThrow();
  });

  it('prevalidates an allowlisted replay plan and never sends the source event type directly', async () => {
    const source = await readFile(new URL('./live.ts', import.meta.url), 'utf8');

    expect(source.indexOf('const replayPlan =')).toBeLessThan(
      source.indexOf('const createRoomResponse =')
    );
    expect(source).toContain('sendMessageEvent(account, descriptor.eventType, content)');
    expect(source).toContain('sendStateEvent(account, descriptor.eventType, stateKey, content)');
    expect(source).not.toContain('sendMessageEvent(account, event.type');
    expect(source).not.toContain('sendStateEvent(account, event.type');
  });
});
