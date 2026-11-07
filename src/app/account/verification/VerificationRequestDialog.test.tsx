// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type ShowSasCallbacks,
  type VerificationRequest,
  type Verifier,
} from 'matrix-js-sdk/lib/crypto-api';
import {
  ACCEPT_STALL_MS,
  VerificationRequestDialog,
  cancelPendingVerification,
} from './VerificationRequestDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const client = vi.hoisted(() => ({
  getUserId: () => '@alice:example.org',
  getCrypto: () => ({
    getUserDeviceInfo: async () =>
      new Map([['@alice:example.org', new Map([['PHONE', { displayName: 'Alice phone' }]])]]),
  }),
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../../ui/styles/ContainerColor.css', () => ({ ContainerColor: () => 'container' }));

type FakeVerifier = Verifier & { emitter: EventEmitter; verify: ReturnType<typeof vi.fn> };

const fakeVerifier = (sas: ShowSasCallbacks | null = null): FakeVerifier => {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    emitter,
    hasBeenCancelled: false,
    userId: '@alice:example.org',
    verify: vi.fn(() => new Promise<void>(() => undefined)),
    cancel: vi.fn(),
    getShowSasCallbacks: () => sas,
    getReciprocateQrCodeCallbacks: () => null,
  }) as unknown as FakeVerifier;
};

type FakeRequest = VerificationRequest & {
  set: (changes: Partial<Record<string, unknown>>) => void;
  accept: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  startVerification: ReturnType<typeof vi.fn>;
};

const fakeRequest = (initial: Record<string, unknown>): FakeRequest => {
  const emitter = new EventEmitter();
  const state: Record<string, unknown> = {
    phase: VerificationPhase.Requested,
    initiatedByMe: false,
    pending: true,
    accepting: false,
    declining: false,
    verifier: undefined,
    otherUserId: '@alice:example.org',
    otherDeviceId: 'PHONE',
    ...initial,
  };
  const request = emitter as unknown as FakeRequest;
  Object.keys(state).forEach((name) =>
    Object.defineProperty(request, name, { get: () => state[name], configurable: true })
  );
  request.set = (changes) => {
    Object.assign(state, changes);
    emitter.emit(VerificationRequestEvent.Change);
  };
  request.accept = vi.fn(async () => undefined);
  request.cancel = vi.fn(async () => undefined);
  request.startVerification = vi.fn(async () => fakeVerifier());
  return request;
};

let container: HTMLDivElement;
let root: Root;

const render = async (request: VerificationRequest, onClose = vi.fn()) => {
  await act(async () => {
    root.render(<VerificationRequestDialog request={request} onClose={onClose} />);
  });
  return onClose;
};

const button = (name: string) =>
  [...container.querySelectorAll('button')].find(
    (element) => element.textContent === name || element.getAttribute('aria-label') === name
  );

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('VerificationRequestDialog', () => {
  it('names the session that asked and accepts an incoming request', async () => {
    const request = fakeRequest({});
    await render(request);

    expect(container.textContent).toContain('Alice phone');
    expect(container.textContent).toContain('PHONE');
    expect(container.textContent).toContain('Click accept to start the verification process.');
    await act(async () => button('Accept')?.click());
    expect(request.accept).toHaveBeenCalledTimes(1);
  });

  // Regression (P2-e2ee-F010): Accept spun for good when the request never became ready.
  it('says so and offers to close when Accept gets no answer', async () => {
    vi.useFakeTimers();
    try {
      const request = fakeRequest({});
      request.accept = vi.fn(() => new Promise<void>(() => undefined));
      const onClose = await render(request);
      await act(async () => button('Accept')?.click());
      expect(request.accept).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(ACCEPT_STALL_MS - 1);
      });
      expect(container.textContent).not.toContain('did not answer');
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(container.textContent).toContain('did not answer');
      await act(async () => button('Close')?.click());
      expect(onClose).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for the other session on a request it sent', async () => {
    await render(fakeRequest({ initiatedByMe: true }));
    expect(container.textContent).toContain('Please accept the request from other device.');
    expect(button('Accept')).toBeUndefined();
  });

  it('starts the emoji comparison once when its own request becomes ready', async () => {
    const request = fakeRequest({ initiatedByMe: true });
    await render(request);
    await act(async () => request.set({ phase: VerificationPhase.Ready }));
    await act(async () => request.set({ phase: VerificationPhase.Ready }));

    expect(request.startVerification).toHaveBeenCalledTimes(1);
    expect(request.startVerification).toHaveBeenCalledWith('m.sas.v1');
  });

  it('leaves the start to the requester when it accepted the request', async () => {
    const request = fakeRequest({ phase: VerificationPhase.Ready });
    await render(request);
    expect(request.startVerification).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Verification request has been accepted.');
  });

  it('runs the verifier once and shows the emoji it reports', async () => {
    const verifier = fakeVerifier();
    const request = fakeRequest({ phase: VerificationPhase.Started, verifier });
    await render(request);
    expect(verifier.verify).toHaveBeenCalledTimes(1);

    const confirm = vi.fn(async () => undefined);
    const mismatch = vi.fn();
    const sas = {
      sas: {
        emoji: [
          ['🐶', 'Dog'],
          ['🐱', 'Cat'],
          ['🐶', 'Dog'],
          ['🔑', 'Key'],
          ['🎅', 'Santa'],
          ['🎸', 'Guitar'],
          ['🌍', 'Globe'],
        ],
      },
      confirm,
      mismatch,
      cancel: vi.fn(),
    } as unknown as ShowSasCallbacks;
    await act(async () => verifier.emitter.emit(VerifierEvent.ShowSas, sas));

    const cells = [...container.querySelectorAll('[role="listitem"]')];
    expect(cells.map((cell) => cell.getAttribute('aria-label'))).toEqual([
      'Dog',
      'Cat',
      'Dog',
      'Key',
      'Santa',
      'Guitar',
      'Globe',
    ]);
    await act(async () => button('They Match')?.click());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Waiting for the response from other device...');

    // A remount (the dialog reopened) must not run the same verifier again.
    act(() => root.unmount());
    root = createRoot(container);
    await render(request);
    expect(verifier.verify).toHaveBeenCalledTimes(1);
  });

  it('sends a mismatch when the emoji differ', async () => {
    const mismatch = vi.fn();
    const verifier = fakeVerifier({
      sas: { emoji: [['🐶', 'Dog']] },
      confirm: vi.fn(),
      mismatch,
      cancel: vi.fn(),
    } as unknown as ShowSasCallbacks);
    await render(fakeRequest({ phase: VerificationPhase.Started, verifier }));
    await act(async () => button('Do not Match')?.click());
    expect(mismatch).toHaveBeenCalledTimes(1);
  });

  it('reports the outcome and cancels only a request still in flight on close', async () => {
    const request = fakeRequest({});
    const onClose = await render(request);
    await act(async () => button('Close')?.click());
    expect(request.cancel).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => request.set({ phase: VerificationPhase.Done, pending: false }));
    expect(container.textContent).toContain('Your device is verified.');
    await act(async () => button('Okay')?.click());
    expect(request.cancel).toHaveBeenCalledTimes(1);

    await act(async () => request.set({ phase: VerificationPhase.Cancelled }));
    expect(container.textContent).toContain('Verification has been canceled.');
  });

  it('cancelPendingVerification leaves a finished request alone', () => {
    const done = fakeRequest({ phase: VerificationPhase.Done, pending: false });
    cancelPendingVerification(done);
    expect(done.cancel).not.toHaveBeenCalled();
  });
});
