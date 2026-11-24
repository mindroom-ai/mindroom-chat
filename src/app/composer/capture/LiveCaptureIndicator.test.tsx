// @vitest-environment jsdom
import { useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { Overlay, OverlayBackdrop, OverlayCenter } from 'folds';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { ConversationViewContext, HOME_ASK_VIEW } from '../../navigation/conversationView';
import { phoneNavDrawerOpenAtom } from '../../navigation/phoneNavDrawer';
import { NoticeSlot } from '../../ui/noticeSlots';
import { BottomSheet } from '../../ui/BottomSheet';
import { Modal500 } from '../../ui/Modal500';
import { LogoutDialog } from '../../account/LogoutDialog';
import { CommandPaletteRenderer } from '../../command-palette/CommandPaletteRenderer';
import { commandPaletteOpenAtom } from '../../command-palette/commandPaletteState';
import type { PendingVoiceSendContext } from '../roomInputDrafts';
import type { DictationSession, DictationSnapshot } from '../dictation/dictationSession';
import { VoiceRecorderComposer } from '../voice/VoiceRecorderDialog';
import type { VoiceCaptureSession, VoiceCaptureSnapshot } from '../voice/voiceCaptureSession';
import { LiveCaptureIndicator } from './LiveCaptureIndicator';
import { liveCaptureAtom, liveCaptureErrorAtom } from './liveCapture';
import { useLiveCaptureCapsuleVisible } from './useLiveCaptureCapsuleVisible';

vi.unmock('../../ui/glass/GlassPrimitives');
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getCrypto: () => undefined,
    getUserId: () => '@me:example.org',
    getDeviceId: () => 'EXAMPLE',
  }),
}));

vi.mock('../../command-palette/commandPaletteItems', () => ({
  useCommandPaletteSource: () => ({
    actions: [],
    commands: [],
    rooms: [],
    threads: [],
    getUsers: () => [],
  }),
}));
vi.mock('../../command-palette/useCommandPaletteMessages', () => ({
  useCommandPaletteMessages: () => ({ status: 'idle', items: [] }),
}));
vi.mock('../../command-palette/useCommandPalettePeople', () => ({
  useCommandPalettePeople: () => ({ status: 'idle', items: [] }),
}));

/** A voice recording that is running, as the capture session reports it. */
const recordingSession = (changes: Partial<VoiceCaptureSnapshot> = {}) => {
  const snapshot: VoiceCaptureSnapshot = {
    phase: 'recording',
    elapsedMs: 32_000,
    waveform: [0, 512, 1024],
    sampleCount: 3,
    canPause: true,
    errorMessage: undefined,
    ...changes,
  };
  const discard = vi.fn<() => Promise<void>>(async () => undefined);
  const session = {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    canStop: () => true,
    discard,
  } as unknown as VoiceCaptureSession;
  return { entry: { kind: 'voice' as const, session }, session, discard };
};

/** A dictation session, including optional `recovered` snapshot flag for Task 2+. */
const dictationSession = (changes: Partial<DictationSnapshot & { recovered?: boolean }> = {}) => {
  const snapshot = {
    phase: 'recording' as const,
    elapsedMs: 45_000,
    waveform: [0, 256],
    sampleCount: 2,
    pendingUploads: 0,
    failedSegments: 0,
    completedSegments: 1,
    hasPartialText: true,
    previewText: 'Hello world',
    capReached: false,
    interrupted: false,
    errorMessage: undefined,
    ...changes,
  };
  const discard = vi.fn<() => Promise<void>>(async () => undefined);
  const session = {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    discard,
  } as unknown as DictationSession;
  return { entry: { kind: 'dictation' as const, session }, session, discard };
};

const ROOM_ID = '!example:example.org';
const sendContext = (): PendingVoiceSendContext => ({
  ownerSessionId: '@me:example.org',
  roomId: ROOM_ID,
  room: { roomId: ROOM_ID, name: 'Example room' } as unknown as Room,
  threadId: undefined,
  replyDraft: undefined,
  threadingEnabled: true,
  signalBridgedRoom: false,
});
const composer = () => (
  <VoiceRecorderComposer
    ownsPendingVoiceDraft={false}
    onRetryRequest={vi.fn()}
    onSendRecording={vi.fn()}
    getSendContext={sendContext}
  />
);
const voicePill = () => screen.queryByTestId('live-voice-recording-indicator');
const dictationPill = () => screen.queryByTestId('live-dictation-indicator');
const question = (name = 'Discard voice recording?') => screen.queryByRole('dialog', { name });
const press = (element: HTMLElement) => {
  fireEvent.pointerDown(element, { button: 0, pointerId: 1, pointerType: 'mouse' });
  fireEvent.mouseDown(element, { button: 0 });
  fireEvent.pointerUp(element, { button: 0, pointerId: 1, pointerType: 'mouse' });
  fireEvent.mouseUp(element, { button: 0 });
  fireEvent.click(element);
};
const openedQuestion = async (name = 'Discard voice recording?') => {
  await waitFor(() => expect(question(name)?.contains(document.activeElement)).toBe(true));
  return question(name)!;
};
const expectFocusOnCancel = async (name = 'Discard voice recording?') =>
  expect(within(await openedQuestion(name)).getByRole('button', { name: 'Cancel' })).toBe(
    document.activeElement
  );
const layOut = () =>
  vi
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockImplementation(function rects(this: HTMLElement) {
      return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
    });

function SettingsWithLogout() {
  const [confirming, setConfirming] = useState(false);
  const dismiss = () => setConfirming(false);
  return (
    <Modal500 requestClose={vi.fn()}>
      <h2>Settings</h2>
      <button type="button" onClick={() => setConfirming(true)}>
        Logout
      </button>
      {confirming && (
        <Overlay open backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            <FocusTrap focusTrapOptions={{ initialFocus: false, onDeactivate: dismiss }}>
              <LogoutDialog handleClose={dismiss} />
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}
    </Modal500>
  );
}

function VisibleCapsuleProbe({ showingLive }: { showingLive: boolean }) {
  useLiveCaptureCapsuleVisible(showingLive);
  return <div data-testid="capsule-probe" />;
}

describe('LiveCaptureIndicator', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows a voice recording and its time where no composer shows it, with confirmed Discard and no Send', async () => {
    layOut();
    const store = createStore();
    const { entry, discard } = recordingSession();
    render(
      <Provider store={store}>
        <NoticeSlot place="page" />
        <LiveCaptureIndicator />
      </Provider>
    );

    expect(voicePill()).toBeNull();
    expect(screen.queryByText('Voice Recording Error')).toBeNull();
    act(() => store.set(liveCaptureAtom, entry));
    expect(voicePill()?.textContent).toBe('Recording 0:32');
    expect(screen.queryByRole('button', { name: /send/i })).toBeNull();

    // Discard asks first, with the focus on Cancel; Escape and Cancel keep the recording.
    const discardButton = screen.getByRole('button', { name: 'Discard voice recording' });
    fireEvent.click(discardButton);
    await expectFocusOnCancel();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', keyCode: 27 });
    expect(question()).toBeNull();
    fireEvent.click(discardButton);
    fireEvent.click(within(question()!).getByRole('button', { name: 'Cancel' }));
    expect(question()).toBeNull();
    expect(discard).not.toHaveBeenCalled();
    expect(voicePill()?.textContent).toBe('Recording 0:32');

    // Confirmed, the recording ends at once. The question stays, busy, until the disk copy is gone.
    let removed!: () => void;
    discard.mockReturnValue(
      new Promise<void>((resolve) => {
        removed = resolve;
      })
    );
    fireEvent.click(discardButton);
    fireEvent.click(within(question()!).getByRole('button', { name: 'Discard' }));
    expect(discard).toHaveBeenCalledOnce();
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(voicePill()).toBeNull();
    await act(async () => undefined);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', keyCode: 27 });
    expect(question()).not.toBeNull();
    await act(async () => removed());
    expect(question()).toBeNull();
  });

  it('shows dictation states (requesting, recording, paused, recovered, finishing, failed) and confirms dictation discard', async () => {
    layOut();
    const store = createStore();
    const { entry, discard } = dictationSession({ phase: 'requesting', elapsedMs: 0 });
    render(
      <Provider store={store}>
        <NoticeSlot place="page" />
        <LiveCaptureIndicator />
      </Provider>
    );

    act(() => store.set(liveCaptureAtom, entry));
    expect(dictationPill()?.textContent).toBe('Starting dictation');
    expect(screen.getByRole('status').textContent).toBe('Starting dictation');

    act(() =>
      store.set(liveCaptureAtom, dictationSession({ phase: 'recording', elapsedMs: 45_000 }).entry)
    );
    expect(dictationPill()?.textContent).toBe('Dictating 0:45');
    expect(screen.getByRole('status').textContent).toBe('Dictating');

    act(() =>
      store.set(liveCaptureAtom, dictationSession({ phase: 'paused', elapsedMs: 45_000 }).entry)
    );
    expect(dictationPill()?.textContent).toBe('Dictation paused 0:45');
    expect(screen.getByRole('status').textContent).toBe('Dictation paused');

    act(() =>
      store.set(
        liveCaptureAtom,
        dictationSession({ phase: 'paused', recovered: true, elapsedMs: 65_000 }).entry
      )
    );
    expect(dictationPill()?.textContent).toBe('Recovered dictation 1:05');
    expect(screen.getByRole('status').textContent).toBe('Recovered dictation');

    act(() => store.set(liveCaptureAtom, dictationSession({ phase: 'finishing' }).entry));
    expect(dictationPill()?.textContent).toBe('Finishing dictation...');

    const failed = dictationSession({ phase: 'failed' });
    act(() => store.set(liveCaptureAtom, failed.entry));
    expect(dictationPill()?.textContent).toBe('Dictation needs attention');

    let removed!: () => void;
    failed.discard.mockReturnValue(
      new Promise<void>((resolve) => {
        removed = resolve;
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard dictation' }));
    await expectFocusOnCancel('Discard dictation?');
    fireEvent.click(
      within(question('Discard dictation?')!).getByRole('button', { name: 'Discard' })
    );
    expect(failed.discard).toHaveBeenCalledOnce();
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(dictationPill()).toBeNull();
    // Keeps dictation confirmation title while awaiting disk deletion.
    expect(question('Discard dictation?')).not.toBeNull();
    await act(async () => removed());
    expect(question('Discard dictation?')).toBeNull();
    expect(discard).not.toHaveBeenCalled();
  });

  it('treats HOME_ASK_VIEW as in sight unless the phone nav drawer covers it', () => {
    const store = createStore();
    store.set(liveCaptureAtom, dictationSession().entry);
    render(
      <Provider store={store}>
        <ConversationViewContext.Provider value={HOME_ASK_VIEW}>
          <VisibleCapsuleProbe showingLive />
        </ConversationViewContext.Provider>
        <NoticeSlot place="page" />
        <LiveCaptureIndicator />
      </Provider>
    );

    // Home ask capsule is in sight, so the shell floating pill stays hidden.
    expect(dictationPill()).toBeNull();

    // Opening the phone nav drawer covers Home ask, so the floating pill stands in.
    act(() => store.set(phoneNavDrawerOpenAtom, true));
    expect(dictationPill()?.textContent).toBe('Dictating 0:45');
    act(() => store.set(phoneNavDrawerOpenAtom, false));
    expect(dictationPill()).toBeNull();
  });

  it('says the voice recording is starting while the microphone is requested', () => {
    const store = createStore();
    store.set(liveCaptureAtom, recordingSession({ phase: 'requesting', elapsedMs: 0 }).entry);
    render(
      <Provider store={store}>
        <NoticeSlot place="page" />
        <LiveCaptureIndicator />
      </Provider>
    );
    expect(voicePill()?.textContent).toBe('Starting voice recording');
    expect(screen.getByRole('status').textContent).toBe('Starting voice recording');
  });

  it('has only its state read out, when it comes and when that changes, not its time', () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <NoticeSlot place="page" />
        <LiveCaptureIndicator />
      </Provider>
    );
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');

    act(() => store.set(liveCaptureAtom, recordingSession().entry));
    expect(status.textContent).toBe('Voice recording active');
    expect(voicePill()?.getAttribute('aria-live')).toBe('off');
    expect(voicePill()?.hasAttribute('aria-label')).toBe(false);
    expect(voicePill()?.contains(status)).toBe(false);

    act(() => store.set(liveCaptureAtom, recordingSession({ phase: 'paused' }).entry));
    expect(voicePill()?.textContent).toBe('Paused 0:32');
    expect(status.textContent).toBe('Voice recording paused');
    act(() => store.set(liveCaptureAtom, undefined));
    expect(status.textContent).toBe('');
  });

  it('announces recording state once for two capsules without announcing their timer ticks', () => {
    const store = createStore();
    store.set(liveCaptureAtom, recordingSession().entry);
    const { container } = render(
      <Provider store={store}>
        {composer()}
        {composer()}
        <LiveCaptureIndicator />
      </Provider>
    );
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Voice recording active');
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(0);
    expect(screen.getAllByText('0:32')).toHaveLength(2);

    act(() => store.set(liveCaptureAtom, recordingSession({ elapsedMs: 33_000 }).entry));
    expect(screen.getAllByText('0:33')).toHaveLength(2);
    expect(status.textContent).toBe('Voice recording active');
    act(() => store.set(liveCaptureAtom, recordingSession({ phase: 'paused' }).entry));
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('Voice recording paused');
    act(() => store.set(liveCaptureAtom, recordingSession().entry));
    expect(status.textContent).toBe('Voice recording active');
  });

  it('moves Discard into the log-out confirmation and back to Settings when it closes', async () => {
    layOut();
    const store = createStore();
    const { entry, discard } = recordingSession();
    store.set(liveCaptureAtom, entry);
    render(
      <Provider store={store}>
        <NoticeSlot place="page" />
        {composer()}
        <SettingsWithLogout />
        <LiveCaptureIndicator />
      </Provider>
    );
    const settings = screen.getByRole('dialog', { name: 'Settings' });
    const openLogout = async () => {
      await act(async () => {
        fireEvent.click(within(settings).getByRole('button', { name: 'Logout' }));
      });
    };
    const discardLabel = 'Discard voice recording';
    expect(settings.contains(voicePill())).toBe(true);

    await openLogout();
    const confirmation = screen.getByRole('dialog', { name: 'Logout' });
    expect(confirmation.contains(voicePill())).toBe(true);
    fireEvent.click(within(confirmation).getByText('Cancel'));
    expect(screen.queryByRole('dialog', { name: 'Logout' })).toBeNull();
    expect(settings.contains(voicePill())).toBe(true);

    await openLogout();
    const reopened = screen.getByRole('dialog', { name: 'Logout' });
    fireEvent.click(within(reopened).getByRole('button', { name: discardLabel }));
    await expectFocusOnCancel();
    expect(reopened.contains(voicePill())).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', keyCode: 27 });
    expect(question()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Logout' })).toBe(reopened);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBe(settings);
    expect(discard).not.toHaveBeenCalled();

    fireEvent.click(within(reopened).getByRole('button', { name: discardLabel }));
    press(within(question()!).getByRole('button', { name: 'Discard' }));
    expect(discard).toHaveBeenCalledOnce();
    expect(voicePill()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Logout' })).toBe(reopened);
  });

  it('shows inside what covers the page, where the focus held there reaches it', () => {
    const store = createStore();
    store.set(liveCaptureAtom, recordingSession().entry);
    const page = (phoneLayer?: 'drawer' | 'sheet') => (
      <Provider store={store}>
        <div data-testid="page">
          <NoticeSlot place="page" />
          {composer()}
        </div>
        {phoneLayer && (
          <div data-testid={phoneLayer}>
            <NoticeSlot place={phoneLayer} />
          </div>
        )}
        <LiveCaptureIndicator />
      </Provider>
    );
    const { rerender } = render(page());
    expect(voicePill()).toBeNull();

    rerender(page('drawer'));
    expect(screen.getByTestId('drawer').contains(voicePill())).toBe(true);
    expect(voicePill()?.hasAttribute('data-cover-notice')).toBe(true);
    rerender(page('sheet'));
    expect(screen.getByTestId('sheet').contains(voicePill())).toBe(true);
    rerender(page());
    expect(voicePill()).toBeNull();
  });

  it('lets you discard a live recording from a bottom sheet covering its composer', async () => {
    layOut();
    const requestClose = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const store = createStore();
    const { entry, discard } = recordingSession();
    store.set(liveCaptureAtom, entry);
    render(
      <Provider store={store}>
        <main>
          <NoticeSlot place="page" />
          {composer()}
        </main>
        <BottomSheet title="Activity" closeLabel="Close" requestClose={requestClose}>
          <p>Example activity</p>
        </BottomSheet>
        <LiveCaptureIndicator />
      </Provider>
    );

    const dialog = screen.getByRole('dialog', { name: 'Activity' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard voice recording' }));
    expect(discard).not.toHaveBeenCalled();
    await expectFocusOnCancel();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', keyCode: 27 });
    expect(question()).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard voice recording' }));
    press(within(question()!).getByRole('button', { name: 'Discard' }));
    expect(discard).toHaveBeenCalledOnce();
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(requestClose).not.toHaveBeenCalled();
  });

  it('reaches Discard by Tab from the command palette search field', () => {
    const store = createStore();
    store.set(liveCaptureAtom, recordingSession().entry);
    store.set(commandPaletteOpenAtom, 'all');
    render(
      <Provider store={store}>
        {composer()}
        <CommandPaletteRenderer />
        <LiveCaptureIndicator />
      </Provider>
    );
    const search = screen.getByRole('combobox', { name: 'Command palette' });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('tab', { name: 'Actions', selected: true })).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Tab' });
    const shell = screen.getByRole('dialog', { name: 'Command palette' }).parentElement!;
    expect(document.activeElement).toBe(
      within(shell).getByRole('button', { name: 'Discard voice recording' })
    );
    expect(store.get(commandPaletteOpenAtom)).toBe('all');
  });

  it('discards a live recording without closing the command palette', async () => {
    layOut();
    const store = createStore();
    const { entry, discard } = recordingSession();
    store.set(liveCaptureAtom, entry);
    store.set(commandPaletteOpenAtom, 'all');
    render(
      <Provider store={store}>
        <NoticeSlot place="page" />
        {composer()}
        <CommandPaletteRenderer />
        <LiveCaptureIndicator />
      </Provider>
    );

    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    const button = within(dialog.parentElement!).getByRole('button', {
      name: 'Discard voice recording',
    });
    press(button);
    expect(store.get(commandPaletteOpenAtom)).toBe('all');
    expect(discard).not.toHaveBeenCalled();
    await expectFocusOnCancel();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', keyCode: 27 });
    expect(question()).toBeNull();
    expect(store.get(commandPaletteOpenAtom)).toBe('all');
    press(button);
    press(within(question()!).getByRole('button', { name: 'Cancel' }));
    expect(question()).toBeNull();
    expect(store.get(commandPaletteOpenAtom)).toBe('all');

    press(button);
    press(within(question()!).getByRole('button', { name: 'Discard' }));
    expect(store.get(commandPaletteOpenAtom)).toBe('all');
    expect(discard).toHaveBeenCalledOnce();
    expect(voicePill()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBe(dialog);
  });

  it('stands down while a composer shows the capsule, and back up when it goes or is covered', () => {
    const store = createStore();
    store.set(liveCaptureAtom, recordingSession().entry);
    const page = (withComposer: boolean) => (
      <Provider store={store}>
        {withComposer && composer()}
        <NoticeSlot place="page" />
        <LiveCaptureIndicator />
      </Provider>
    );
    const { rerender } = render(page(true));
    expect(voicePill()).toBeNull();
    expect(screen.getAllByText('0:32')).toHaveLength(1);

    act(() => store.set(phoneNavDrawerOpenAtom, true));
    expect(voicePill()).not.toBeNull();
    act(() => store.set(phoneNavDrawerOpenAtom, false));
    expect(voicePill()).toBeNull();

    rerender(page(false));
    expect(voicePill()?.textContent).toBe('Recording 0:32');
    rerender(page(true));
    expect(voicePill()).toBeNull();
  });

  it('shows voice and dictation capture errors once and lets the user dismiss them', () => {
    layOut();
    const store = createStore();
    store.set(liveCaptureAtom, recordingSession().entry);
    render(
      <Provider store={store}>
        {composer()}
        {composer()}
        <NoticeSlot place="page" />
        <LiveCaptureIndicator />
      </Provider>
    );
    expect(screen.queryByText('Voice Recording Error')).toBeNull();

    act(() => {
      store.set(liveCaptureAtom, undefined);
      store.set(liveCaptureErrorAtom, {
        kind: 'voice',
        message: 'No audio data was captured.',
      });
    });

    expect(screen.getAllByText('Voice Recording Error')).toHaveLength(1);
    expect(screen.getAllByText('No audio data was captured.')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(store.get(liveCaptureErrorAtom)).toBeUndefined();
    expect(screen.queryByText('Voice Recording Error')).toBeNull();

    act(() => {
      store.set(liveCaptureErrorAtom, {
        kind: 'dictation',
        message: 'No microphone was found on this device.',
      });
    });
    expect(screen.getByText('Dictation Error')).toBeTruthy();
    expect(screen.getByText('No microphone was found on this device.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(store.get(liveCaptureErrorAtom)).toBeUndefined();
    expect(screen.queryByText('Dictation Error')).toBeNull();
  });

  it('lets you dismiss why a capture failed over an open bottom sheet', async () => {
    layOut();
    const requestClose = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const store = createStore();
    render(
      <Provider store={store}>
        <main>
          <NoticeSlot place="page" />
        </main>
        <BottomSheet title="Activity" closeLabel="Close" requestClose={requestClose}>
          <p>Example activity</p>
        </BottomSheet>
        <LiveCaptureIndicator />
      </Provider>
    );
    act(() =>
      store.set(liveCaptureErrorAtom, {
        kind: 'voice',
        message: 'No audio data was captured.',
      })
    );

    const ok = await screen.findByRole('button', { name: 'OK' });
    await waitFor(() => expect(ok).toBe(document.activeElement));
    press(ok);
    expect(store.get(liveCaptureErrorAtom)).toBeUndefined();
    expect(screen.queryByText('Voice Recording Error')).toBeNull();
    expect(requestClose).not.toHaveBeenCalled();
  });
});
