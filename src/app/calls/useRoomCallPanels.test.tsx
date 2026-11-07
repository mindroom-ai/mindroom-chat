// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { useRoomCallPanels } from './useRoomCallPanels';
import { callPanelRoomAtom } from './callStore';
import { openTranscriptPanel, transcriptPanelAtom } from './transcription/transcriptPanel';

const ROOM_ID = '!room:example.org';

let renderer: ReactTestRenderer | undefined;
let shown: ReturnType<typeof useRoomCallPanels> | undefined;

function Probe({
  mediaPanelOpen,
  closeMedia,
}: {
  mediaPanelOpen: boolean;
  closeMedia: () => void;
}) {
  shown = useRoomCallPanels(ROOM_ID, mediaPanelOpen, closeMedia);
  return null;
}

const mount = () => {
  const store = createStore();
  const closeMedia = vi.fn();
  const render = (mediaPanelOpen = false) =>
    act(() => {
      const element = (
        <Provider store={store}>
          <Probe mediaPanelOpen={mediaPanelOpen} closeMedia={closeMedia} />
        </Provider>
      );
      if (renderer) renderer.update(element);
      else renderer = create(element);
    });
  render();
  const panels = () => ({ call: shown?.callShown, transcript: shown?.transcriptShown });
  return { store, closeMedia, render, panels };
};

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  shown = undefined;
});

describe("the room's call panels", () => {
  it("show the live transcript in the call panel's place, and the call panel when it closes", () => {
    const t = mount();
    act(() => t.store.set(callPanelRoomAtom, ROOM_ID));
    expect(t.panels()).toEqual({ call: true, transcript: false });

    act(() => openTranscriptPanel(t.store, ROOM_ID));
    expect(t.panels()).toEqual({ call: false, transcript: true });

    act(() => shown?.closeTranscript());
    expect(t.panels()).toEqual({ call: true, transcript: false });
  });

  it('let the call panel, opened again, take the place for good', () => {
    const t = mount();
    act(() => openTranscriptPanel(t.store, ROOM_ID));
    act(() => t.store.set(callPanelRoomAtom, ROOM_ID));
    expect(t.panels()).toEqual({ call: true, transcript: false });
    expect(t.store.get(transcriptPanelAtom)).toBeUndefined();
  });

  it('close a canvas or the computer for the live transcript, and give way to one', () => {
    const t = mount();
    act(() => openTranscriptPanel(t.store, ROOM_ID));
    expect(t.closeMedia).toHaveBeenCalledTimes(1);

    t.render(true);
    expect(t.panels()).toEqual({ call: false, transcript: false });
    expect(t.store.get(transcriptPanelAtom)).toBeUndefined();
    expect(t.store.get(callPanelRoomAtom)).toBeUndefined();
  });
});
