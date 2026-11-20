import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discardedVoiceDraftAtom,
  pendingVoiceSendDraftAtom,
  queuedVoiceDraftsAtom,
  type PendingVoiceSendDraft,
} from '../roomInputDrafts';
import { discardVoiceDraft, offerQueuedVoiceDraft } from './voiceDrafts';
import { VoiceDiscardToast } from './VoiceDiscardToast';

const journal = vi.hoisted(() => ({
  updateVoiceRecording: vi.fn(async () => undefined),
  deleteVoiceRecording: vi.fn(async () => undefined),
}));
vi.mock('./voiceRecordingJournal', () => journal);
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
const mount = (store: ReturnType<typeof createStore>) =>
  act(() => {
    renderer = create(
      React.createElement(Provider, { store }, React.createElement(VoiceDiscardToast))
    );
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
  it('offers Undo, which brings the recording back as a parked draft', () => {
    const store = createStore();
    mount(store);
    expect(renderer.toJSON()).toBeNull();

    act(() => discardVoiceDraft(store, draft));
    expect(shown()).toContain('Recording discarded');
    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    act(() => {
      (renderer.root.findByType('button').props as { onClick: () => void }).onClick();
    });

    expect(renderer.toJSON()).toBeNull();
    expect(store.get(discardedVoiceDraftAtom)).toBeUndefined();
    expect(store.get(queuedVoiceDraftsAtom)).toEqual([draft]);
    offerQueuedVoiceDraft(store, USER);
    expect(store.get(pendingVoiceSendDraftAtom)).toBe(draft);
    // Nothing is deleted later either.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(journal.deleteVoiceRecording).not.toHaveBeenCalled();
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
    expect(journal.deleteVoiceRecording).toHaveBeenCalledExactlyOnceWith('rec-1');
    expect(store.get(queuedVoiceDraftsAtom)).toEqual([]);
  });
});
