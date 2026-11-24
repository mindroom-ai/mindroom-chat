// @vitest-environment jsdom
import { useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { Overlay, OverlayBackdrop, OverlayCenter } from 'folds';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { phoneNavDrawerOpenAtom } from '../../navigation/phoneNavDrawer';
import { NoticeSlot } from '../../ui/noticeSlots';
import { BottomSheet } from '../../ui/BottomSheet';
import { Modal500 } from '../../ui/Modal500';
import { LogoutDialog } from '../../account/LogoutDialog';
import { CommandPaletteRenderer } from '../../command-palette/CommandPaletteRenderer';
import { commandPaletteOpenAtom } from '../../command-palette/commandPaletteState';
import type { PendingVoiceSendContext } from '../roomInputDrafts';
import { LiveVoiceRecordingIndicator } from './LiveVoiceRecordingIndicator';
import { liveVoiceRecordingAtom, liveVoiceRecordingErrorAtom } from './liveVoiceRecording';
import { VoiceRecorderComposer } from './VoiceRecorderDialog';
import type { VoiceCaptureSession, VoiceCaptureSnapshot } from './voiceCaptureSession';

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

/** A recording that is running, as the capture session reports it. */
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
  // Discard ends the recording at once, and deletes its disk copy.
  const discard = vi.fn<() => Promise<void>>(async () => undefined);
  const session = {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    canStop: () => true,
    discard,
  } as unknown as VoiceCaptureSession;
  return { session, discard };
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
const pill = () => screen.queryByTestId('live-voice-recording-indicator');
/** The question every Discard asks first. */
const question = () => screen.queryByRole('dialog', { name: 'Discard voice recording?' });
/** A whole press, as a pointer makes it: a dialog under it must not take it for a press outside. */
const press = (element: HTMLElement) => {
  fireEvent.pointerDown(element, { button: 0, pointerId: 1, pointerType: 'mouse' });
  fireEvent.mouseDown(element, { button: 0 });
  fireEvent.pointerUp(element, { button: 0, pointerId: 1, pointerType: 'mouse' });
  fireEvent.mouseUp(element, { button: 0 });
  fireEvent.click(element);
};
/** The question, once its focus trap has moved the focus in, shortly after it opens. */
const openedQuestion = async () => {
  await waitFor(() => expect(question()?.contains(document.activeElement)).toBe(true));
  return question()!;
};
const expectFocusOnCancel = async () =>
  expect(within(await openedQuestion()).getByRole('button', { name: 'Cancel' })).toBe(
    document.activeElement
  );
/** Treats attached elements as laid out, so the real focus trap finds its controls in jsdom. */
const layOut = () =>
  vi
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockImplementation(function rects(this: HTMLElement) {
      return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
    });

// As in Settings: the shared large dialog opens a separate, focus-trapped log-out prompt.
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

describe('LiveVoiceRecordingIndicator', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the recording and its time where no composer shows it, with Discard and no Send', async () => {
    layOut();
    const store = createStore();
    const { session, discard } = recordingSession();
    render(
      <Provider store={store}>
        <NoticeSlot place="page" />
        <LiveVoiceRecordingIndicator />
      </Provider>
    );

    expect(pill()).toBeNull();
    expect(screen.queryByText('Voice Recording Error')).toBeNull();
    act(() => store.set(liveVoiceRecordingAtom, session));
    expect(pill()?.textContent).toBe('Recording 0:32');
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
    expect(pill()?.textContent).toBe('Recording 0:32');

    // Confirmed, the recording ends at once. The question stays, busy, until the disk copy is
    // gone too: a reload cannot offer the discarded audio again.
    let removed!: () => void;
    discard.mockReturnValue(
      new Promise<void>((resolve) => {
        removed = resolve;
      })
    );
    fireEvent.click(discardButton);
    fireEvent.click(within(question()!).getByRole('button', { name: 'Discard' }));
    expect(discard).toHaveBeenCalledOnce();
    expect(store.get(liveVoiceRecordingAtom)).toBeUndefined();
    expect(pill()).toBeNull();
    await act(async () => undefined);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', keyCode: 27 });
    expect(question()).not.toBeNull();
    await act(async () => removed());
    expect(question()).toBeNull();
  });

  it('says the recording is starting while the microphone is requested', () => {
    const store = createStore();
    store.set(
      liveVoiceRecordingAtom,
      recordingSession({ phase: 'requesting', elapsedMs: 0 }).session
    );
    render(
      <Provider store={store}>
        <NoticeSlot place="page" />
        <LiveVoiceRecordingIndicator />
      </Provider>
    );
    expect(pill()?.textContent).toBe('Starting voice recording');
    expect(screen.getByRole('status').textContent).toBe('Starting voice recording');
  });

  it('has only its state read out, when it comes and when that changes, not its time', () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <NoticeSlot place="page" />
        <LiveVoiceRecordingIndicator />
      </Provider>
    );
    // The region is there before the pill, so what comes into it is read out.
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');

    act(() => store.set(liveVoiceRecordingAtom, recordingSession().session));
    expect(status.textContent).toBe('Voice recording active');
    // The pill, whose time changes every second, keeps out of its place's live region.
    expect(pill()?.getAttribute('aria-live')).toBe('off');
    expect(pill()?.hasAttribute('aria-label')).toBe(false);
    expect(pill()?.contains(status)).toBe(false);

    act(() => store.set(liveVoiceRecordingAtom, recordingSession({ phase: 'paused' }).session));
    expect(pill()?.textContent).toBe('Paused 0:32');
    expect(status.textContent).toBe('Voice recording paused');
    act(() => store.set(liveVoiceRecordingAtom, undefined));
    expect(status.textContent).toBe('');
  });

  it('announces recording state once for two capsules without announcing their timer ticks', () => {
    const store = createStore();
    store.set(liveVoiceRecordingAtom, recordingSession().session);
    const { container } = render(
      <Provider store={store}>
        {composer()}
        {composer()}
        <LiveVoiceRecordingIndicator />
      </Provider>
    );
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Voice recording active');
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(0);
    expect(screen.getAllByText('0:32')).toHaveLength(2);

    act(() => store.set(liveVoiceRecordingAtom, recordingSession({ elapsedMs: 33_000 }).session));
    expect(screen.getAllByText('0:33')).toHaveLength(2);
    expect(status.textContent).toBe('Voice recording active');
    act(() => store.set(liveVoiceRecordingAtom, recordingSession({ phase: 'paused' }).session));
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('Voice recording paused');
    act(() => store.set(liveVoiceRecordingAtom, recordingSession().session));
    expect(status.textContent).toBe('Voice recording active');
  });

  it('moves Discard into the log-out confirmation and back to Settings when it closes', async () => {
    layOut();
    const store = createStore();
    const { session, discard } = recordingSession();
    store.set(liveVoiceRecordingAtom, session);
    render(
      <Provider store={store}>
        <NoticeSlot place="page" />
        {composer()}
        <SettingsWithLogout />
        <LiveVoiceRecordingIndicator />
      </Provider>
    );
    const settings = screen.getByRole('dialog', { name: 'Settings' });
    const openLogout = async () => {
      await act(async () => {
        fireEvent.click(within(settings).getByRole('button', { name: 'Logout' }));
      });
    };
    const discardLabel = 'Discard voice recording';
    expect(settings.contains(pill())).toBe(true);

    await openLogout();
    const confirmation = screen.getByRole('dialog', { name: 'Logout' });
    expect(confirmation.contains(pill())).toBe(true);
    fireEvent.click(within(confirmation).getByText('Cancel'));
    expect(screen.queryByRole('dialog', { name: 'Logout' })).toBeNull();
    expect(settings.contains(pill())).toBe(true);

    await openLogout();
    const reopened = screen.getByRole('dialog', { name: 'Logout' });
    fireEvent.click(within(reopened).getByRole('button', { name: discardLabel }));
    // The question stays out of the dialogs under it: the pill keeps its place, and Escape
    // closes the question alone.
    await expectFocusOnCancel();
    expect(reopened.contains(pill())).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', keyCode: 27 });
    expect(question()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Logout' })).toBe(reopened);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBe(settings);
    expect(discard).not.toHaveBeenCalled();

    fireEvent.click(within(reopened).getByRole('button', { name: discardLabel }));
    press(within(question()!).getByRole('button', { name: 'Discard' }));
    expect(discard).toHaveBeenCalledOnce();
    expect(pill()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Logout' })).toBe(reopened);
  });

  it('shows inside what covers the page, where the focus held there reaches it', () => {
    const store = createStore();
    store.set(liveVoiceRecordingAtom, recordingSession().session);
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
        <LiveVoiceRecordingIndicator />
      </Provider>
    );
    const { rerender } = render(page());
    expect(pill()).toBeNull();

    // A phone's drawer or members sheet, out over the page, offers its own place: the composer
    // is out of sight for as long as it does.
    rerender(page('drawer'));
    expect(screen.getByTestId('drawer').contains(pill())).toBe(true);
    // Marked as a notice that moves there: a rail-only drawer opens on release for it
    // (sidebar/PhoneNavDrawer.tsx).
    expect(pill()?.hasAttribute('data-cover-notice')).toBe(true);
    rerender(page('sheet'));
    expect(screen.getByTestId('sheet').contains(pill())).toBe(true);
    rerender(page());
    expect(pill()).toBeNull();
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
    const { session, discard } = recordingSession();
    store.set(liveVoiceRecordingAtom, session);
    render(
      <Provider store={store}>
        <main>
          <NoticeSlot place="page" />
          {composer()}
        </main>
        <BottomSheet title="Activity" closeLabel="Close" requestClose={requestClose}>
          <p>Example activity</p>
        </BottomSheet>
        <LiveVoiceRecordingIndicator />
      </Provider>
    );

    const dialog = screen.getByRole('dialog', { name: 'Activity' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard voice recording' }));
    expect(discard).not.toHaveBeenCalled();
    // The question is over the sheet, not outside it: it is not hidden as the page is, and
    // neither Escape nor a press in it closes the sheet.
    await expectFocusOnCancel();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', keyCode: 27 });
    expect(question()).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard voice recording' }));
    press(within(question()!).getByRole('button', { name: 'Discard' }));
    expect(discard).toHaveBeenCalledOnce();
    expect(store.get(liveVoiceRecordingAtom)).toBeUndefined();
    expect(requestClose).not.toHaveBeenCalled();
  });

  it('reaches Discard by Tab from the command palette search field', () => {
    const store = createStore();
    store.set(liveVoiceRecordingAtom, recordingSession().session);
    store.set(commandPaletteOpenAtom, 'all');
    render(
      <Provider store={store}>
        {composer()}
        <CommandPaletteRenderer />
        <LiveVoiceRecordingIndicator />
      </Provider>
    );
    const search = screen.getByRole('combobox', { name: 'Command palette' });
    expect(document.activeElement).toBe(search);
    // From All, Shift+Tab wraps to the last category as before.
    fireEvent.keyDown(search, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('tab', { name: 'Actions', selected: true })).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Tab' });
    // The palette's glass shell holds the dialog and, beside it, the notice slot.
    const shell = screen.getByRole('dialog', { name: 'Command palette' }).parentElement!;
    expect(document.activeElement).toBe(
      within(shell).getByRole('button', { name: 'Discard voice recording' })
    );
    expect(store.get(commandPaletteOpenAtom)).toBe('all');
  });

  it('discards a live recording without closing the command palette', async () => {
    layOut();
    const store = createStore();
    const { session, discard } = recordingSession();
    store.set(liveVoiceRecordingAtom, session);
    store.set(commandPaletteOpenAtom, 'all');
    render(
      <Provider store={store}>
        <NoticeSlot place="page" />
        {composer()}
        <CommandPaletteRenderer />
        <LiveVoiceRecordingIndicator />
      </Provider>
    );

    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    const button = within(dialog.parentElement!).getByRole('button', {
      name: 'Discard voice recording',
    });
    press(button);
    expect(store.get(commandPaletteOpenAtom)).toBe('all');
    expect(discard).not.toHaveBeenCalled();
    // Escape closes the question alone, and so does Cancel.
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
    expect(pill()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBe(dialog);
  });

  it('stands down while a composer shows the capsule, and back up when it goes or is covered', () => {
    const store = createStore();
    store.set(liveVoiceRecordingAtom, recordingSession().session);
    const page = (withComposer: boolean) => (
      <Provider store={store}>
        {withComposer && composer()}
        <NoticeSlot place="page" />
        <LiveVoiceRecordingIndicator />
      </Provider>
    );
    const { rerender } = render(page(true));
    expect(pill()).toBeNull();
    expect(screen.getAllByText('0:32')).toHaveLength(1);

    // A phone's drawer slides over the room: its composer is out of sight.
    act(() => store.set(phoneNavDrawerOpenAtom, true));
    expect(pill()).not.toBeNull();
    act(() => store.set(phoneNavDrawerOpenAtom, false));
    expect(pill()).toBeNull();

    // On to a page with no composer.
    rerender(page(false));
    expect(pill()?.textContent).toBe('Recording 0:32');
    rerender(page(true));
    expect(pill()).toBeNull();
  });

  it('shows why a recording could not be captured once, however many composers are mounted', () => {
    layOut();
    const store = createStore();
    store.set(liveVoiceRecordingAtom, recordingSession().session);
    render(
      <Provider store={store}>
        {composer()}
        {composer()}
        <NoticeSlot place="page" />
        <LiveVoiceRecordingIndicator />
      </Provider>
    );
    expect(screen.queryByText('Voice Recording Error')).toBeNull();

    act(() => {
      store.set(liveVoiceRecordingAtom, undefined);
      store.set(liveVoiceRecordingErrorAtom, 'No audio data was captured.');
    });

    expect(screen.getAllByText('Voice Recording Error')).toHaveLength(1);
    expect(screen.getAllByText('No audio data was captured.')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(store.get(liveVoiceRecordingErrorAtom)).toBeUndefined();
    expect(screen.queryByText('Voice Recording Error')).toBeNull();
  });

  it('lets you dismiss why a recording could not be captured over an open bottom sheet', async () => {
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
        <LiveVoiceRecordingIndicator />
      </Provider>
    );
    act(() => store.set(liveVoiceRecordingErrorAtom, 'No audio data was captured.'));

    // The error is over the sheet, not outside it: OK is not hidden as the page is, and a press
    // on it does not close the sheet.
    const ok = await screen.findByRole('button', { name: 'OK' });
    await waitFor(() => expect(ok).toBe(document.activeElement));
    press(ok);
    expect(store.get(liveVoiceRecordingErrorAtom)).toBeUndefined();
    expect(screen.queryByText('Voice Recording Error')).toBeNull();
    expect(requestClose).not.toHaveBeenCalled();
  });
});
