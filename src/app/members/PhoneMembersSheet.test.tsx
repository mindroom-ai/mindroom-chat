// @vitest-environment jsdom
import { Provider, createStore } from 'jotai';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PHONE_SLIDE_OUT_MS,
  phoneLayerOpenAtom,
  phoneNavDrawerOpenAtom,
} from '../navigation/phoneNavDrawer';
import { usePanelSlot } from '../ui/panels/panelPresence';
import { PhoneMembersSheet } from './PhoneMembersSheet';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./PhoneMembersSheet.css', () => ({ Layer: 'layer', Scrim: 'scrim', Panel: 'panel' }));

/** A room's panel slot with the members asked for or not, as Room and Lobby hold it. */
function Slot({ open, slot, onClose }: { open: boolean; slot: HTMLElement; onClose: () => void }) {
  const panel = usePanelSlot(
    open ? (
      <PhoneMembersSheet key="members" slot={slot} onClose={onClose}>
        <button type="button">Alice</button>
      </PhoneMembersSheet>
    ) : undefined
  );
  return panel ?? null;
}

let slot: HTMLElement;
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] });
  slot = document.createElement('div');
  document.body.append(slot);
  store = createStore();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// By its element: sliding out, the sheet is hidden from assistive technology.
const sheet = () => slot.querySelector<HTMLElement>('[role="dialog"]');

const mount = (open: boolean, onClose = vi.fn()) => {
  const tree = (shown: boolean) => (
    <Provider store={store}>
      <Slot open={shown} slot={slot} onClose={onClose} />
    </Provider>
  );
  const view = render(tree(open));
  const setOpen = (next: boolean) => view.rerender(tree(next));
  return { onClose, setOpen };
};

describe('PhoneMembersSheet', () => {
  it('slides in from the edge into the layer below the top bar', () => {
    const { setOpen } = mount(false);
    setOpen(true);
    const panel = sheet();
    expect(panel && slot.contains(panel)).toBe(true);
    // Mounted off screen, it moves out on the next frame, so the browser animates it.
    expect(panel?.hasAttribute('data-open')).toBe(false);
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(panel?.hasAttribute('data-open')).toBe(true);
    expect(store.get(phoneLayerOpenAtom)).toBe(true);
  });

  it('is out at once when the room opens with the members shown', () => {
    mount(true);
    expect(sheet()?.hasAttribute('data-open')).toBe(true);
  });

  it('slides out before it goes, and edge swipes come back once it is away', () => {
    const { setOpen } = mount(false);
    setOpen(true);
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    setOpen(false);
    const panel = sheet();
    expect(panel?.hasAttribute('data-open')).toBe(false);
    expect(store.get(phoneLayerOpenAtom)).toBe(false);
    act(() => {
      vi.advanceTimersByTime(PHONE_SLIDE_OUT_MS - 1);
    });
    expect(sheet()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(sheet()).toBeNull();
  });

  it('comes back when the members are asked for again while it slides out', () => {
    const { setOpen } = mount(false);
    setOpen(true);
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    setOpen(false);
    setOpen(true);
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    act(() => {
      vi.advanceTimersByTime(PHONE_SLIDE_OUT_MS);
    });
    expect(sheet()?.hasAttribute('data-open')).toBe(true);
  });

  it('goes away on a tap on the scrim', () => {
    const { onClose } = mount(true);
    const scrim = slot.querySelector('.scrim');
    expect(scrim).not.toBeNull();
    if (scrim) fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalled();
  });

  it('goes away when the navigation drawer comes out over it', () => {
    const { onClose } = mount(true);
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      store.set(phoneNavDrawerOpenAtom, true);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('goes away on Escape, unless a menu is open: that one closes', () => {
    const { onClose } = mount(true);
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    document.body.append(menu);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    menu.remove();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
