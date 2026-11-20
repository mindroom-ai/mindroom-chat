// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { phoneNavDrawerOpenAtom } from '../../navigation/phoneNavDrawer';
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
        <LiveVoiceRecordingIndicator />
      </Provider>
    );

    expect(pill()?.textContent).toBe('Recording 0:32');
    expect(pill()?.getAttribute('aria-label')).toBe('Voice recording active');
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
        <LiveVoiceRecordingIndicator />
      </Provider>
    );
    expect(pill()?.textContent).toBe('Paused 0:32');
    expect(pill()?.getAttribute('aria-label')).toBe('Voice recording paused');
  });

  it('stands down while a composer shows the capsule, and back up when it goes or is covered', () => {
    const store = createStore();
    store.set(liveVoiceRecordingAtom, recordingSession().session);
    const page = (withComposer: boolean) => (
      <Provider store={store}>
        {withComposer && composer()}
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
