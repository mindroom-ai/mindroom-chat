import { RelationType } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { IReplyDraft } from './roomInputDrafts';
import { Upload, UploadStatus } from '../matrix/state/upload';
import {
  createRoomInputSendSessionState,
  getSubmissionMarker,
  getTextRelationForSendSession,
  getUploadRelationForSendSession,
  isRoomInputSendSessionStalled,
  resolveRoomInputSendStep,
  RoomInputSendSessionState,
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
  it('sends attachments first and the caption last for text plus attachments', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const session = createRoomInputSendSessionState({
      files: [first, second],
      hasText: true,
    });

    expect(session.mode).toBe('auto-thread-upload-root');

    expect(
      resolveRoomInputSendStep(
        session,
        [loadingUpload(first), successUpload(second)],
        [first, second]
      )
    ).toEqual({ kind: 'wait' });

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second)],
        [first, second]
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
        [successUpload(first), successUpload(second)],
        [first, second]
      )
    ).toEqual({
      kind: 'send-upload',
      file: second,
      mxc: 'mxc://mindroom/second.png',
      isRoot: false,
    });

    session.sentFiles.add(second);

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second)],
        [first, second]
      )
    ).toEqual({ kind: 'send-text' });

    session.textPending = false;

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second)],
        [first, second]
      )
    ).toEqual({ kind: 'complete' });

    expect(getTextRelationForSendSession(session)).toMatchObject({
      event_id: '$root',
      rel_type: RelationType.Thread,
    });
  });

  it('auto-threads a single attachment with a caption under the upload root', () => {
    const only = createFile('only.png');
    const session = createRoomInputSendSessionState({
      files: [only],
      hasText: true,
    });

    expect(session.mode).toBe('auto-thread-upload-root');
    expect(resolveRoomInputSendStep(session, [successUpload(only)], [only])).toEqual({
      kind: 'send-upload',
      file: only,
      mxc: 'mxc://mindroom/only.png',
      isRoot: true,
    });

    session.sentFiles.add(only);
    session.rootEventId = '$root';

    expect(resolveRoomInputSendStep(session, [successUpload(only)], [only])).toEqual({
      kind: 'send-text',
    });
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

    expect(resolveRoomInputSendStep(session, [], [first, second])).toEqual({ kind: 'wait' });

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second)],
        [first, second]
      )
    ).toEqual({
      kind: 'send-upload',
      file: first,
      mxc: 'mxc://mindroom/first.png',
      isRoot: false,
    });

    session.sentFiles.add(first);
    session.sentFiles.add(second);

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), successUpload(second)],
        [first, second]
      )
    ).toEqual({ kind: 'send-text' });
    expect(session.rootEventId).toBeUndefined();
  });

  it('keeps classic-mode sends at room level and suppresses thread reply relations', () => {
    const session = createRoomInputSendSessionState({
      files: [createFile('first.png'), createFile('second.png')],
      hasText: true,
      replyDraft: {
        ...plainReplyDraft(),
        relation: {
          rel_type: RelationType.Thread,
          event_id: '$thread',
        },
      },
      threadingEnabled: false,
    });

    expect(session.mode).toBe('room');
    expect(
      getTextRelationForSendSession({
        ...session,
        replyDraft: {
          ...plainReplyDraft(),
          relation: {
            rel_type: RelationType.Thread,
            event_id: '$thread',
          },
        },
        threadingEnabled: false,
      })
    ).toEqual({
      'm.in_reply_to': {
        event_id: '$reply',
      },
    });
  });

  it('keeps plain reply metadata on the root and threads later attachments under the new root', () => {
    const first = createFile('first.png');
    const captionedSession = createRoomInputSendSessionState({
      files: [first],
      hasText: true,
      replyDraft: plainReplyDraft(),
    });

    expect(
      getUploadRelationForSendSession({ ...captionedSession, replyDraft: plainReplyDraft() }, true)
    ).toEqual({
      'm.in_reply_to': {
        event_id: '$reply',
      },
    });

    captionedSession.rootEventId = '$new-root';

    expect(
      getTextRelationForSendSession({ ...captionedSession, replyDraft: plainReplyDraft() })
    ).toMatchObject({
      event_id: '$new-root',
      rel_type: RelationType.Thread,
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

  it('sends the caption without waiting for a failed non-root upload awaiting manual retry', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const session = createRoomInputSendSessionState({
      files: [first, second],
      hasText: true,
    });

    session.sentFiles.add(first);
    session.rootEventId = '$root';
    session.failedFiles.add(second);

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), errorUpload(second)],
        [first, second]
      )
    ).toEqual({ kind: 'send-text' });

    session.textPending = false;

    expect(
      resolveRoomInputSendStep(
        session,
        [successUpload(first), errorUpload(second)],
        [first, second]
      )
    ).toEqual({ kind: 'wait' });
  });

  it('sends the caption on its own while the root attachment waits for a retry of its upload', () => {
    const first = createFile('first.png');
    const session = createRoomInputSendSessionState({ files: [first], hasText: true });

    expect(session.mode).toBe('auto-thread-upload-root');
    expect(resolveRoomInputSendStep(session, [errorUpload(first)], [first])).toEqual({
      kind: 'send-text',
    });
    // No thread exists yet, so the caption goes to the room, still replying where it was written.
    const relation = getTextRelationForSendSession({ ...session, replyDraft: plainReplyDraft() });
    expect(relation?.rel_type).toBeUndefined();
    expect(relation?.['m.in_reply_to']?.event_id).toBe('$reply');

    session.textPending = false;
    expect(resolveRoomInputSendStep(session, [errorUpload(first)], [first])).toEqual({
      kind: 'wait',
    });
    expect(isRoomInputSendSessionStalled(session, [errorUpload(first)], [first])).toBe(true);
  });

  it('sends the caption on its own while a root whose send failed waits to be sent again', () => {
    const first = createFile('first.png');
    const session = createRoomInputSendSessionState({ files: [first], hasText: true });
    session.blockedRoot = true;

    expect(resolveRoomInputSendStep(session, [successUpload(first)], [first])).toEqual({
      kind: 'send-text',
    });
    session.textPending = false;
    expect(resolveRoomInputSendStep(session, [successUpload(first)], [first])).toEqual({
      kind: 'wait',
    });
    expect(isRoomInputSendSessionStalled(session, [successUpload(first)], [first])).toBe(true);
  });

  // MindRoom holds a submission only briefly after its last event: a photo sent while a long
  // video uploads would be answered alone.
  it('sends no file, the root included, while another file still uploads', () => {
    const first = createFile('first.png');
    const second = createFile('second.mp4', 'video/mp4');
    const rooted = createRoomInputSendSessionState({ files: [first, second], hasText: true });
    const threaded = createRoomInputSendSessionState({
      files: [first, second],
      hasText: true,
      threadId: '$thread',
    });

    for (const session of [rooted, threaded]) {
      expect(
        resolveRoomInputSendStep(
          session,
          [successUpload(first), loadingUpload(second)],
          [first, second]
        )
      ).toEqual({ kind: 'wait' });
      expect(
        resolveRoomInputSendStep(
          session,
          [successUpload(first), successUpload(second)],
          [first, second]
        )
      ).toEqual({
        kind: 'send-upload',
        file: first,
        mxc: 'mxc://mindroom/first.png',
        isRoot: session === rooted,
      });
    }
    // Nor does the caption while the root waits for a retry and another file uploads.
    expect(
      resolveRoomInputSendStep(rooted, [errorUpload(first), loadingUpload(second)], [first, second])
    ).toEqual({ kind: 'wait' });
  });

  it('sends the files once every upload has succeeded or failed', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const session = createRoomInputSendSessionState({
      files: [first, second],
      hasText: true,
      threadId: '$thread',
    });

    expect(
      resolveRoomInputSendStep(
        session,
        [errorUpload(first), successUpload(second)],
        [first, second]
      )
    ).toEqual({
      kind: 'send-upload',
      file: second,
      mxc: 'mxc://mindroom/second.png',
      isRoot: false,
    });
  });

  it('counts a session as stalled only when everything it waits for needs the person', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const session = createRoomInputSendSessionState({
      files: [first, second],
      hasText: false,
      threadId: '$thread',
    });

    // An upload still running: the session goes on by itself.
    expect(
      isRoomInputSendSessionStalled(
        session,
        [loadingUpload(first), errorUpload(second)],
        [first, second]
      )
    ).toBe(false);
    // Only a failed upload and a failed send are left: both wait for a retry.
    session.failedFiles.add(first);
    expect(
      isRoomInputSendSessionStalled(
        session,
        [successUpload(first), errorUpload(second)],
        [first, second]
      )
    ).toBe(true);
    // A file ready to send is progress.
    session.failedFiles.clear();
    expect(
      isRoomInputSendSessionStalled(
        session,
        [successUpload(first), errorUpload(second)],
        [first, second]
      )
    ).toBe(false);
  });
});

type SentEvent = { event: string; id: string | undefined; more: boolean | undefined };

/**
 * Sends what the session can send now, as the controller does, and returns each event that went
 * out with its marker. A file in `failing` fails to send.
 */
const sendWhatCanGo = (
  session: RoomInputSendSessionState,
  uploads: Upload[],
  activeFiles: File[],
  failing: Set<File> = new Set()
): SentEvent[] => {
  const sent: SentEvent[] = [];
  for (;;) {
    const step = resolveRoomInputSendStep(session, uploads, activeFiles);
    if (step.kind === 'wait' || step.kind === 'complete') return sent;
    const sending = step.kind === 'send-upload' ? step.file : undefined;
    const marker = getSubmissionMarker(session, uploads, activeFiles, sending);
    if (step.kind === 'send-text') {
      session.textPending = false;
    } else if (failing.has(step.file)) {
      if (step.isRoot) session.blockedRoot = true;
      else session.failedFiles.add(step.file);
      continue;
    } else {
      session.sentFiles.add(step.file);
      if (step.isRoot) session.rootEventId = `$${step.file.name}`;
    }
    sent.push({ event: sending?.name ?? 'text', id: marker?.id, more: marker?.more });
  }
};

const marked = (session: RoomInputSendSessionState, event: string, more: boolean) => ({
  event,
  id: session.submissionId,
  more,
});

describe('getSubmissionMarker', () => {
  it('marks the files of a captioned send as followed and the caption as the last event', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const session = createRoomInputSendSessionState({ files: [first, second], hasText: true });

    expect(session.submissionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      sendWhatCanGo(session, [successUpload(first), successUpload(second)], [first, second])
    ).toEqual([
      marked(session, 'first.png', true),
      marked(session, 'second.png', true),
      marked(session, 'text', false),
    ]);
  });

  it('sends nothing while another file still uploads, then marks the last file as the end', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const session = createRoomInputSendSessionState({ files: [first, second], hasText: false });

    expect(
      sendWhatCanGo(session, [successUpload(first), loadingUpload(second)], [first, second])
    ).toEqual([]);
    expect(
      sendWhatCanGo(session, [successUpload(first), successUpload(second)], [first, second])
    ).toEqual([marked(session, 'first.png', true), marked(session, 'second.png', false)]);
  });

  it('marks the files and caption sent once a failed upload has settled the rest', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const third = createFile('third.png');
    const session = createRoomInputSendSessionState({
      files: [first, second, third],
      hasText: true,
      threadId: '$thread',
    });
    const files = [first, second, third];

    expect(
      sendWhatCanGo(
        session,
        [successUpload(first), errorUpload(second), loadingUpload(third)],
        files
      )
    ).toEqual([]);
    expect(
      sendWhatCanGo(
        session,
        [successUpload(first), errorUpload(second), successUpload(third)],
        files
      )
    ).toEqual([
      marked(session, 'first.png', true),
      marked(session, 'third.png', true),
      marked(session, 'text', false),
    ]);
    // The retried file comes after the caption and ends the submission again.
    expect(
      sendWhatCanGo(
        session,
        [successUpload(first), successUpload(second), successUpload(third)],
        files
      )
    ).toEqual([marked(session, 'second.png', false)]);
  });

  it('marks a lone file as the end of its submission', () => {
    const file = createFile('file.png');
    const session = createRoomInputSendSessionState({ files: [file], hasText: false });

    expect(sendWhatCanGo(session, [successUpload(file)], [file])).toEqual([
      marked(session, 'file.png', false),
    ]);
  });

  it('leaves a text sent without attachments unmarked', () => {
    const session = createRoomInputSendSessionState({ files: [], hasText: true });

    expect(sendWhatCanGo(session, [], [])).toEqual([
      { event: 'text', id: undefined, more: undefined },
    ]);
  });

  it('does not count a file that waits for a retry as one more to come', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const third = createFile('third.png');
    const session = createRoomInputSendSessionState({
      files: [first, second, third],
      hasText: false,
    });

    // The second upload failed; the third goes on without it and ends the submission.
    expect(
      sendWhatCanGo(
        session,
        [successUpload(first), errorUpload(second), successUpload(third)],
        [first, second, third]
      )
    ).toEqual([marked(session, 'first.png', true), marked(session, 'third.png', false)]);
  });

  it('ends a submission with the caption when a later file fails to send', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const session = createRoomInputSendSessionState({ files: [first, second], hasText: true });

    expect(
      sendWhatCanGo(
        session,
        [successUpload(first), successUpload(second)],
        [first, second],
        new Set([second])
      )
    ).toEqual([marked(session, 'first.png', true), marked(session, 'text', false)]);
  });

  it('sends the caption as the end while the root waits to be sent again, and the root after it', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const session = createRoomInputSendSessionState({ files: [first, second], hasText: true });
    const uploads = [successUpload(first), successUpload(second)];

    expect(sendWhatCanGo(session, uploads, [first, second], new Set([first]))).toEqual([
      marked(session, 'text', false),
    ]);

    // Send again: the root goes with the file after it, which ends the submission once more.
    session.blockedRoot = false;
    expect(sendWhatCanGo(session, uploads, [first, second])).toEqual([
      marked(session, 'first.png', true),
      marked(session, 'second.png', false),
    ]);
  });

  it('marks a file sent again after the caption as the end of its submission', () => {
    const first = createFile('first.png');
    const second = createFile('second.png');
    const session = createRoomInputSendSessionState({
      files: [first, second],
      hasText: true,
      threadId: '$thread',
    });
    const uploads = [successUpload(first), successUpload(second)];

    expect(sendWhatCanGo(session, uploads, [first, second], new Set([first]))).toEqual([
      marked(session, 'second.png', true),
      marked(session, 'text', false),
    ]);

    session.failedFiles.clear();
    expect(sendWhatCanGo(session, uploads, [first, second])).toEqual([
      marked(session, 'first.png', false),
    ]);
  });

  it('gives each submission its own id', () => {
    const file = createFile('file.png');

    expect(createRoomInputSendSessionState({ files: [file], hasText: true }).submissionId).not.toBe(
      createRoomInputSendSessionState({ files: [file], hasText: true }).submissionId
    );
  });
});
