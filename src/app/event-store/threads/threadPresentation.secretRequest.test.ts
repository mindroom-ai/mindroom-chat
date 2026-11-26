import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import { describe, expect, it } from 'vitest';
import { MINDROOM_SECRET_REQUEST_KEY } from '../../matrix/protocol/secretRequest';
import { resolveThreadPresentationSnapshot } from './threadPresentation';

const ROOM = '!room:example.org';
const ROOT = '$root';
const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';

const root = new MatrixEvent({
  event_id: ROOT,
  room_id: ROOM,
  sender: VIEWER,
  type: 'm.room.message',
  origin_server_ts: 1,
  content: { msgtype: 'm.text', body: 'Deploy the release' },
});

const replyEvent = new MatrixEvent({
  event_id: '$reply',
  room_id: ROOM,
  sender: AGENT,
  type: 'm.room.message',
  origin_server_ts: 2,
  content: {
    msgtype: 'm.text',
    body: 'Release deployed successfully.',
    'm.relates_to': { event_id: ROOT, rel_type: RelationType.Thread },
  },
});

const secretNotice = ({
  status,
  anchored = true,
  sender = AGENT,
  body = status === 'pending' ? 'API token needed' : '🔑 Secret received.',
}: {
  status: 'pending' | 'saved' | 'declined' | 'expired';
  anchored?: boolean;
  sender?: string;
  body?: string;
}) =>
  new MatrixEvent({
    event_id: '$secret',
    room_id: ROOM,
    sender,
    type: 'm.room.message',
    origin_server_ts: 3,
    content: {
      msgtype: 'm.notice',
      body,
      [MINDROOM_SECRET_REQUEST_KEY]: {
        request_id: 'req-1',
        requester_id: VIEWER,
        env: 'API_TOKEN',
        keep: { memory: 900 },
        reason: 'To push the release',
        status,
        expires_at: 1,
        ...(anchored ? { response_event_id: '$reply', tool_call_id: 'call_1' } : {}),
      },
      'm.relates_to': { event_id: ROOT, rel_type: RelationType.Thread },
    },
  });

const room = {
  myUserId: VIEWER,
  getMember: () => undefined,
  getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
} as unknown as Room;

const present = (events: MatrixEvent[]) =>
  resolveThreadPresentationSnapshot({
    room,
    threadRootId: ROOT,
    thread: { events, timeline: events },
    rootEvent: root,
  });

describe('folded secret-request notices as thread reply previews', () => {
  it.each(['saved', 'declined', 'expired'] as const)(
    'skips a newer anchored %s secret request and previews the agent reply before it',
    (status) => {
      const presentation = present([replyEvent, secretNotice({ status })]);
      expect(presentation.latestReplyPreviewText).toBe('Release deployed successfully.');
      expect(presentation.lastSenderId).toBe(AGENT);
    }
  );

  it('still previews a pending anchored secret request and an unanchored saved secret request', () => {
    expect(present([replyEvent, secretNotice({ status: 'pending' })]).latestReplyPreviewText).toBe(
      'API token needed'
    );
    expect(
      present([replyEvent, secretNotice({ status: 'saved', anchored: false })])
        .latestReplyPreviewText
    ).toBe('🔑 Secret received.');
  });

  it('does not fold a foreign-homeserver spoof and omits lastSenderId when only a folded secret exists', () => {
    expect(
      present([
        replyEvent,
        secretNotice({ status: 'saved', sender: '@mindroom_helper:elsewhere.example' }),
      ]).latestReplyPreviewText
    ).toBe('🔑 Secret received.');

    const onlyFolded = present([secretNotice({ status: 'saved' })]);
    expect(onlyFolded.latestReplyPreviewText).toBeUndefined();
    expect(onlyFolded.lastSenderId).toBeUndefined();
  });

  it('replaces a cached pending prompt once the secret folds, without overriding a genuinely newer cache', () => {
    const folded = secretNotice({ status: 'pending', body: 'API token needed' });
    folded.makeReplaced(
      new MatrixEvent({
        event_id: '$secret-edit',
        room_id: ROOM,
        sender: AGENT,
        type: 'm.room.message',
        origin_server_ts: 4,
        content: {
          msgtype: 'm.notice',
          body: '* 🔑 Secret received.',
          'm.new_content': {
            msgtype: 'm.notice',
            body: '🔑 Secret received.',
            [MINDROOM_SECRET_REQUEST_KEY]: {
              request_id: 'req-1',
              requester_id: VIEWER,
              env: 'API_TOKEN',
              keep: { memory: 900 },
              reason: 'To push the release',
              status: 'saved',
              expires_at: 1,
              response_event_id: '$reply',
              tool_call_id: 'call_1',
            },
          },
          'm.relates_to': { rel_type: RelationType.Replace, event_id: '$secret' },
        },
      })
    );
    const bundledPreviews = { reply: replyEvent, latest: { id: '$reply', ts: 2 } };

    // Cached pending prompt (t=3) is superseded when $secret folds at t=4: both loaded and bundled-only $reply (t=2) win.
    const withLoadedAndBundled = resolveThreadPresentationSnapshot({
      room,
      threadRootId: ROOT,
      thread: { events: [replyEvent, folded], timeline: [replyEvent, folded] },
      rootEvent: root,
      bundledPreviews,
      fallbackLatestReplyPreviewText: 'API token needed',
      fallbackLatestReplyTs: 3,
      fallbackLastSenderId: AGENT,
    });
    expect(withLoadedAndBundled.latestReplyPreviewText).toBe('Release deployed successfully.');

    const withBundledOnly = resolveThreadPresentationSnapshot({
      room,
      threadRootId: ROOT,
      thread: { events: [], timeline: [], replyToEvent: folded },
      rootEvent: root,
      bundledPreviews,
      fallbackLatestReplyPreviewText: 'API token needed',
      fallbackLatestReplyTs: 3,
      fallbackLastSenderId: AGENT,
    });
    expect(withBundledOnly.latestReplyPreviewText).toBe('Release deployed successfully.');

    // Unopened folded-only case (no loaded/bundled/retained agent reply): stale cached prompt is discarded.
    const unopenedFoldedOnly = resolveThreadPresentationSnapshot({
      room,
      threadRootId: ROOT,
      thread: { events: [], timeline: [], replyToEvent: folded },
      rootEvent: root,
      fallbackLatestReplyPreviewText: 'API token needed',
      fallbackLatestReplyTs: 3,
      fallbackLastSenderId: AGENT,
    });
    expect(unopenedFoldedOnly.latestReplyPreviewText).toBeUndefined();
    expect(unopenedFoldedOnly.latestReplyTs).toBeUndefined();
    expect(unopenedFoldedOnly.lastSenderId).toBeUndefined();
    expect(unopenedFoldedOnly.rootPreviewText).toBe('Deploy the release');

    // A cached answer from before the request existed (t=2 < 3) is NOT the stale prompt and is kept.
    const olderCachedAnswer = resolveThreadPresentationSnapshot({
      room,
      threadRootId: ROOT,
      thread: { events: [], timeline: [], replyToEvent: folded },
      rootEvent: root,
      fallbackLatestReplyPreviewText: 'The release is ready.',
      fallbackLatestReplyTs: 2,
      fallbackLastSenderId: AGENT,
    });
    expect(olderCachedAnswer.latestReplyPreviewText).toBe('The release is ready.');
    expect(olderCachedAnswer.latestReplyTs).toBe(2);
    expect(olderCachedAnswer.lastSenderId).toBe(AGENT);

    // A genuinely newer reply cached after the secret folded (t=10 > 4) is still preserved.
    const newerCached = resolveThreadPresentationSnapshot({
      room,
      threadRootId: ROOT,
      thread: { events: [replyEvent, folded], timeline: [replyEvent, folded] },
      rootEvent: root,
      bundledPreviews,
      fallbackLatestReplyPreviewText: 'Follow-up after deploy',
      fallbackLatestReplyTs: 10,
      fallbackLastSenderId: VIEWER,
    });
    expect(newerCached.latestReplyPreviewText).toBe('Follow-up after deploy');
    expect(newerCached.lastSenderId).toBe(VIEWER);
  });
});
