import { RelationType } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { IReplyDraft } from '../../state/room/roomInputDrafts';
import { UploadStatus } from '../../state/upload';
import {
  createRoomInputSendSessionState,
  getTextRelationForSendSession,
  getUploadRelationForSendSession,
  hasMatchingReplyDraftContext,
  resolveRoomInputSendStep,
} from './roomInputSendSession';

const createFile = (name: string, type = 'image/png') => new File(['x'], name, { type });

const successUpload = (file: File, suffix = file.name) => ({
  file,
  status: UploadStatus.Success as const,
  mxc: `mxc://mindroom/${suffix}`,
});

const loadingUpload = (file: File) => ({
  file,
  status: UploadStatus.Loading as const,
  progress: { loaded: 1, total: 2 },
  promise: Promise.resolve({ content_uri: 'mxc://mindroom/loading' }),
});

const errorUpload = (file: File) => ({
  file,
  status: UploadStatus.Error as const,
  error: new Error('upload failed'),
});

const plainReplyDraft = (eventId = '$reply'): IReplyDraft => ({
  userId: '@alice:example.org',
  eventId,
  body: 'reply body',
});

describe('roomInputSendSession', () => {
  it('sends text first, then attachments in selection order for text plus attachments', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const session = createRoomInputSendSessionState({
      files: [first, second],
      hasText: true,
    });

    expect(session.mode).toBe('auto-thread-text-root');
    expect(resolveRoomInputSendStep(session, [], [first, second])).toEqual({ kind: 'send-text' });

    session.textPending = false;
    session.rootEventId = '$root';

    expect(
      resolveRoomInputSendStep(session, [loadingUpload(first), successUpload(second)], [first, second])
    ).toEqual({ kind: 'wait' });

    expect(
      resolveRoomInputSendStep(session, [successUpload(first), successUpload(second)], [first, second])
    ).toEqual({
      kind: 'send-upload',
      file: first,
      mxc: 'mxc://mindroom/first.png',
      isRoot: false,
    });

    session.sentFiles.add(first);

    expect(
      resolveRoomInputSendStep(session, [successUpload(first), successUpload(second)], [first, second])
    ).toEqual({
      kind: 'send-upload',
      file: second,
      mxc: 'mxc://mindroom/second.png',
      isRoot: false,
    });

    session.sentFiles.add(second);

    expect(
      resolveRoomInputSendStep(session, [successUpload(first), successUpload(second)], [first, second])
    ).toEqual({ kind: 'complete' });
  });

  it('uses the first attachment as the root and threads the rest for attachment-only sends', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const third = createFile('third.png');
    const session = createRoomInputSendSessionState({
      files: [first, second, third],
      hasText: false,
    });

    expect(session.mode).toBe('auto-thread-upload-root');
    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second), successUpload(third)],
        [first, second, third]
      )
    ).toEqual({
      kind: 'send-upload',
      file: first,
      mxc: 'mxc://mindroom/first.png',
      isRoot: true,
    });

    session.sentFiles.add(first);
    session.rootEventId = '$root';

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second), successUpload(third)],
        [first, second, third]
      )
    ).toEqual({
      kind: 'send-upload',
      file: second,
      mxc: 'mxc://mindroom/second.png',
      isRoot: false,
    });
  });

  it('keeps a single attachment as a room-level send', () => {
    const only = createFile('only.png');
    const session = createRoomInputSendSessionState({
      files: [only],
      hasText: false,
    });

    expect(session.mode).toBe('room');
    expect(resolveRoomInputSendStep(session, [successUpload(only)], [only])).toEqual({
      kind: 'send-upload',
      file: only,
      mxc: 'mxc://mindroom/only.png',
      isRoot: false,
    });
  });

  it('preserves explicit thread context without creating a new root event', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const session = createRoomInputSendSessionState({
      files: [first, second],
      hasText: true,
      threadId: '$thread',
    });

    expect(session.mode).toBe('existing-thread');
    expect(getTextRelationForSendSession({ ...session, threadId: '$thread' })).toMatchObject({
      event_id: '$thread',
      rel_type: RelationType.Thread,
      is_falling_back: true,
    });

    expect(resolveRoomInputSendStep(session, [], [first, second])).toEqual({ kind: 'send-text' });

    session.textPending = false;

    expect(
      resolveRoomInputSendStep(session, [successUpload(first), successUpload(second)], [first, second])
    ).toEqual({
      kind: 'send-upload',
      file: first,
      mxc: 'mxc://mindroom/first.png',
      isRoot: false,
    });
    expect(session.rootEventId).toBeUndefined();
  });

  it('keeps plain reply metadata on the root and threads later attachments under the new root', () => {
    const first = createFile('first.png');
    const textSession = createRoomInputSendSessionState({
      files: [first],
      hasText: true,
      replyDraft: plainReplyDraft(),
    });

    expect(
      getTextRelationForSendSession({ ...textSession, replyDraft: plainReplyDraft() })
    ).toEqual({
      'm.in_reply_to': {
        event_id: '$reply',
      },
    });

    const uploadSession = createRoomInputSendSessionState({
      files: [first, createFile('second.png')],
      hasText: false,
      replyDraft: plainReplyDraft(),
    });

    expect(
      getUploadRelationForSendSession(
        {
          ...uploadSession,
          replyDraft: plainReplyDraft(),
        },
        true
      )
    ).toEqual({
      'm.in_reply_to': {
        event_id: '$reply',
      },
    });

    uploadSession.rootEventId = '$new-root';

    expect(
      getUploadRelationForSendSession(
        {
          ...uploadSession,
          replyDraft: plainReplyDraft(),
        },
        false
      )
    ).toEqual({
      'm.in_reply_to': {
        event_id: '$new-root',
      },
      event_id: '$new-root',
      rel_type: RelationType.Thread,
      is_falling_back: true,
    });
  });

  it('blocks later attachments when the root upload fails, then promotes the next file after removal', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const third = createFile('third.png');
    const session = createRoomInputSendSessionState({
      files: [first, second, third],
      hasText: false,
    });

    expect(
      resolveRoomInputSendStep(
        session,
        [errorUpload(first), successUpload(second), successUpload(third)],
        [first, second, third]
      )
    ).toEqual({ kind: 'wait' });

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(second), successUpload(third)],
        [second, third]
      )
    ).toEqual({
      kind: 'send-upload',
      file: second,
      mxc: 'mxc://mindroom/second.png',
      isRoot: true,
    });
  });

  it('skips failed non-root uploads without blocking later successful attachments and reuses the same root on retry', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const third = createFile('third.png');
    const session = createRoomInputSendSessionState({
      files: [first, second, third],
      hasText: false,
    });

    session.sentFiles.add(first);
    session.rootEventId = '$root';

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), errorUpload(second), successUpload(third)],
        [first, second, third]
      )
    ).toEqual({
      kind: 'send-upload',
      file: third,
      mxc: 'mxc://mindroom/third.png',
      isRoot: false,
    });

    session.sentFiles.add(third);

    expect(
      getUploadRelationForSendSession(
        {
          ...session,
          replyDraft: plainReplyDraft(),
        },
        false
      )
    ).toMatchObject({
      event_id: '$root',
      rel_type: RelationType.Thread,
    });

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second), successUpload(third)],
        [first, second, third]
      )
    ).toEqual({
      kind: 'send-upload',
      file: second,
      mxc: 'mxc://mindroom/second.png',
      isRoot: false,
    });
  });

  it('only matches reply-draft clearing when the live send context still matches the session snapshot', () => {
    const replyDraft = plainReplyDraft('$reply-a');

    expect(
      hasMatchingReplyDraftContext(
        {
          roomId: '!room:example.org',
          threadId: '$thread-a',
          replyDraft,
        },
        {
          roomId: '!room:example.org',
          threadId: '$thread-a',
          replyDraft: {
            ...replyDraft,
            body: 'updated preview text',
          },
        }
      )
    ).toBe(true);

    expect(
      hasMatchingReplyDraftContext(
        {
          roomId: '!room:example.org',
          threadId: '$thread-a',
          replyDraft,
        },
        {
          roomId: '!room:example.org',
          threadId: '$thread-b',
          replyDraft,
        }
      )
    ).toBe(false);

    expect(
      hasMatchingReplyDraftContext(
        {
          roomId: '!room:example.org',
          threadId: '$thread-a',
          replyDraft,
        },
        {
          roomId: '!room:example.org',
          threadId: '$thread-a',
          replyDraft: plainReplyDraft('$reply-b'),
        }
      )
    ).toBe(false);
  });
});
