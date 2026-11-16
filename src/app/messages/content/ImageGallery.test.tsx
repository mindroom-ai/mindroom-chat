// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode, useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageGallery } from './ImageGallery';
import { ImageSlidesContext, type ImageSlide } from './imageSlides';

const downloads = vi.hoisted(() => ({
  calls: [] as {
    source: { mxcUri: string; owner?: unknown; encryptedFile?: unknown; mimeType?: string };
    resolve: (blob: Blob) => void;
    reject: (error: Error) => void;
  }[],
}));

vi.mock('../../event-store/cache/attachmentRepository', () => ({
  downloadCachedAttachment: (_mx: unknown, source: (typeof downloads.calls)[number]['source']) =>
    new Promise<Blob>((resolve, reject) => {
      downloads.calls.push({ source, resolve, reject });
    }),
}));
const client = vi.hoisted(() => ({}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../../matrix/matrix', () => ({ downloadMedia: async () => new Blob(['picture']) }));
vi.mock('../../native/nativeFileSave', () => ({ saveFile: async () => true }));
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const ROOM = '!room:example.org';
const FILE = {
  url: 'mxc://example.org/$c',
  key: { alg: 'A256CTR', ext: true, k: 'key', key_ops: ['encrypt', 'decrypt'], kty: 'oct' },
  iv: 'iv',
  hashes: { sha256: 'hash' },
  v: 'v2',
};

const slide = (eventId: string, encrypted = false): ImageSlide => ({
  eventId,
  body: `${eventId.slice(1)}.png`,
  url: `mxc://example.org/${eventId}`,
  mimeType: 'image/png',
  info: {},
  encInfo: encrypted ? FILE : undefined,
  owner: { roomId: ROOM, eventId, revisionTs: 1 },
});

const A = slide('$a');
const B = slide('$b');
const C = slide('$c', true);

const requestClose = vi.fn();

/** A conversation's pictures, with the viewer opened on `origin` until it asks to close. */
function Conversation({ slides, origin }: { slides?: ImageSlide[]; origin: ImageSlide }) {
  const [open, setOpen] = useState(true);
  const getSlides = useCallback(() => slides ?? [], [slides]);
  const close = () => {
    requestClose();
    setOpen(false);
  };
  const gallery = open && <ImageGallery slide={origin} requestClose={close} />;
  return slides ? (
    <ImageSlidesContext.Provider value={getSlides}>{gallery}</ImageSlidesContext.Provider>
  ) : (
    <>{gallery}</>
  );
}

/** Finishes the newest download of `mxcUri`, or fails it. */
const finish = async (mxcUri: string, fail = false) => {
  const call = downloads.calls.filter((entry) => entry.source.mxcUri === mxcUri).at(-1);
  if (!call) throw new Error(`no download of ${mxcUri}`);
  await act(async () => {
    if (fail) call.reject(new Error('offline'));
    else call.resolve(new Blob([mxcUri]));
  });
};

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...init }));
  });

const shown = () => screen.queryByRole('img')?.getAttribute('src');

beforeEach(() => {
  downloads.calls = [];
  requestClose.mockReset();
  let next = 0;
  URL.createObjectURL = vi.fn(() => {
    next += 1;
    return `blob:${next}`;
  });
  URL.revokeObjectURL = vi.fn();
});

afterEach(cleanup);

describe('ImageGallery', () => {
  it('opens on the picture clicked, loading its original, with its place among the others', async () => {
    render(<Conversation slides={[A, B, C]} origin={B} />);

    expect(screen.getByText('2 / 3')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'b.png' })).toBeTruthy();
    expect(downloads.calls.map((call) => call.source.mxcUri)).toEqual([B.url]);
    expect(downloads.calls[0]?.source).toMatchObject({ owner: B.owner, mimeType: 'image/png' });

    await finish(B.url);
    expect(shown()).toBe('blob:1');
  });

  it('steps with ArrowRight to the next picture, loading it with its own owner and file', async () => {
    render(<Conversation slides={[A, B, C]} origin={B} />);
    await finish(B.url);

    press('ArrowRight');
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'c.png' })).toBeTruthy();
    expect(downloads.calls.at(-1)?.source).toEqual({
      owner: C.owner,
      mxcUri: C.url,
      encryptedFile: { ...FILE, url: C.url },
      mimeType: 'image/png',
    });
    // The previous picture's blob goes as the next one starts loading.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    expect(shown()).toBeUndefined();

    await finish(C.url);
    expect(shown()).toBe('blob:2');
  });

  it('stops at the ends', () => {
    render(<Conversation slides={[A, B, C]} origin={C} />);
    press('ArrowRight');
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(downloads.calls).toHaveLength(1);

    press('ArrowLeft');
    press('ArrowLeft');
    press('ArrowLeft');
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(downloads.calls.map((call) => call.source.mxcUri)).toEqual([C.url, B.url, A.url]);
  });

  it('ignores the arrow keys with a modifier', () => {
    render(<Conversation slides={[A, B, C]} origin={A} />);
    press('ArrowRight', { shiftKey: true });
    press('ArrowRight', { metaKey: true });
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(downloads.calls).toHaveLength(1);
  });

  it('holds one history entry however far it steps, and Back closes it from any picture', () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    const back = vi.spyOn(window.history, 'back');
    render(<Conversation slides={[A, B, C]} origin={A} />);
    press('ArrowRight');
    press('ArrowRight');
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(pushState).toHaveBeenCalledOnce();

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(requestClose).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(back).not.toHaveBeenCalled();
    pushState.mockRestore();
    back.mockRestore();
  });

  it('stays open on a picture that failed to load, and Retry loads it again', async () => {
    render(<Conversation slides={[A, B]} origin={A} />);
    await finish(A.url, true);

    expect(screen.getByText('Failed to load image!')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(requestClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(downloads.calls.map((call) => call.source.mxcUri)).toEqual([A.url, A.url]);
    await finish(A.url);
    expect(shown()).toBe('blob:1');
  });

  it('ignores a picture that loads after the viewer stepped away from it', async () => {
    render(<Conversation slides={[A, B]} origin={A} />);
    press('ArrowRight');
    await finish(B.url);
    expect(shown()).toBe('blob:1');

    await finish(A.url);
    expect(shown()).toBe('blob:1');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:2');
  });

  it('closes when the picture it shows leaves the conversation', () => {
    const { rerender } = render(<Conversation slides={[A, B]} origin={A} />);
    press('ArrowRight');
    rerender(<Conversation slides={[A]} origin={A} />);
    expect(requestClose).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows only its own picture outside a conversation, without a counter or arrows', async () => {
    render(<Conversation origin={B} />);
    await finish(B.url);
    expect(shown()).toBe('blob:1');
    expect(screen.queryByText(/\d \/ \d/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next image' })).toBeNull();
    press('ArrowRight');
    expect(downloads.calls).toHaveLength(1);
  });

  it('revokes the shown blob when it closes', async () => {
    render(<Conversation slides={[A]} origin={A} />);
    await finish(A.url);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  });
});
