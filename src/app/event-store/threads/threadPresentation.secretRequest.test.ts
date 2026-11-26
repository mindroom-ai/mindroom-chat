import { MatrixEvent, RelationType, type Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { MINDROOM_SECRET_REQUEST_KEY } from '../../matrix/protocol/secretRequest';
import {
  secretRequestEditContent,
  secretRequestPayload,
} from '../../matrix/protocol/secretRequest.test.shared';
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
      [MINDROOM_SECRET_REQUEST_KEY]: secretRequestPayload({
        status,
        ...(anchored ? {} : { response_event_id: undefined, tool_call_id: undefined }),
      }),
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
    thread: { room, events, timeline: events },
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

  it('replaces a cached pending prompt once the secret folds, without overriding unrelated caches', () => {
    const folded = secretNotice({ status: 'pending', body: 'API token needed' });
    folded.makeReplaced(
      new MatrixEvent({
        event_id: '$secret-edit',
        room_id: ROOM,
        sender: AGENT,
        type: 'm.room.message',
        origin_server_ts: 5,
        content: secretRequestEditContent('$secret'),
      })
    );
    const bundledPreviews = { reply: replyEvent, latest: { id: '$reply', ts: 2 } };
    const loadedThread = { room, events: [replyEvent, folded], timeline: [replyEvent, folded] };
    const unopenedThread = { room, events: [], timeline: [], replyToEvent: folded };
    const presentCached = (
      overrides: Partial<Parameters<typeof resolveThreadPresentationSnapshot>[0]> = {}
    ) =>
      resolveThreadPresentationSnapshot({
        room,
        threadRootId: ROOT,
        rootEvent: root,
        thread: unopenedThread,
        fallbackLatestReplyPreviewText: 'API token needed',
        fallbackLatestReplyTs: 3,
        fallbackLastSenderId: AGENT,
        ...overrides,
      });

    // Cached pending prompt (t=3) is superseded when $secret folds at t=5: loaded and bundled $reply (t=2) win.
    expect(presentCached({ thread: loadedThread, bundledPreviews }).latestReplyPreviewText).toBe(
      'Release deployed successfully.'
    );
    expect(presentCached({ bundledPreviews }).latestReplyPreviewText).toBe(
      'Release deployed successfully.'
    );

    // Unopened folded-only case (no loaded/bundled/retained agent reply): stale cached prompt is discarded.
    expect(presentCached()).toMatchObject({
      latestReplyPreviewText: undefined,
      latestReplyTs: undefined,
      lastSenderId: undefined,
      rootPreviewText: 'Deploy the release',
    });

    // Cached answer predating the request (t=2 < 3) is NOT the stale prompt and is kept.
    expect(
      presentCached({
        fallbackLatestReplyPreviewText: 'The release is ready.',
        fallbackLatestReplyTs: 2,
      })
    ).toMatchObject({
      latestReplyPreviewText: 'The release is ready.',
      latestReplyTs: 2,
      lastSenderId: AGENT,
    });

    // Cached reply from a different sender at t=4 (between request t=3 and fold t=5) is preserved.
    expect(
      presentCached({
        fallbackLatestReplyPreviewText: 'Hold on, checking logs',
        fallbackLatestReplyTs: 4,
        fallbackLastSenderId: VIEWER,
      })
    ).toMatchObject({
      latestReplyPreviewText: 'Hold on, checking logs',
      latestReplyTs: 4,
      lastSenderId: VIEWER,
    });

    // A genuinely newer reply cached after the secret folded (t=10 > 5) is still preserved.
    expect(
      presentCached({
        thread: loadedThread,
        bundledPreviews,
        fallbackLatestReplyPreviewText: 'Follow-up after deploy',
        fallbackLatestReplyTs: 10,
        fallbackLastSenderId: VIEWER,
      })
    ).toMatchObject({
      latestReplyPreviewText: 'Follow-up after deploy',
      lastSenderId: VIEWER,
    });
  });
});
