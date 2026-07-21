import { describe, expect, it } from 'vitest';

import {
  assertNoIncidentMediaReferences,
  assertLiveReplayRoomIsolation,
  buildLiveReplayRoomRequest,
  collectIncidentAttachmentIds,
  LIVE_REPLAY_CANARY_PURPOSE,
  LIVE_REPLAY_CANARY_TYPE,
  LIVE_REPLAY_ROOM_TOPIC,
  parseReplacementAttachmentIds,
  rewriteReplayAttachmentIds,
  validateLiveReplayMedia,
} from './liveSafety';

const incidentAudioMxc = 'mxc://mindroom.chat/incident-voice';
const incidentAttachmentIds = ['incident-a', 'incident-b', 'incident-c'];
const replacementAttachmentIds = ['test-a', 'test-b', 'test-c'];

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

describe('CINNY-126 live replay media safety', () => {
  it.each([
    [undefined],
    ['not-json'],
    ['{}'],
    ['["one","two"]'],
    ['["one","two",3]'],
    ['["one","two",""]'],
    ['["same","same","third"]'],
  ])('rejects malformed replacement attachment input %#', (raw) => {
    expect(() => parseReplacementAttachmentIds(raw)).toThrow('CINNY_126_TEST_ATTACHMENT_IDS');
  });

  it('rejects the verified incident voice MXC', () => {
    expect(() =>
      validateLiveReplayMedia({
        incidentAttachmentIds,
        incidentAudioMxc,
        replacementAttachmentIds,
        testAudioMxc: incidentAudioMxc,
      })
    ).toThrow('incident voice MXC');
  });

  it.each(incidentAttachmentIds)(
    'rejects verified incident attachment ID %s',
    (incidentAttachmentId) => {
      expect(() =>
        validateLiveReplayMedia({
          incidentAttachmentIds,
          incidentAudioMxc,
          replacementAttachmentIds: [incidentAttachmentId, 'test-b', 'test-c'],
          testAudioMxc: 'mxc://mindroom.chat/test-voice',
        })
      ).toThrow('Incident attachment IDs');
    }
  );

  it('rewrites every verified attachment and fails closed for an unknown ID', () => {
    const { attachmentMap } = validateLiveReplayMedia({
      incidentAttachmentIds,
      incidentAudioMxc,
      replacementAttachmentIds,
      testAudioMxc: 'mxc://mindroom.chat/test-voice',
    });

    expect(rewriteReplayAttachmentIds(incidentAttachmentIds, attachmentMap)).toEqual(
      replacementAttachmentIds
    );
    expect(() => rewriteReplayAttachmentIds(['unknown'], attachmentMap)).toThrow(
      'No safe attachment replacement'
    );
  });

  it('detects residual incident media recursively after rewriting', () => {
    const forbidden = new Set([incidentAudioMxc, ...incidentAttachmentIds]);

    expect(() =>
      assertNoIncidentMediaReferences(
        { nested: { attachments: ['test-a', incidentAttachmentIds[1]] } },
        forbidden
      )
    ).toThrow('incident media reference');
    expect(() =>
      assertNoIncidentMediaReferences(
        { nested: { attachments: replacementAttachmentIds } },
        forbidden
      )
    ).not.toThrow();
  });

  it('collects unique attachment IDs from top-level and replacement content', () => {
    expect(
      collectIncidentAttachmentIds([
        { content: { 'com.mindroom.attachment_ids': ['incident-a'] } },
        {
          content: {
            'com.mindroom.attachment_ids': ['incident-a', 'incident-b'],
            'm.new_content': { 'com.mindroom.attachment_ids': ['incident-c'] },
          },
        },
      ])
    ).toEqual(incidentAttachmentIds);
  });
});
