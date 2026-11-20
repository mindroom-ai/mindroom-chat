// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { phoneNavDrawerOpenAtom } from '../../navigation/phoneNavDrawer';
import { DialogNoticeSlot, NoticeSlot } from '../../ui/noticeSlots';
import type { PendingVoiceSendContext } from '../roomInputDrafts';
import { LiveVoiceRecordingIndicator } from './LiveVoiceRecordingIndicator';
import { liveVoiceRecordingAtom, liveVoiceRecordingErrorAtom } from './liveVoiceRecording';
import { VoiceRecorderComposer } from './VoiceRecorderDialog';
import type { VoiceCaptureSession, VoiceCaptureSnapshot } from './voiceCaptureSession';

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
  const discard = vi.fn(async () => false);
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
    onRetryRequest={vi.fn()}
    onSendRecording={vi.fn()}
    getSendContext={sendContext}
  />
);
const pill = () => screen.queryByTestId('live-voice-recording-indicator');

describe('LiveVoiceRecordingIndicator', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('shows nothing while no recording runs', () => {
    render(
      <Provider store={createStore()}>
        <NoticeSlot place="page" />
        <LiveVoiceRecordingIndicator />
      </Provider>
    );
    expect(pill()).toBeNull();
    expect(screen.queryByText('Voice Recording Error')).toBeNull();
  });

  it('shows the recording and its time where no composer shows it, with Discard and no Send', () => {
    const store = createStore();
    const { session, discard } = recordingSession();
    store.set(liveVoiceRecordingAtom, session);
    render(
      <Provider store={store}>
        <NoticeSlot place="page" />
        <LiveVoiceRecordingIndicator />
      </Provider>
    );

    expect(pill()?.textContent).toBe('Recording 0:32');
    expect(screen.queryByRole('button', { name: /send/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Discard voice recording' }));

    expect(discard).toHaveBeenCalledOnce();
    expect(store.get(liveVoiceRecordingAtom)).toBeUndefined();
    expect(pill()).toBeNull();
  });

  it('says so while the recording is paused', () => {
    const store = createStore();
    store.set(liveVoiceRecordingAtom, recordingSession({ phase: 'paused' }).session);
    render(
      <Provider store={store}>
        <NoticeSlot place="page" />
        <LiveVoiceRecordingIndicator />
      </Provider>
    );
    expect(pill()?.textContent).toBe('Paused 0:32');
    expect(screen.getByText('Voice recording paused')).toBeTruthy();
  });

  it('is read out when it comes and when the recording pauses, not as its time counts', () => {
    const store = createStore();
    store.set(liveVoiceRecordingAtom, recordingSession().session);
    render(
      <Provider store={store}>
        <NoticeSlot place="page" />
        <LiveVoiceRecordingIndicator />
      </Provider>
    );
    const place = pill()?.parentElement;

    // The place is the live region. The pill, whose time changes every second, is left out of
    // it and names itself by what it shows; the state is said beside it.
    expect(place?.getAttribute('aria-live')).toBe('polite');
    expect(pill()?.getAttribute('aria-live')).toBe('off');
    expect(pill()?.hasAttribute('aria-label')).toBe(false);
    const said = screen.getByText('Voice recording active');
    expect(said.parentElement).toBe(place);
    expect(pill()?.contains(said)).toBe(false);
  });

  it('shows inside what covers the page, where the focus held there reaches it', () => {
    const store = createStore();
    store.set(liveVoiceRecordingAtom, recordingSession().session);
    const page = (dialogs: number, drawer: boolean) => (
      <Provider store={store}>
        <div data-testid="page">
          <NoticeSlot place="page" />
          {composer()}
        </div>
        {drawer && (
          <div data-testid="drawer">
            <NoticeSlot place="drawer" />
          </div>
        )}
        {Array.from({ length: dialogs }, (_, index) => (
          <div key={index} data-testid={`dialog-${index}`}>
            <DialogNoticeSlot />
          </div>
        ))}
        <LiveVoiceRecordingIndicator />
      </Provider>
    );
    const { rerender } = render(page(0, false));
    expect(pill()).toBeNull();

    // A large dialog, such as Settings, covers the composer: the pill shows in the dialog.
    rerender(page(1, false));
    expect(screen.getByTestId('dialog-0').contains(pill())).toBe(true);

    // Of two dialogs, the one on top holds the focus.
    rerender(page(2, false));
    expect(screen.getByTestId('dialog-1').contains(pill())).toBe(true);
    rerender(page(1, false));
    expect(screen.getByTestId('dialog-0').contains(pill())).toBe(true);

    // Closed, the composer shows the recording again.
    rerender(page(0, false));
    expect(pill()).toBeNull();

    // A phone's drawer, out over the page, offers its own place.
    act(() => store.set(phoneNavDrawerOpenAtom, true));
    rerender(page(0, true));
    expect(screen.getByTestId('drawer').contains(pill())).toBe(true);
    act(() => store.set(phoneNavDrawerOpenAtom, false));
    rerender(page(0, false));
    expect(pill()).toBeNull();
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
});
