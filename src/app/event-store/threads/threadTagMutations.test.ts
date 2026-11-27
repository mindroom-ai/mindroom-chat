import { afterEach, describe, expect, it, vi } from 'vitest';
import { MsgType, RelationType, type MatrixClient } from 'matrix-js-sdk';
import {
  makeResolvedTagEvent,
  makeResolvedThreadRoom,
} from '../../../test/utils/resolvedThreadRoom';
import {
  captureResolvedThreadBeforeReply,
  reopenResolvedThreadAfterReply,
} from './threadTagMutations';
import {
  hasPendingThreadTag,
  resetPendingThreadTagsForTests,
  setPendingThreadTag,
  withPendingThreadTags,
} from './threadTagPending';
import { buildPerTagStateKey, MINDROOM_THREAD_TAGS_EVENT, RESOLVED_TAG } from './threadTags';

const ROOM_ID = '!room:example.org';
const ROOT_ID = '$root';
const USER_ID = '@alice:example.org';
const threadRelation = { rel_type: RelationType.Thread, event_id: ROOT_ID };
const threadText = { msgtype: MsgType.Text, body: 'hi', 'm.relates_to': threadRelation };

const makeClient = (sendStateEvent = vi.fn().mockResolvedValue({ event_id: '$tag' })) => ({
  client: {
    getUserId: () => USER_ID,
    getSafeUserId: () => USER_ID,
    sendStateEvent,
  } as unknown as MatrixClient,
  sendStateEvent,
});

afterEach(() => {
  resetPendingThreadTagsForTests();
  vi.restoreAllMocks();
});

describe('reopenResolvedThreadAfterReply', () => {
  it('reopens a resolved thread on m.thread reply with immediate optimistic pending removal', async () => {
    const { room } = makeResolvedThreadRoom();
    let finishWrite!: () => void;
    const { client, sendStateEvent } = makeClient(
      vi.fn(() => new Promise<void>((resolve) => (finishWrite = resolve)))
    );

    const reopening = reopenResolvedThreadAfterReply(
      client,
      room,
      captureResolvedThreadBeforeReply(room, threadText)
    );
    expect(hasPendingThreadTag(ROOM_ID, ROOT_ID, RESOLVED_TAG)).toBe(true);
    expect(
      withPendingThreadTags(ROOM_ID, ROOT_ID, {
        tags: { [RESOLVED_TAG]: { set_by: USER_ID, set_at: '2026-11-27T10:00:00.000Z' } },
      }).tags
    ).toEqual({});
    expect(sendStateEvent).toHaveBeenCalledWith(
      ROOM_ID,
      MINDROOM_THREAD_TAGS_EVENT,
      {},
      buildPerTagStateKey(ROOT_ID, RESOLVED_TAG)
    );
    finishWrite();
    await reopening;
  });

  it('ignores main-timeline messages, classic replies, m.replace edits, and m.notice while accepting m.emote and stickers', () => {
    const { room } = makeResolvedThreadRoom();
    expect(captureResolvedThreadBeforeReply(room, undefined)).toBeUndefined();
    expect(
      captureResolvedThreadBeforeReply(room, { msgtype: MsgType.Text, body: 'hi' })
    ).toBeUndefined();
    expect(
      captureResolvedThreadBeforeReply(room, {
        msgtype: MsgType.Text,
        'm.relates_to': { 'm.in_reply_to': { event_id: ROOT_ID } },
      })
    ).toBeUndefined();
    expect(
      captureResolvedThreadBeforeReply(room, {
        msgtype: MsgType.Text,
        'm.relates_to': { rel_type: RelationType.Replace, event_id: ROOT_ID },
      })
    ).toBeUndefined();
    expect(
      captureResolvedThreadBeforeReply(room, {
        msgtype: MsgType.Notice,
        body: 'FYI',
        'm.relates_to': threadRelation,
      })
    ).toBeUndefined();
    expect(
      captureResolvedThreadBeforeReply(room, {
        msgtype: MsgType.Emote,
        body: 'waves',
        'm.relates_to': threadRelation,
      })?.threadRootId
    ).toBe(ROOT_ID);
    expect(
      captureResolvedThreadBeforeReply(room, {
        body: 'Wave',
        url: 'mxc://example.org/wave',
        'm.relates_to': threadRelation,
      })?.threadRootId
    ).toBe(ROOT_ID);
  });

  it('skips when unresolved before send, reopened during send, or replaced by a newer resolve', async () => {
    const { room, state } = makeResolvedThreadRoom({ tagEvents: [] });
    const { client, sendStateEvent } = makeClient();

    const beforeUnresolved = captureResolvedThreadBeforeReply(room, threadText);
    state.tagEvents = [makeResolvedTagEvent({ ts: 2000 })];
    await reopenResolvedThreadAfterReply(client, room, beforeUnresolved);

    const beforeReopened = captureResolvedThreadBeforeReply(room, threadText);
    state.tagEvents = [];
    await reopenResolvedThreadAfterReply(client, room, beforeReopened);

    state.tagEvents = [makeResolvedTagEvent({ ts: 2000, setAt: '2026-11-27T10:00:00.000Z' })];
    const beforeReplaced = captureResolvedThreadBeforeReply(room, threadText);
    state.tagEvents = [makeResolvedTagEvent({ ts: 3000, setAt: '2026-11-27T10:05:00.000Z' })];
    await reopenResolvedThreadAfterReply(client, room, beforeReplaced);
    expect(sendStateEvent).not.toHaveBeenCalled();
  });

  it('skips when pending resolved write or pin is active, but ignores unrelated pending tags', async () => {
    const { room, state } = makeResolvedThreadRoom();
    const { client, sendStateEvent } = makeClient();

    const captured = captureResolvedThreadBeforeReply(room, threadText);
    setPendingThreadTag(ROOM_ID, ROOT_ID, RESOLVED_TAG, null);
    await reopenResolvedThreadAfterReply(client, room, captured);
    resetPendingThreadTagsForTests();

    const beforePin = captureResolvedThreadBeforeReply(room, threadText);
    state.pinnedIds = [ROOT_ID];
    await reopenResolvedThreadAfterReply(client, room, beforePin);
    expect(sendStateEvent).not.toHaveBeenCalled();

    state.pinnedIds = [];
    setPendingThreadTag(ROOM_ID, ROOT_ID, 'urgent', {
      set_by: USER_ID,
      set_at: '2026-11-27T10:01:00.000Z',
    });
    await reopenResolvedThreadAfterReply(
      client,
      room,
      captureResolvedThreadBeforeReply(room, threadText)
    );
    expect(sendStateEvent).toHaveBeenCalledTimes(1);
  });

  it('checks room permissions, allows v12 creators, and swallows tag-write failures', async () => {
    const restricted = makeResolvedThreadRoom({
      powerLevels: { state_default: 50, users: { [USER_ID]: 0 } },
    });
    const denied = makeClient();
    await reopenResolvedThreadAfterReply(
      denied.client,
      restricted.room,
      captureResolvedThreadBeforeReply(restricted.room, threadText)
    );
    expect(denied.sendStateEvent).not.toHaveBeenCalled();

    const v12 = makeResolvedThreadRoom({
      powerLevels: { state_default: 50 },
      create: { content: { room_version: '12' }, sender: USER_ID },
    });
    const failing = makeClient(vi.fn().mockRejectedValue(new Error('forbidden')));
    await expect(
      reopenResolvedThreadAfterReply(
        failing.client,
        v12.room,
        captureResolvedThreadBeforeReply(v12.room, threadText)
      )
    ).resolves.toBeUndefined();
    expect(failing.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(hasPendingThreadTag(ROOM_ID, ROOT_ID, RESOLVED_TAG)).toBe(false);

    const brokenRoom = {
      roomId: ROOM_ID,
      getLiveTimeline: () => {
        throw new Error('broken state');
      },
    } as never;
    expect(captureResolvedThreadBeforeReply(brokenRoom, threadText)).toBeUndefined();
    await expect(
      reopenResolvedThreadAfterReply(failing.client, brokenRoom, {
        threadRootId: ROOT_ID,
        resolvedTs: 1000,
        resolvedTag: { set_by: USER_ID, set_at: '2026-11-27T10:00:00.000Z' },
      })
    ).resolves.toBeUndefined();
  });
});
