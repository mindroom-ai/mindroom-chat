// @vitest-environment jsdom
import { useEffect, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { atom, createStore, Provider, useAtomValue, useSetAtom } from 'jotai';
import { afterEach, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { liveVoiceRecordingAtom, voiceAccountGuard } from '../composer/voice/liveVoiceRecording';
import type { VoiceCaptureSession } from '../composer/voice/voiceCaptureSession';
import { createVoiceSendDraftController } from '../composer/voice/voiceSendDraftController';
import { pendingVoiceSendDraftAtom, watchComposerAccount } from '../composer/roomInputDrafts';
import { putSession, removeSession, SESSION_STORE_KEY } from '../matrix/session/sessions';
import { ClientBindAtoms } from './ClientBindAtoms';
import { useBindAtoms } from './useBindAtoms';

const client = { accountValue: 'account-b' };

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('./useBindAtoms', () => ({ useBindAtoms: vi.fn() }));

const accountValueAtom = atom('account-a');

/** A binding seeds its atom in a passive effect, as the real ones do. */
const useSeedAccount = (current: typeof client) => {
  const setAccountValue = useSetAtom(accountValueAtom);
  useEffect(() => {
    setAccountValue(current.accountValue);
  }, [current, setAccountValue]);
};

function Page() {
  return <p>{useAtomValue(accountValueAtom)}</p>;
}

/** Reads the page once the task that committed the first render is over: the browser paints then. */
function FirstFrame({ container, seen }: { container: HTMLElement; seen: string[] }) {
  useLayoutEffect(() => {
    queueMicrotask(() => seen.push(container.textContent ?? ''));
  }, [container, seen]);
  return null;
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  localStorage.removeItem(SESSION_STORE_KEY);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = undefined;
});

it('shows the seeded pages in the first frame, never an empty one', async () => {
  vi.mocked(useBindAtoms).mockImplementation(useSeedAccount as never);
  const container = document.createElement('div');
  const seen: string[] = [];
  root = createRoot(container);

  // A start renders from a resolved promise, not inside act or a discrete event.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  root.render(
    <Provider store={createStore()}>
      <FirstFrame container={container} seen={seen} />
      <ClientBindAtoms>
        <Page />
      </ClientBindAtoms>
    </Provider>
  );
  await vi.waitFor(() => expect(seen).toHaveLength(1));

  expect(seen).toEqual(['account-b']);
});

it('keeps a recording and an accepted send across a same-account shell remount', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const store = createStore();
  const session = putSession({
    baseUrl: 'https://example.org',
    userId: '@example:example.org',
    deviceId: 'A',
    accessToken: 'a',
  });
  const shell = createRoot(document.createElement('div'));
  root = shell;
  const renderShell = (shown: boolean) =>
    act(() => {
      shell.render(
        <Provider store={store}>{shown && <ClientBindAtoms>Room</ClientBindAtoms>}</Provider>
      );
    });
  const reset = vi.fn();
  const recording = { reset } as unknown as VoiceCaptureSession;
  renderShell(true);
  store.set(liveVoiceRecordingAtom, recording);
  renderShell(false);
  renderShell(true);
  expect(store.get(liveVoiceRecordingAtom)).toBe(recording);
  expect(reset).not.toHaveBeenCalled();

  store.set(liveVoiceRecordingAtom, undefined);
  const send = createVoiceSendDraftController({
    read: () => store.get(pendingVoiceSendDraftAtom),
    write: (draft) => store.set(pendingVoiceSendDraftAtom, draft),
  });
  let fail!: (error: Error) => void;
  const delivery = new Promise<void>((_resolve, reject) => {
    fail = reject;
  });
  const file = new File(['example'], 'example.ogg', { type: 'audio/ogg' });
  const roomId = '!room:example.org';
  const sending = send.sendInitial(
    { file, duration: 1000, waveform: undefined },
    {
      ownerSessionId: session.userId,
      roomId,
      room: { roomId } as Room,
      threadId: undefined,
      replyDraft: undefined,
      threadingEnabled: true,
      signalBridgedRoom: false,
    },
    { sendRecording: () => delivery, onFailure: vi.fn(), sameAccount: voiceAccountGuard(store) }
  );
  renderShell(false);
  renderShell(true);
  fail(new Error('Example send failure'));
  expect(await sending).toBe(false);
  expect(store.get(pendingVoiceSendDraftAtom)?.file).toBe(file);
});

it.each(['switch', 'logout'])('tears down recording on a real account %s off the shell', (exit) => {
  const store = createStore();
  const session = putSession({
    baseUrl: 'https://example.org',
    userId: '@example:example.org',
    deviceId: 'A',
    accessToken: 'a',
  });
  const stop = watchComposerAccount(store);
  try {
    const reset = vi.fn();
    store.set(liveVoiceRecordingAtom, { reset } as unknown as VoiceCaptureSession);
    const sameAccount = voiceAccountGuard(store);
    if (exit === 'logout') removeSession(session.sessionId);
    else putSession({ ...session, userId: '@other:example.org' });
    expect(store.get(liveVoiceRecordingAtom)).toBeUndefined();
    expect(reset).toHaveBeenCalledOnce();
    expect(sameAccount()).toBe(false);
  } finally {
    stop();
  }
});
