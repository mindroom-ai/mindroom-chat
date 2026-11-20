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

const journal = vi.hoisted(() => ({
  updateVoiceRecording: vi.fn(async () => true),
  deleteVoiceRecording: vi.fn(async () => undefined),
}));
vi.mock('./voiceRecordingJournal', () => journal);
const account = vi.hoisted(() => ({ userId: '@alice:example.org' }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => account.userId }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({ 'composer.voiceDiscarded': 'Recording discarded', 'composer.voiceUndoDiscard': 'Undo' }[
        key
      ] ?? key),
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

beforeEach(() => {
  vi.useFakeTimers();
  journal.updateVoiceRecording.mockClear();
  journal.deleteVoiceRecording.mockClear();
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

    act(() => discardVoiceDraft(store, draft));
    expect(shown()).toContain('Recording discarded');
    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    await act(async () => {
      (renderer.root.findByType('button').props as { onClick: () => void }).onClick();
    });

    expect(renderer.toJSON()).toBeNull();
    expect(store.get(discardedVoiceDraftsAtom)).toEqual([]);
    expect(store.get(queuedVoiceDraftsAtom)).toEqual([draft]);
    offerQueuedVoiceDraft(store, USER);
    expect(store.get(pendingVoiceSendDraftAtom)).toBe(draft);
  });

  it('offers the last discard first, then the one before, and none of another account', async () => {
    const store = createStore();
    mount(store);
    const press = () =>
      act(async () => {
        (renderer.root.findByType('button').props as { onClick: () => void }).onClick();
      });
    act(() => {
      discardVoiceDraft(store, draft);
      discardVoiceDraft(store, { ...draft, recordingId: 'rec-2' });
    });
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

  it('deletes the recording once its ten seconds ran out', () => {
    const store = createStore();
    mount(store);
    act(() => discardVoiceDraft(store, draft));
    act(() => {
      vi.advanceTimersByTime(9_999);
    });
    expect(shown()).toContain('Undo');
    expect(journal.deleteVoiceRecording).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(renderer.toJSON()).toBeNull();
    // The journal deletes it if the disk, too, says its discard stood until now.
    expect(journal.deleteVoiceRecording).toHaveBeenCalledExactlyOnceWith('rec-1', Date.now());
    expect(store.get(queuedVoiceDraftsAtom)).toEqual([]);
  });
});
