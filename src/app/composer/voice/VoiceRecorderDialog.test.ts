import React, { createRef, useState } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Room } from 'matrix-js-sdk';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecorderComposer, VoiceRecorderComposerHandle } from './VoiceRecorderDialog';
import type { SendRecordingCallback } from './voiceSendDraftController';
import {
  discardedVoiceDraftsAtom,
  pendingVoiceSendDraftAtom,
  queuedVoiceDraftsAtom,
  type PendingVoiceSendContext,
} from '../roomInputDrafts';

// Whether the disk takes the recorder's writes: what the journal does with them is in
// voiceRecordingJournal.test.ts.
const disk = vi.hoisted(() => ({ writes: true }));
vi.mock('./voiceRecordingJournal', () => ({
  voiceCaptureJournal: () => ({
    begin: async () => disk.writes,
    append: async () => disk.writes,
    abandon: () => undefined,
  }),
  transitionVoiceRecording: async () => (disk.writes ? 'committed' : 'absent'),
}));

const TEST_ROOM_ID = '!room:example.org';
/** A send the server acknowledged with an event ID. */
const acknowledged = () => vi.fn<SendRecordingCallback>(async () => '$voice');

const createTestSendContext = (): PendingVoiceSendContext => ({
  ownerSessionId: '@me:example.org',
  roomId: TEST_ROOM_ID,
  room: { roomId: TEST_ROOM_ID, name: TEST_ROOM_ID } as unknown as Room,
  threadId: undefined,
  replyDraft: undefined,
  threadingEnabled: true,
  signalBridgedRoom: false,
});

const renderInProvider = (element: React.ReactElement) =>
  React.createElement(Provider, { store: createStore() }, element);

type Listener = (event: Event) => void;

class MockMediaStreamTrack {
  stop = vi.fn();
}

class MockMediaStream {
  track = new MockMediaStreamTrack();

  getTracks() {
    return [this.track];
  }
}

class MockMediaRecorder {
  static isTypeSupported = vi.fn(() => true);

  static latest: MockMediaRecorder | undefined;

  state: RecordingState = 'inactive';

  mimeType = 'audio/ogg;codecs=opus';

  private listeners = new Map<string, Set<Listener>>();

  constructor() {
    MockMediaRecorder.latest = this;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return;
    const fn =
      typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event);
    const current = this.listeners.get(type) ?? new Set<Listener>();
    current.add(fn);
    this.listeners.set(type, current);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.listeners.get('dataavailable')?.forEach((listener) =>
      listener({
        data: new Blob(['voice'], { type: this.mimeType }),
      } as BlobEvent)
    );
    this.listeners.get('stop')?.forEach((listener) => listener(new Event('stop')));
  }
}

const setupSupportedRecorder = () => {
  vi.stubGlobal('window', {
    isSecureContext: true,
  });
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(async () => new MockMediaStream()),
    },
  });
  vi.stubGlobal('MediaRecorder', MockMediaRecorder);
};

vi.mock('folds', () => {
  const Wrapper = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children);
  const Button = React.forwardRef<
    HTMLButtonElement,
    { children?: React.ReactNode; onClick?: () => void }
  >(({ children, onClick, ...props }, ref) =>
    React.createElement('button', { ...props, onClick, ref }, children)
  );

  return {
    Box: Wrapper,
    Button,
    Dialog: Wrapper,
    Icon: (props: Record<string, unknown>) => React.createElement('span', props),
    IconButton: Button,
    Icons: new Proxy(
      {},
      {
        get: (_target, key) => String(key),
      }
    ),
    Line: Wrapper,
    Overlay: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
      open ? React.createElement('div', null, children) : null,
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
    Spinner: (props: Record<string, unknown>) => React.createElement('span', props),
    Text: Wrapper,
    // Icon buttons name themselves in tooltips; render only the trigger.
    Tooltip: () => null,
    TooltipProvider: ({ children }: { children: (triggerRef: () => void) => React.ReactNode }) =>
      children(() => undefined),
    config: {
      space: new Proxy(
        {},
        {
          get: () => '0px',
        }
      ),
    },
  };
});

// FocusTrap from focus-trap-react needs DOM focus management that
// react-test-renderer doesn't provide. The real library: (a) snapshots the
// `onDeactivate` callback at first mount and invokes it on every trap
// teardown (including unmount), and (b) calls `clickOutsideDeactivates` and
// `escapeDeactivates` per-event during event handling. Model BOTH so tests
// can distinguish user-defer intent (predicates) from teardown
// (onDeactivate) — that distinction is the load-bearing assumption of
// VoiceRecorderDialog's defer-dismissal feature.
type FocusTrapOptionsCapture = {
  onDeactivate?: () => void;
  clickOutsideDeactivates?: ((event: MouseEvent) => boolean) | boolean;
  escapeDeactivates?: ((event: KeyboardEvent) => boolean) | boolean;
};
const focusTrapState: {
  // Always reflects the options of the most recently mounted trap.
  latest?: FocusTrapOptionsCapture;
} = {};
vi.mock('focus-trap-react', () => {
  const FocusTrapMock: React.FC<{
    children: React.ReactNode;
    focusTrapOptions?: FocusTrapOptionsCapture;
  }> = ({ children, focusTrapOptions }) => {
    // Snapshot at mount, just like the real library.
    const initialOptionsRef = React.useRef(focusTrapOptions);
    focusTrapState.latest = focusTrapOptions;
    React.useEffect(
      () => () => {
        // Unmount fires the SNAPSHOT-time onDeactivate, matching the real
        // focus-trap-react closure-capture semantics. Tests rely on this
        // to verify that VoiceRecorderDialog does not depend on
        // onDeactivate for defer intent.
        initialOptionsRef.current?.onDeactivate?.();
      },
      []
    );
    return React.createElement('div', null, children);
  };
  return { default: FocusTrapMock };
});

vi.mock('./VoiceRecordingCapsule.css', () => ({
  Capsule: 'Capsule',
  HiddenStatus: 'HiddenStatus',
  Label: 'Label',
  Timer: 'Timer',
  WaveformSlot: 'WaveformSlot',
}));

vi.mock('../../messages/content/voice/VoiceWaveform.css', () => ({
  Bar: 'Bar',
  BarActive: 'BarActive',
  BarCompact: 'BarCompact',
  BarCompactUnrecorded: 'BarCompactUnrecorded',
  CompactLine: 'CompactLine',
  Svg: 'Svg',
  SvgCompact: 'SvgCompact',
  Waveform: 'Waveform',
  WaveformCompact: 'WaveformCompact',
  WaveformDimmed: 'WaveformDimmed',
  WaveformSeek: 'WaveformSeek',
}));

vi.mock('../../lib/dom', () => ({
  pauseAllMediaElements: vi.fn(),
}));

function OverviewHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return React.createElement('div', null, 'closed');
  }

  return React.createElement(VoiceRecorderComposer, {
    active: open,
    onClose: () => {
      onClose();
      setOpen(false);
    },
    onRetryRequest: vi.fn(),
    onSendRecording: acknowledged(),
    getSendContext: createTestSendContext,
  });
}

describe('VoiceRecorderComposer', () => {
  beforeEach(() => {
    disk.writes = true;
    vi.stubGlobal('window', {
      isSecureContext: true,
    });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('MediaRecorder', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps an overview recorder error visible until the user dismisses it', async () => {
    const onClose = vi.fn();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(renderInProvider(React.createElement(OverviewHarness, { onClose })));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('Voice Recording Error');
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'Voice recording is not supported in this browser.'
    );

    const okButton = renderer.root
      .findAllByType('button')
      .find((button) => button.props.children === 'OK');
    expect(okButton).toBeTruthy();

    await act(async () => {
      okButton?.props.onClick();
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer.toJSON())).toContain('closed');

    renderer.unmount();
  });

  it('shows retry-first upload failure controls and keeps the capsule mounted', async () => {
    setupSupportedRecorder();
    const onClose = vi.fn();
    const onRetryRequest = vi.fn();
    const onSendRecording = acknowledged().mockRejectedValueOnce(new Error('upload failed'));
    const recorderRef = createRef<VoiceRecorderComposerHandle>();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        renderInProvider(
          React.createElement(VoiceRecorderComposer, {
            ref: recorderRef,
            active: true,
            onClose,
            onRetryRequest,
            onSendRecording,
            getSendContext: createTestSendContext,
          })
        )
      );
    });

    await act(async () => {
      await recorderRef.current?.send();
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('Voice send failed');
    expect(rendered).toContain('upload failed');
    expect(rendered).toContain('Your recording is still saved.');
    expect(rendered).toContain('Retry');
    expect(rendered).toContain('Discard');
    expect(
      renderer.root.findAllByProps({ 'aria-label': 'Retry sending voice recording' })
    ).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();

    const retryButton = renderer.root
      .findAllByType('button')
      .find((button) => button.props.children === 'Retry');
    await act(async () => {
      retryButton?.props.onClick();
    });
    expect(onRetryRequest).toHaveBeenCalledOnce();
    expect(onSendRecording).toHaveBeenCalledOnce();

    renderer.unmount();
  });

  it('does not call a recording saved that the disk does not hold', async () => {
    setupSupportedRecorder();
    disk.writes = false;
    const recorderRef = createRef<VoiceRecorderComposerHandle>();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        renderInProvider(
          React.createElement(VoiceRecorderComposer, {
            ref: recorderRef,
            active: true,
            onClose: vi.fn(),
            onRetryRequest: vi.fn(),
            // The disk never took it, so it goes from memory, and that fails.
            onSendRecording: async (_file, _duration, _waveform, context, attempt) => {
              await attempt.commit(context);
              throw new Error('upload failed');
            },
            getSendContext: createTestSendContext,
          })
        )
      );
    });
    // While it records, the capsule says so.
    expect(JSON.stringify(renderer.toJSON())).toContain('Not protected against a crash ·');

    await act(async () => {
      await recorderRef.current?.send();
    });
    // And so do the failure dialog and the capsule of the parked recording.
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('Voice send failed');
    expect(rendered).not.toContain('Your recording is still saved.');
    expect(rendered.split('Not protected against a crash')).toHaveLength(3);

    renderer.unmount();
  });

  it('discards a pending failed recording at once, and offers Undo for it', async () => {
    setupSupportedRecorder();
    const store = createStore();
    const onClose = vi.fn();
    const onSendRecording = acknowledged().mockRejectedValueOnce(new Error('upload failed'));
    const recorderRef = createRef<VoiceRecorderComposerHandle>();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(VoiceRecorderComposer, {
            ref: recorderRef,
            active: true,
            onClose,
            onRetryRequest: vi.fn(),
            onSendRecording,
            getSendContext: createTestSendContext,
          })
        )
      );
    });

    await act(async () => {
      await recorderRef.current?.send();
    });
    const parked = store.get(pendingVoiceSendDraftAtom);
    expect(parked?.errorMessage).toBe('upload failed');

    const discard = renderer.root
      .findAllByType('button')
      .find((button) => button.props.children === 'Discard');
    await act(async () => {
      discard?.props.onClick();
    });

    // Nothing asks whether it is sure: the discard can be undone.
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Discard voice recording?');
    expect(onClose).toHaveBeenCalledOnce();
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    expect(store.get(discardedVoiceDraftsAtom).map((entry) => entry.draft)).toEqual([parked]);

    renderer.unmount();
  });

  it('defers (hides) the failure overlay on backdrop click without discarding the draft', async () => {
    // rev-H Issue 6 (R3) + R4 MAJOR: the defer signal must come from the
    // per-event clickOutsideDeactivates predicate, not from the trap's
    // onDeactivate (which fires on every teardown including Retry/Discard).
    setupSupportedRecorder();
    const onClose = vi.fn();
    const onSendRecording = acknowledged().mockRejectedValueOnce(new Error('upload failed'));
    const recorderRef = createRef<VoiceRecorderComposerHandle>();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        renderInProvider(
          React.createElement(VoiceRecorderComposer, {
            ref: recorderRef,
            active: true,
            onClose,
            onRetryRequest: vi.fn(),
            onSendRecording,
            getSendContext: createTestSendContext,
          })
        )
      );
    });

    await act(async () => {
      await recorderRef.current?.send();
    });

    // Failure overlay is open and FocusTrap captured its predicate.
    expect(JSON.stringify(renderer.toJSON())).toContain('Voice send failed');
    const clickOutside = focusTrapState.latest?.clickOutsideDeactivates;
    expect(clickOutside).toBeTypeOf('function');

    // Simulate user clicking the backdrop.
    let returned: boolean | undefined;
    await act(async () => {
      if (typeof clickOutside === 'function') {
        returned = clickOutside({} as MouseEvent);
      }
    });
    expect(returned).toBe(true);

    const afterDefer = JSON.stringify(renderer.toJSON());
    // Overlay hidden but capsule still visible — draft is preserved.
    expect(afterDefer).not.toContain('Voice send failed');
    expect(afterDefer).toContain('Capsule');
    expect(onClose).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('re-shows the failure overlay when an explicit Retry fails again with the same message', async () => {
    // R4 MAJOR (rev-B Issue 1, rev-G Issue 1): if the user has previously
    // deferred and then explicitly Retries from the capsule, a same-message
    // failure must re-surface the overlay rather than getting silently hidden
    // by stale defer state. beginRetry() clears deferredErrorMessage before
    // calling retry().
    setupSupportedRecorder();
    const message = 'upload failed';
    const onSendRecording = acknowledged()
      .mockRejectedValueOnce(new Error(message))
      .mockRejectedValueOnce(new Error(message));
    const recorderRef = createRef<VoiceRecorderComposerHandle>();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        renderInProvider(
          React.createElement(VoiceRecorderComposer, {
            ref: recorderRef,
            active: true,
            onClose: vi.fn(),
            onRetryRequest: vi.fn(),
            onSendRecording,
            getSendContext: createTestSendContext,
          })
        )
      );
    });

    await act(async () => {
      await recorderRef.current?.send();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('Voice send failed');

    // User defers via backdrop click predicate.
    const clickOutside = focusTrapState.latest?.clickOutsideDeactivates;
    await act(async () => {
      if (typeof clickOutside === 'function') {
        clickOutside({} as MouseEvent);
      }
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Voice send failed');

    // User clicks primary composer Send again.
    await act(async () => {
      await recorderRef.current?.send();
    });

    // Same-message failure must re-surface the overlay.
    expect(JSON.stringify(renderer.toJSON())).toContain('Voice send failed');
    expect(onSendRecording).toHaveBeenCalledTimes(2);

    renderer.unmount();
  });

  it('names a recording without a destination and sends it where Send is pressed', async () => {
    const store = createStore();
    store.set(pendingVoiceSendDraftAtom, {
      recordingId: 'rec-recovered',
      file: new File(['voice'], 'voice.webm', { type: 'audio/webm' }),
      duration: 272_000,
      context: { ownerSessionId: '@me:example.org' },
    });
    const onClose = vi.fn();
    const onSendRecording = acknowledged();
    const recorderRef = createRef<VoiceRecorderComposerHandle>();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(VoiceRecorderComposer, {
            ref: recorderRef,
            active: false,
            onClose,
            onRetryRequest: vi.fn(),
            onSendRecording,
            getSendContext: createTestSendContext,
          })
        )
      );
    });

    // No failure to report: the capsule says what it is, with its length.
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('Recovered recording ·');
    expect(rendered).toContain('4:32');
    expect(rendered).not.toContain('Voice send failed');

    await act(async () => {
      await recorderRef.current?.send();
    });
    expect(onSendRecording).toHaveBeenCalledExactlyOnceWith(
      expect.any(File),
      272_000,
      undefined,
      expect.objectContaining({ roomId: TEST_ROOM_ID, ownerSessionId: '@me:example.org' }),
      { txnId: expect.any(String), commit: expect.any(Function) }
    );
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    expect(onClose).toHaveBeenCalledOnce();

    renderer.unmount();
  });

  it('says a recording may already be sent elsewhere, and sends it here only as a copy', async () => {
    const store = createStore();
    store.set(pendingVoiceSendDraftAtom, {
      recordingId: 'rec-attempted',
      file: new File(['voice'], 'voice.webm', { type: 'audio/webm' }),
      duration: 5_000,
      context: { ownerSessionId: '@me:example.org' },
      txnId: 'txn-attempted',
      attemptedRoomName: 'Harbour office',
    });
    const onClose = vi.fn();
    const onSendRecording = acknowledged();
    const recorderRef = createRef<VoiceRecorderComposerHandle>();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(VoiceRecorderComposer, {
            ref: recorderRef,
            active: false,
            onClose,
            onRetryRequest: vi.fn(),
            onSendRecording,
            getSendContext: createTestSendContext,
          })
        )
      );
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('May already be sent to Harbour office ·');

    // The composer's Send does not send it a second time.
    await act(async () => {
      expect(await recorderRef.current?.send()).toBe(false);
    });
    expect(onSendRecording).not.toHaveBeenCalled();

    const copy = renderer.root
      .findAllByType('button')
      .find((button) => button.findAll((node) => node.children.includes('Send a copy here'))[0]);
    await act(async () => {
      copy?.props.onClick();
    });
    expect(onSendRecording).toHaveBeenCalledExactlyOnceWith(
      expect.any(File),
      5_000,
      undefined,
      expect.objectContaining({ roomId: TEST_ROOM_ID }),
      { txnId: expect.stringMatching(/^mindroom-voice-/), commit: expect.any(Function) }
    );
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    expect(onClose).toHaveBeenCalledOnce();

    // A room whose name is not known is "another room".
    store.set(pendingVoiceSendDraftAtom, {
      recordingId: 'rec-unknown',
      file: new File(['voice'], 'voice.webm', { type: 'audio/webm' }),
      duration: 5_000,
      context: { ownerSessionId: '@me:example.org' },
      txnId: 'txn-unknown',
    });
    await act(async () => undefined);
    expect(JSON.stringify(renderer.toJSON())).toContain('May already be sent to another room ·');

    renderer.unmount();
  });

  it('closes when its recorder stops by itself, leaving the audio to wait for the slot', async () => {
    setupSupportedRecorder();
    const store = createStore();
    const onClose = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(VoiceRecorderComposer, {
            active: true,
            onClose,
            onRetryRequest: vi.fn(),
            onSendRecording: acknowledged(),
            getSendContext: createTestSendContext,
          })
        )
      );
    });
    await act(async () => {
      MockMediaRecorder.latest!.stop();
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(store.get(queuedVoiceDraftsAtom)).toMatchObject([
      { context: { ownerSessionId: '@me:example.org' } },
    ]);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Voice Recording Error');

    renderer.unmount();
  });
});
