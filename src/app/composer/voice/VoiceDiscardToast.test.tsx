import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discardedVoiceDraftsAtom,
  pendingVoiceSendDraftAtom,
  queuedVoiceDraftsAtom,
  type PendingVoiceSendDraft,
} from '../roomInputDrafts';
import { discardVoiceDraft, offerQueuedVoiceDraft } from './voiceDrafts';
import { VoiceDiscardToast } from './VoiceDiscardToast';

const journal = vi.hoisted(() => {
  /** What every write to the disk comes to, until a test says otherwise. */
  const state = { outcome: 'committed' };
  return Object.assign(state, {
    adoptVoiceOrphans: vi.fn(async () => []),
    transitionVoiceRecording: vi.fn(async () => state.outcome),
  });
});
vi.mock('./voiceRecordingJournal', () => journal);
const account = vi.hoisted(() => {
  const state = { userId: '@alice:example.org', client: { getUserId: () => state.userId } };
  return state;
});
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => account.client }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'composer.voiceDiscarded': 'Recording discarded',
        'composer.voiceUndoDiscard': 'Undo',
        'composer.voiceUndoFailed': "Couldn't undo",
        'mindroomUi.voice.voiceRecorderDialog.retry': 'Retry',
      }[key] ?? key),
  }),
}));
vi.mock('folds', () => ({
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) =>
    React.createElement('button', { onClick }, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
}));
vi.mock('../../ui/glass/GlassPrimitives', () => ({
  Surface: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('../../ui/noticeSlots.css', () => ({ PageSlot: () => 'PageSlot' }));
vi.mock('./VoiceDiscardToast.css', () => ({ Toast: 'Toast' }));

const USER = '@alice:example.org';
const draft: PendingVoiceSendDraft = {
  recordingId: 'rec-1',
  file: new File(['voice'], 'voice.webm', { type: 'audio/webm' }),
  duration: 4_200,
  context: { ownerSessionId: USER },
};

let renderer: ReactTestRenderer;
const toast = () => React.createElement(VoiceDiscardToast);
const mount = (store: ReturnType<typeof createStore>) =>
  act(() => {
    renderer = create(React.createElement(Provider, { store }, toast()));
  });
const shown = () => JSON.stringify(renderer.toJSON());

const press = () =>
  act(async () => {
    (renderer.root.findByType('button').props as { onClick: () => void }).onClick();
  });
const discard = (store: ReturnType<typeof createStore>, recording = draft) =>
  act(() => discardVoiceDraft(store, recording));
const pass = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  journal.outcome = 'committed';
  journal.adoptVoiceOrphans.mockClear();
  journal.transitionVoiceRecording.mockClear();
});
afterEach(() => {
  act(() => renderer.unmount());
  vi.useRealTimers();
});

describe('VoiceDiscardToast', () => {
  it('offers Undo, which brings the recording back as a parked draft', async () => {
    const store = createStore();
    mount(store);
    expect(renderer.toJSON()).toBeNull();

    await discard(store);
    expect(shown()).toContain('Recording discarded');
    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    await press();

    expect(renderer.toJSON()).toBeNull();
    expect(store.get(discardedVoiceDraftsAtom)).toEqual([]);
    expect(store.get(queuedVoiceDraftsAtom)).toEqual([{ ...draft, unprotected: false }]);
    offerQueuedVoiceDraft(store, USER);
    expect(store.get(pendingVoiceSendDraftAtom)?.recordingId).toBe('rec-1');
  });

  it('says so when the disk could not be told of an Undo, and offers it again', async () => {
    const store = createStore();
    mount(store);
    await discard(store);
    journal.outcome = 'failed';
    await press();
    // Not back, and not gone: the person can press again.
    expect(shown()).toContain("Couldn't undo");
    expect(shown()).toContain('Retry');
    expect(store.get(queuedVoiceDraftsAtom)).toEqual([]);
    await pass(20_000);
    expect(shown()).toContain("Couldn't undo");

    journal.outcome = 'committed';
    await press();
    expect(renderer.toJSON()).toBeNull();
    expect(store.get(queuedVoiceDraftsAtom).map((d) => d.recordingId)).toEqual(['rec-1']);
  });

  it('offers the last discard first, then the one before, and none of another account', async () => {
    const store = createStore();
    mount(store);
    await discard(store);
    await discard(store, { ...draft, recordingId: 'rec-2' });
    await press();
    expect(store.get(queuedVoiceDraftsAtom).map((d) => d.recordingId)).toEqual(['rec-2']);
    // The first one's Undo is still there.
    expect(shown()).toContain('Undo');

    // Another account is signed in on this page now: this recording is not its to bring back.
    account.userId = '@bob:example.org';
    act(() => renderer.update(React.createElement(Provider, { store }, toast())));
    expect(renderer.toJSON()).toBeNull();
    account.userId = USER;
    act(() => renderer.update(React.createElement(Provider, { store }, toast())));
    await press();
    expect(store.get(queuedVoiceDraftsAtom).map((d) => d.recordingId)).toEqual(['rec-1', 'rec-2']);
    expect(renderer.toJSON()).toBeNull();
  });

  it('deletes the recording once its ten seconds ran out, if the disk still says it is discarded', async () => {
    const store = createStore();
    mount(store);
    await discard(store);
    journal.transitionVoiceRecording.mockClear();
    await pass(9_999);
    expect(shown()).toContain('Undo');
    expect(journal.transitionVoiceRecording).not.toHaveBeenCalled();
    await pass(1);
    expect(renderer.toJSON()).toBeNull();
    const [[recordingId, expire]] = journal.transitionVoiceRecording.mock.calls as unknown as [
      [string, (record: { discardUntil?: number }) => unknown]
    ];
    expect(recordingId).toBe('rec-1');
    expect(expire({ discardUntil: Date.now() })).toBeUndefined();
    expect(expire({ discardUntil: Date.now() + 1 })).toBeDefined();
    expect(expire({})).toBeDefined();
    expect(store.get(queuedVoiceDraftsAtom)).toEqual([]);
  });

  it('brings back what a crash left on disk, once for the signed-in app', async () => {
    const store = createStore();
    mount(store);
    await act(async () => undefined);
    expect(journal.adoptVoiceOrphans).toHaveBeenCalledExactlyOnceWith(USER);
  });
});
