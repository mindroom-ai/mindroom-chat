import { EventStatus, MatrixError, type IContent } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../matrix/matrix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/matrix')>()),
  encryptFile: vi.fn(async (file: File) => ({
    encInfo: { key: { k: 'secret' }, iv: 'iv', hashes: { sha256: 'h' }, v: 'v2' },
    file: new File([file], file.name, { type: 'application/octet-stream' }),
    originalFile: file,
  })),
}));

vi.mock('../matrix/send/msgContent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/send/msgContent')>()),
  getImageMsgContent: vi.fn(async (_mx: unknown, item: { originalFile: File }, mxc: string) => ({
    msgtype: 'm.image',
    body: item.originalFile.name,
    url: mxc,
  })),
}));

vi.mock('../matrix/send/longTextSidecarUpload', () => ({
  uploadLongTextSidecar: vi.fn(async () => ({ msgtype: 'm.file', body: 'sidecar preview' })),
}));

import { encryptFile } from '../matrix/matrix';
import { buildLongTextPreview } from '../matrix/protocol/longText';
import { getMessageRelation } from '../matrix/send/composeMessageRelation';
import { uploadLongTextSidecar } from '../matrix/send/longTextSidecarUpload';
import { getImageMsgContent } from '../matrix/send/msgContent';
import { buildPerTagEventContent, buildPerTagStateKey } from '../event-store/threads/threadTags';
import { CaptureError, sendCapture, sendCaptureReply, setCaptureResolved } from './sendCapture';

const ROOM_ID = '!notes:example.org';
const USER_ID = '@me:example.org';
/** The local echo the client keeps of a message the server did not take. */
const unsentEcho = (txnId: string) => ({ txnId, status: EventStatus.NOT_SENT });
const plainRoom = {
  roomId: ROOM_ID,
  hasEncryptionStateEvent: () => false,
  getEventForTxnId: vi.fn(unsentEcho),
};
const encryptedRoom = { roomId: ROOM_ID, hasEncryptionStateEvent: () => true };
const markdown = { markdown: true };

/** A client that logs when each upload finishes and each message is sent. */
const client = () => {
  const log: string[] = [];
  let sent = 0;
  let txns = 0;
  return {
    log,
    getUserId: vi.fn(() => USER_ID),
    getSafeUserId: vi.fn(() => USER_ID),
    makeTxnId: vi.fn(() => {
      txns += 1;
      return `txn${txns}`;
    }),
    cancelPendingEvent: vi.fn(),
    uploadContent: vi.fn(async (file: File, _options?: unknown) => {
      await Promise.resolve();
      log.push(`uploaded ${file.name}`);
      return { content_uri: `mxc://example.org/${file.name}` };
    }),
    sendMessage: vi.fn(async (_roomId: string, content: IContent, _txnId?: string) => {
      log.push(`sent ${String(content.body)}`);
      sent += 1;
      return { event_id: `$event${sent}` };
    }),
    sendStateEvent: vi.fn(async (..._args: unknown[]) => ({ event_id: '$state' })),
  };
};

/** The failed message `call` sent leaves no unsent copy in the room. */
const expectUnsentCopyDropped = (mx: ReturnType<typeof client>, call: number) => {
  const txnId = mx.sendMessage.mock.calls[call]?.[2];
  expect(txnId).toEqual(expect.any(String));
  expect(plainRoom.getEventForTxnId).toHaveBeenCalledWith(txnId);
  expect(mx.cancelPendingEvent).toHaveBeenCalledTimes(1);
  expect(mx.cancelPendingEvent).toHaveBeenCalledWith(unsentEcho(txnId ?? ''));
};

const png = (name: string) => new File(['picture'], name, { type: 'image/png' });

/** The error `promise` rejects with. */
const failure = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject.');
};

const expectCaptureError = async (promise: Promise<unknown>, code: string) => {
  const error = await failure(promise);
  expect(error).toBeInstanceOf(CaptureError);
  expect((error as CaptureError).code).toBe(code);
};

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('sendCapture', () => {
  it('posts text alone as a new thread root', async () => {
    const mx = client();
    const result = await sendCapture(
      mx as never,
      plainRoom as never,
      { text: 'Buy milk', images: [] },
      markdown
    );

    expect(result).toEqual({ threadId: '$event1' });
    expect(mx.sendMessage).toHaveBeenCalledTimes(1);
    const [roomId, content] = mx.sendMessage.mock.calls[0] ?? [];
    expect(roomId).toBe(ROOM_ID);
    expect(content).toMatchObject({ msgtype: 'm.text', body: 'Buy milk' });
    expect(content).not.toHaveProperty('m.relates_to');
  });

  it('formats Markdown only when asked to', async () => {
    const formatted = client();
    await sendCapture(
      formatted as never,
      plainRoom as never,
      { text: 'a **bold** move', images: [] },
      markdown
    );
    expect(formatted.sendMessage.mock.calls[0]?.[1].formatted_body).toContain('<strong');

    const plain = client();
    await sendCapture(
      plain as never,
      plainRoom as never,
      { text: 'a **bold** move', images: [] },
      { markdown: false }
    );
    expect(plain.sendMessage.mock.calls[0]?.[1]).not.toHaveProperty('formatted_body');
  });

  it('keeps the line break between two lines', async () => {
    const mx = client();
    await sendCapture(
      mx as never,
      plainRoom as never,
      { text: 'first\nsecond', images: [] },
      markdown
    );
    expect(mx.sendMessage.mock.calls[0]?.[1].body).toBe('first\nsecond');
  });

  it('uploads every image first, then posts the first as the root and the rest and the text in its thread', async () => {
    const mx = client();
    const result = await sendCapture(
      mx as never,
      plainRoom as never,
      { text: 'Look at these', images: [png('a.png'), png('b.png')] },
      markdown
    );

    expect(result).toEqual({ threadId: '$event1' });
    expect(mx.log).toEqual([
      'uploaded a.png',
      'uploaded b.png',
      'sent a.png',
      'sent b.png',
      'sent Look at these',
    ]);
    expect(mx.uploadContent).toHaveBeenCalledWith(expect.any(File), {
      name: 'a.png',
      type: 'image/png',
      includeFilename: true,
    });
    const relation = getMessageRelation(undefined, undefined, '$event1');
    const [root, second, text] = mx.sendMessage.mock.calls.map(([, content]) => content);
    expect(root).toEqual({ msgtype: 'm.image', body: 'a.png', url: 'mxc://example.org/a.png' });
    expect(second).toEqual({
      msgtype: 'm.image',
      body: 'b.png',
      url: 'mxc://example.org/b.png',
      'm.relates_to': relation,
    });
    expect(text).toMatchObject({
      msgtype: 'm.text',
      body: 'Look at these',
      'm.relates_to': relation,
    });
    expect(mx.sendMessage.mock.calls.map(([, , txnId]) => txnId)).toEqual(['txn1', 'txn2', 'txn3']);
    expect(mx.cancelPendingEvent).not.toHaveBeenCalled();
  });

  it('posts only the images when the text is blank', async () => {
    const mx = client();
    const result = await sendCapture(
      mx as never,
      plainRoom as never,
      { text: '  \n ', images: [png('a.png')] },
      markdown
    );

    expect(result).toEqual({ threadId: '$event1' });
    expect(mx.log).toEqual(['uploaded a.png', 'sent a.png']);
  });

  it('sends nothing when an upload fails', async () => {
    const mx = client();
    mx.uploadContent.mockRejectedValueOnce(new Error('offline'));

    await expectCaptureError(
      sendCapture(
        mx as never,
        plainRoom as never,
        { text: 'hi', images: [png('a.png'), png('b.png')] },
        markdown
      ),
      'upload-failed'
    );
    expect(mx.sendMessage).not.toHaveBeenCalled();
  });

  it('sends nothing when an upload returns no content URI', async () => {
    const mx = client();
    mx.uploadContent.mockResolvedValueOnce({ content_uri: '' });

    await expectCaptureError(
      sendCapture(
        mx as never,
        plainRoom as never,
        { text: 'hi', images: [png('a.png')] },
        markdown
      ),
      'upload-failed'
    );
    expect(mx.sendMessage).not.toHaveBeenCalled();
  });

  it('sends nothing when an image cannot be prepared for upload', async () => {
    const mx = client();
    vi.mocked(encryptFile).mockRejectedValueOnce(new Error('no crypto'));

    await expectCaptureError(
      sendCapture(
        mx as never,
        encryptedRoom as never,
        { text: 'hi', images: [png('a.png'), png('b.png')] },
        markdown
      ),
      'upload-failed'
    );
    expect(mx.uploadContent).not.toHaveBeenCalled();
    expect(mx.sendMessage).not.toHaveBeenCalled();
  });

  it('uploads encrypted bytes without their name or type in an encrypted room', async () => {
    const mx = client();
    await sendCapture(
      mx as never,
      encryptedRoom as never,
      { text: '', images: [png('a.png')] },
      markdown
    );

    const [file, options] = mx.uploadContent.mock.calls[0] ?? [];
    expect(file?.type).toBe('application/octet-stream');
    expect(options).toEqual({
      name: 'a.png',
      type: 'application/octet-stream',
      includeFilename: false,
    });
    expect(vi.mocked(getImageMsgContent).mock.calls[0]?.[1].encInfo).toBeDefined();
  });

  it('fails as send-failed when the server refuses the message, leaving no unsent copy', async () => {
    const mx = client();
    mx.sendMessage.mockRejectedValueOnce(new MatrixError({ errcode: 'M_FORBIDDEN' }, 403));

    await expectCaptureError(
      sendCapture(mx as never, plainRoom as never, { text: 'hi', images: [] }, markdown),
      'send-failed'
    );
    expectUnsentCopyDropped(mx, 0);
  });

  it('stops at a message in the thread that fails, leaving no unsent copy of it', async () => {
    const mx = client();
    mx.sendMessage
      .mockResolvedValueOnce({ event_id: '$root' })
      .mockRejectedValueOnce(new Error('offline'));

    await expectCaptureError(
      sendCapture(
        mx as never,
        plainRoom as never,
        { text: 'Look at these', images: [png('a.png'), png('b.png')] },
        markdown
      ),
      'send-failed'
    );
    expect(mx.sendMessage).toHaveBeenCalledTimes(2);
    expectUnsentCopyDropped(mx, 1);
  });

  it('fails as send-failed with neither text nor images, sending nothing', async () => {
    const mx = client();
    await expectCaptureError(
      sendCapture(mx as never, plainRoom as never, { text: '   ', images: [] }, markdown),
      'send-failed'
    );
    expect(mx.sendMessage).not.toHaveBeenCalled();
  });

  it('sends text too large for one event as a long-text sidecar', async () => {
    const mx = client();
    const text = 'a'.repeat(50_000);
    await sendCapture(mx as never, plainRoom as never, { text, images: [] }, markdown);

    expect(uploadLongTextSidecar).toHaveBeenCalledTimes(1);
    const [, room, content, preview] = vi.mocked(uploadLongTextSidecar).mock.calls[0] ?? [];
    expect(room).toBe(plainRoom);
    expect(content).toMatchObject({ msgtype: 'm.text', body: text });
    expect(preview).toEqual(buildLongTextPreview(content ?? {}));
    expect(mx.sendMessage).toHaveBeenCalledTimes(1);
    expect(mx.sendMessage.mock.calls[0]?.[1]).toEqual({
      msgtype: 'm.file',
      body: 'sidecar preview',
    });
  });

  it('fails as send-failed when the long-text sidecar cannot be uploaded', async () => {
    const mx = client();
    vi.mocked(uploadLongTextSidecar).mockRejectedValueOnce(new Error('offline'));

    await expectCaptureError(
      sendCapture(
        mx as never,
        plainRoom as never,
        { text: 'a'.repeat(50_000), images: [] },
        markdown
      ),
      'send-failed'
    );
    expect(mx.sendMessage).not.toHaveBeenCalled();
  });
});

describe('sendCaptureReply', () => {
  it('posts the text in the thread', async () => {
    const mx = client();
    await sendCaptureReply(mx as never, plainRoom as never, '$root', 'On it', markdown);

    expect(mx.sendMessage).toHaveBeenCalledTimes(1);
    const [roomId, content] = mx.sendMessage.mock.calls[0] ?? [];
    expect(roomId).toBe(ROOM_ID);
    expect(content).toMatchObject({
      msgtype: 'm.text',
      body: 'On it',
      'm.relates_to': getMessageRelation(undefined, undefined, '$root'),
    });
  });

  it('sends nothing for blank text', async () => {
    const mx = client();
    await sendCaptureReply(mx as never, plainRoom as never, '$root', ' \n ', markdown);
    expect(mx.sendMessage).not.toHaveBeenCalled();
  });

  it('fails as send-failed when the message is not sent, leaving no unsent copy', async () => {
    const mx = client();
    mx.sendMessage.mockRejectedValueOnce(new Error('offline'));
    await expectCaptureError(
      sendCaptureReply(mx as never, plainRoom as never, '$root', 'On it', markdown),
      'send-failed'
    );
    expectUnsentCopyDropped(mx, 0);
  });
});

describe('setCaptureResolved', () => {
  it('sets the resolved tag on the thread', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T10:00:00.000Z'));
    const mx = client();
    await setCaptureResolved(mx as never, plainRoom as never, '$root', true);

    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      ROOM_ID,
      'com.mindroom.thread.tags',
      buildPerTagEventContent(USER_ID),
      buildPerTagStateKey('$root', 'resolved')
    );
  });

  it('clears the resolved tag with empty content under the same key', async () => {
    const mx = client();
    await setCaptureResolved(mx as never, plainRoom as never, '$root', false);

    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      ROOM_ID,
      'com.mindroom.thread.tags',
      {},
      buildPerTagStateKey('$root', 'resolved')
    );
  });

  it('fails as forbidden without the permission, and as send-failed otherwise', async () => {
    const mx = client();
    mx.sendStateEvent.mockRejectedValueOnce(new MatrixError({ errcode: 'M_FORBIDDEN' }, 403));
    await expectCaptureError(
      setCaptureResolved(mx as never, plainRoom as never, '$root', true),
      'forbidden'
    );

    mx.sendStateEvent.mockRejectedValueOnce(new MatrixError({ errcode: 'M_UNKNOWN' }, 500));
    await expectCaptureError(
      setCaptureResolved(mx as never, plainRoom as never, '$root', false),
      'send-failed'
    );
  });
});
