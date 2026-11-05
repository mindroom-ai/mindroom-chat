// @vitest-environment jsdom

import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { AsyncState, AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import { getAudioContentSourceIdentity, useAudioContentSource } from './useAudioContentSource';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Download = { resolve: (blob: Blob) => void; reject: (error: unknown) => void };

const mocks = vi.hoisted(() => ({
  client: { name: 'Alice client' },
  downloads: [] as Download[],
  downloadCachedAttachment: vi.fn(),
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => mocks.client,
}));

vi.mock('../../event-store/cache/attachmentRepository', () => ({
  downloadCachedAttachment: mocks.downloadCachedAttachment,
}));

type Source = Parameters<typeof useAudioContentSource>[0];

type Probe = {
  /** The hook's state in every render, oldest first. */
  states: AsyncState<string>[];
  load: () => Promise<string>;
};

function AudioProbe({ source, probe }: { source: Source; probe: Probe }) {
  const [state, load] = useAudioContentSource(source);
  probe.states.push(state);
  probe.load = load;
  return null;
}

type Outcome = { value: string } | { error: unknown };

/** Attaches a handler at once, so a rejection the test awaits later is never unhandled. */
const settle = (request: Promise<string>): Promise<Outcome> =>
  request.then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  );

const replaced = { error: new Error('AudioContentSource: Request replaced!') };

const download = (index: number): Download => {
  const entry = mocks.downloads[index];
  if (!entry) throw new Error(`Download ${index} never started`);
  return entry;
};

const owner: EventAttachmentOwner = {
  roomId: '!voice:example.org',
  eventId: '$voice-a',
  revisionTs: 1_000,
};

const encInfo: EncryptedAttachmentInfo = {
  v: 'v2',
  key: { alg: 'A256CTR', ext: true, key_ops: ['encrypt', 'decrypt'], kty: 'oct', k: 'key-a' },
  iv: 'iv-a',
  hashes: { sha256: 'sha-a' },
};

const voiceA: Source = { mimeType: 'audio/ogg', url: 'mxc://example.org/voice-a', owner };
const voiceB: Source = {
  mimeType: 'audio/ogg',
  url: 'mxc://example.org/voice-b',
  owner: { ...owner, eventId: '$voice-b' },
};

const idle: AsyncState<string> = { status: AsyncStatus.Idle };
const loading: AsyncState<string> = { status: AsyncStatus.Loading };
const success = (data: string): AsyncState<string> => ({ status: AsyncStatus.Success, data });

describe('useAudioContentSource', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let probe: Probe;
  let nextObjectUrl: number;
  const outstanding = new Set<string>();
  const createObjectURL = vi.fn();
  const revokeObjectURL = vi.fn();

  const show = (source: Source) => {
    act(() => {
      root.render(<AudioProbe source={source} probe={probe} />);
    });
  };
  const unmount = () => {
    act(() => {
      root.unmount();
    });
    mounted = false;
  };
  const latest = () => probe.states[probe.states.length - 1];
  const revocations = (objectUrl: string) =>
    revokeObjectURL.mock.calls.filter(([revoked]) => revoked === objectUrl).length;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mounted = true;
    probe = {
      states: [],
      load: () => Promise.reject(new Error('The probe has not rendered')),
    };
    mocks.downloads = [];
    mocks.downloadCachedAttachment.mockReset();
    mocks.downloadCachedAttachment.mockImplementation(
      () =>
        new Promise<Blob>((resolve, reject) => {
          mocks.downloads.push({ resolve, reject });
        })
    );
    outstanding.clear();
    nextObjectUrl = 0;
    createObjectURL.mockReset();
    createObjectURL.mockImplementation(() => {
      const objectUrl = `blob:audio-${nextObjectUrl}`;
      nextObjectUrl += 1;
      outstanding.add(objectUrl);
      return objectUrl;
    });
    revokeObjectURL.mockReset();
    revokeObjectURL.mockImplementation((objectUrl: string) => {
      outstanding.delete(objectUrl);
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    if (mounted) unmount();
    container.remove();
    vi.unstubAllGlobals();
  });

  it('downloads nothing until the load function runs', () => {
    show(voiceA);
    show({ ...voiceA });

    expect(mocks.downloadCachedAttachment).not.toHaveBeenCalled();
    expect(probe.states).toEqual([idle, idle]);
  });

  it('serves the download as a blob URL and resolves with it', async () => {
    show(voiceA);
    let request!: Promise<Outcome>;

    act(() => {
      request = settle(probe.load());
    });
    expect(latest()).toEqual(loading);

    await act(async () => {
      download(0).resolve(new Blob(['voice a'], { type: 'audio/ogg' }));
      await request;
    });

    await expect(request).resolves.toEqual({ value: 'blob:audio-0' });
    expect(latest()).toEqual(success('blob:audio-0'));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(outstanding).toEqual(new Set(['blob:audio-0']));
  });

  it('passes the owner, the media URI, the type and the encrypted file to the cache', () => {
    show({ ...voiceA, encInfo });
    act(() => {
      void settle(probe.load());
    });
    show(voiceB);
    act(() => {
      void settle(probe.load());
    });

    const [encrypted, plain] = mocks.downloadCachedAttachment.mock.calls;
    expect(encrypted).toEqual([
      mocks.client,
      {
        owner,
        mxcUri: 'mxc://example.org/voice-a',
        mimeType: 'audio/ogg',
        encryptedFile: { ...encInfo, url: 'mxc://example.org/voice-a' },
      },
    ]);
    expect(plain).toEqual([
      mocks.client,
      { owner: voiceB.owner, mxcUri: 'mxc://example.org/voice-b', mimeType: 'audio/ogg' },
    ]);
    expect(plain?.[1]).not.toHaveProperty('encryptedFile');
  });

  it('sets the error state with the thrown value and rejects with it', async () => {
    show(voiceA);
    const failure = new Error('Media server unreachable');
    let request!: Promise<Outcome>;

    act(() => {
      request = settle(probe.load());
    });
    await act(async () => {
      download(0).reject(failure);
      await request;
    });

    const outcome = await request;
    expect('error' in outcome ? outcome.error : undefined).toBe(failure);
    expect(latest()).toEqual({ status: AsyncStatus.Error, error: failure });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('drops a download that finishes after unmount', async () => {
    show(voiceA);
    let request!: Promise<Outcome>;

    act(() => {
      request = settle(probe.load());
    });
    const rendersBeforeUnmount = probe.states.length;
    unmount();

    await act(async () => {
      download(0).resolve(new Blob(['voice a'], { type: 'audio/ogg' }));
      await request;
    });

    expect(await request).toEqual(replaced);
    expect(probe.states).toHaveLength(rendersBeforeUnmount);
    expect(outstanding.size).toBe(0);
  });

  it('keeps a failure after unmount out of the state and rejects with it', async () => {
    show(voiceA);
    const failure = new Error('Decryption failed');
    let request!: Promise<Outcome>;

    act(() => {
      request = settle(probe.load());
    });
    unmount();
    await act(async () => {
      download(0).reject(failure);
      await request;
    });

    const outcome = await request;
    expect('error' in outcome ? outcome.error : undefined).toBe(failure);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('returns to idle in the first render of new media and drops the load in flight', async () => {
    show(voiceA);
    let request!: Promise<Outcome>;
    act(() => {
      request = settle(probe.load());
    });
    expect(latest()).toEqual(loading);

    const rendersBeforeChange = probe.states.length;
    show(voiceB);
    const statesOfVoiceB = probe.states.slice(rendersBeforeChange);
    expect(statesOfVoiceB.length).toBeGreaterThan(0);
    statesOfVoiceB.forEach((state) => expect(state).toEqual(idle));

    await act(async () => {
      download(0).resolve(new Blob(['voice a'], { type: 'audio/ogg' }));
      await request;
    });

    expect(await request).toEqual(replaced);
    expect(latest()).toEqual(idle);
    expect(outstanding.size).toBe(0);
  });

  it('revokes the shown URL exactly once when the media changes', async () => {
    show(voiceA);
    await act(async () => {
      const request = settle(probe.load());
      download(0).resolve(new Blob(['voice a'], { type: 'audio/ogg' }));
      await request;
    });
    expect(latest()).toEqual(success('blob:audio-0'));

    const rendersBeforeChange = probe.states.length;
    show(voiceB);

    probe.states.slice(rendersBeforeChange).forEach((state) => expect(state).toEqual(idle));
    expect(revocations('blob:audio-0')).toBe(1);
    expect(outstanding.size).toBe(0);
  });

  it('lets only the second of two loads in a row keep its URL', async () => {
    show(voiceA);
    let first!: Promise<Outcome>;
    let second!: Promise<Outcome>;

    act(() => {
      first = settle(probe.load());
    });
    act(() => {
      second = settle(probe.load());
    });
    // The second download finishes first; the first must not overwrite it.
    await act(async () => {
      download(1).resolve(new Blob(['voice a again'], { type: 'audio/ogg' }));
      await second;
    });
    await act(async () => {
      download(0).resolve(new Blob(['voice a'], { type: 'audio/ogg' }));
      await first;
    });

    expect(await first).toEqual(replaced);
    expect(await second).toEqual({ value: 'blob:audio-0' });
    expect(latest()).toEqual(success('blob:audio-0'));
    expect(outstanding).toEqual(new Set(['blob:audio-0']));
  });

  it('leaves a rendered URL to the state cleanup when a newer load starts', async () => {
    show(voiceA);
    await act(async () => {
      const request = settle(probe.load());
      download(0).resolve(new Blob(['voice a'], { type: 'audio/ogg' }));
      await request;
    });
    expect(latest()).toEqual(success('blob:audio-0'));

    let reload!: Promise<Outcome>;
    act(() => {
      reload = settle(probe.load());
    });
    expect(latest()).toEqual(loading);
    expect(revocations('blob:audio-0')).toBe(1);

    await act(async () => {
      download(1).resolve(new Blob(['voice a'], { type: 'audio/ogg' }));
      await reload;
    });

    expect(await reload).toEqual({ value: 'blob:audio-1' });
    expect(revocations('blob:audio-0')).toBe(1);
    expect(outstanding).toEqual(new Set(['blob:audio-1']));
  });

  it('ignores a load function kept from before a media change', async () => {
    show(voiceA);
    const loadVoiceA = probe.load;
    show(voiceB);

    let stale!: Promise<Outcome>;
    act(() => {
      stale = settle(loadVoiceA());
    });
    expect(await stale).toEqual(replaced);
    expect(latest()).toEqual(idle);
    expect(mocks.downloadCachedAttachment).not.toHaveBeenCalled();

    let current!: Promise<Outcome>;
    act(() => {
      current = settle(probe.load());
    });
    act(() => {
      stale = settle(loadVoiceA());
    });
    expect(await stale).toEqual(replaced);
    expect(latest()).toEqual(loading);

    await act(async () => {
      download(0).resolve(new Blob(['voice b'], { type: 'audio/ogg' }));
      await current;
    });

    expect(await current).toEqual({ value: 'blob:audio-0' });
    expect(latest()).toEqual(success('blob:audio-0'));
    expect(mocks.downloadCachedAttachment).toHaveBeenCalledOnce();
    expect(mocks.downloadCachedAttachment.mock.calls[0]?.[1]).toMatchObject({
      mxcUri: 'mxc://example.org/voice-b',
    });
  });
});

describe('getAudioContentSourceIdentity', () => {
  const encrypted: Source = { ...voiceA, encInfo };
  const identity = getAudioContentSourceIdentity(encrypted);

  it('is equal for equal sources given as new objects', () => {
    expect(
      getAudioContentSourceIdentity({
        mimeType: 'audio/ogg',
        url: 'mxc://example.org/voice-a',
        owner: { ...owner },
        encInfo: { ...encInfo, key: { ...encInfo.key }, hashes: { ...encInfo.hashes } },
      })
    ).toBe(identity);
  });

  it.each([
    ['the revision time', { ...encrypted, owner: { ...owner, revisionTs: 2_000 } }],
    ['the revision ID', { ...encrypted, owner: { ...owner, revisionId: '$edit' } }],
    ['the room', { ...encrypted, owner: { ...owner, roomId: '!other:example.org' } }],
    ['the event', { ...encrypted, owner: { ...owner, eventId: '$other' } }],
    ['the redaction', { ...encrypted, owner: { ...owner, redacted: true } }],
    ['the owner', { ...encrypted, owner: undefined }],
    ['the type', { ...encrypted, mimeType: 'audio/mpeg' }],
    ['the media URI', { ...encrypted, url: 'mxc://example.org/voice-b' }],
    ['the IV', { ...encrypted, encInfo: { ...encInfo, iv: 'iv-b' } }],
    ['the key', { ...encrypted, encInfo: { ...encInfo, key: { ...encInfo.key, k: 'key-b' } } }],
    ['the hash', { ...encrypted, encInfo: { ...encInfo, hashes: { sha256: 'sha-b' } } }],
    ['the version', { ...encrypted, encInfo: { ...encInfo, v: 'v1' } }],
    ['the encryption', { ...encrypted, encInfo: undefined }],
  ] satisfies [string, Source][])('changes with %s alone', (_part, changed) => {
    expect(getAudioContentSourceIdentity(changed)).not.toBe(identity);
  });

  it('ignores the key algorithm and key operations', () => {
    expect(
      getAudioContentSourceIdentity({
        ...encrypted,
        encInfo: { ...encInfo, key: { ...encInfo.key, alg: 'other', key_ops: ['decrypt'] } },
      })
    ).toBe(identity);
  });
});
