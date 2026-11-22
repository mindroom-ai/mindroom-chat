// @vitest-environment jsdom
import { Provider, createStore } from 'jotai';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PHONE_SLIDE_OUT_MS,
  phoneLayerOpenAtom,
  phoneNavDrawerOpenAtom,
  phoneSheetOpenAtom,
} from '../navigation/phoneNavDrawer';
import { usePanelSlot } from '../ui/panels/panelPresence';
import { PhoneMembersSheet } from './PhoneMembersSheet';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./PhoneMembersSheet.css', () => ({
  Layer: 'layer',
  Scrim: 'scrim',
  Panel: 'panel',
  Members: 'members',
}));
// The sheet's notice place is tested with the other places (ui/noticeSlots.test.tsx).
vi.mock('../ui/noticeSlots', () => ({
  NoticeSlot: ({ place }: { place: string }) => <div data-notice-place={place} />,
}));

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

  it('offers a notice place of its own, above the members, while it is out', () => {
    const { setOpen } = mount(true);
    const place = () => sheet()?.querySelector('[data-notice-place="sheet"]');
    expect(place()).toBe(sheet()?.firstElementChild);

    // Sliding out, it is inert: nothing in it is in reach, and the place goes back to the page.
    setOpen(false);
    expect(sheet()).not.toBeNull();
    expect(place()).toBeNull();
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

  const dispatchTouch = (
    target: EventTarget,
    type: string,
    touches: Array<{ clientX: number; clientY: number; identifier?: number }>,
    timeStamp: number
  ) => {
    const list = touches.map((touch) => ({ identifier: 1, ...touch }));
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: list });
    Object.defineProperty(event, 'changedTouches', {
      value: list.length > 0 ? list : [{ identifier: 1, clientX: 0, clientY: 0 }],
    });
    Object.defineProperty(event, 'timeStamp', { value: timeStamp });
    target.dispatchEvent(event);
  };

  const mockPanelWidth = (panel: HTMLElement, width: number) =>
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      width,
      height: 600,
      top: 0,
      left: 90,
      right: 90 + width,
      bottom: 600,
      x: 90,
      y: 0,
      toJSON: () => ({}),
    });

  const flushMicrotasks = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('tracks interactive drag on panel and scrim, and cancels without closing or clearing phoneSheetOpenAtom', async () => {
    const { onClose } = mount(true);
    const panel = sheet()!;
    const scrim = slot.querySelector<HTMLElement>('.scrim')!;
    mockPanelWidth(panel, 300);

    // Drag toward end edge (right in LTR) by 70 px -> lockX = 110, offset = 60 (20% < 35%).
    act(() => {
      dispatchTouch(panel, 'touchstart', [{ clientX: 100, clientY: 200 }], 100);
      dispatchTouch(panel, 'touchmove', [{ clientX: 170, clientY: 200 }], 300);
      vi.advanceTimersToNextFrame();
    });

    expect(panel.style.translate).toBe('60px 0');
    expect(scrim.style.opacity).toBe('0.8');
    expect(panel.hasAttribute('data-swiping')).toBe(true);
    expect(scrim.hasAttribute('data-swiping')).toBe(true);
    expect(store.get(phoneSheetOpenAtom)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    // Release slowly -> cancels and cleans up styles.
    act(() => {
      dispatchTouch(panel, 'touchmove', [{ clientX: 170, clientY: 200 }], 500);
      dispatchTouch(panel, 'touchend', [], 520);
    });
    await flushMicrotasks();

    expect(onClose).not.toHaveBeenCalled();
    expect(store.get(phoneSheetOpenAtom)).toBe(true);
    expect(panel.style.translate).toBe('');
    expect(scrim.style.opacity).toBe('');
    expect(panel.hasAttribute('data-swiping')).toBe(false);
    expect(scrim.hasAttribute('data-swiping')).toBe(false);
  });

  it('commits interactive swipe close immediately without waiting PHONE_SLIDE_OUT_MS, and resets for reopen', async () => {
    let setOpenRef: (next: boolean) => void = () => {};
    const onClose = vi.fn(() => setOpenRef(false));
    const { setOpen } = mount(true, onClose);
    setOpenRef = setOpen;

    const panel = sheet()!;
    const scrim = slot.querySelector<HTMLElement>('.scrim')!;
    mockPanelWidth(panel, 300);

    // Drag past 35% of 300 (lockX = 90, x = 240 => offset = 150 = 50%).
    act(() => {
      dispatchTouch(panel, 'touchstart', [{ clientX: 80, clientY: 200 }], 100);
      dispatchTouch(panel, 'touchmove', [{ clientX: 240, clientY: 200 }], 220);
      vi.advanceTimersToNextFrame();
    });
    expect(panel.style.translate).toBe('150px 0');
    expect(scrim.style.opacity).toBe('0.5');

    act(() => {
      dispatchTouch(panel, 'touchend', [], 240);
    });
    await flushMicrotasks();

    expect(onClose).toHaveBeenCalledTimes(1);
    // Unmounted immediately without advancing timers by PHONE_SLIDE_OUT_MS.
    expect(sheet()).toBeNull();
    expect(store.get(phoneSheetOpenAtom)).toBe(false);

    // Reopening and closing normally (non-swipe) still waits for PHONE_SLIDE_OUT_MS.
    setOpen(true);
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(sheet()?.hasAttribute('data-open')).toBe(true);
    setOpen(false);
    act(() => {
      vi.advanceTimersByTime(PHONE_SLIDE_OUT_MS - 1);
    });
    expect(sheet()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(sheet()).toBeNull();
  });

  it('mirrors interactive close translation in RTL', async () => {
    const prevDir = document.documentElement.dir;
    document.documentElement.dir = 'rtl';
    let setOpenRef: (next: boolean) => void = () => {};
    const onClose = vi.fn(() => setOpenRef(false));
    const { setOpen } = mount(true, onClose);
    setOpenRef = setOpen;

    try {
      const panel = sheet()!;
      mockPanelWidth(panel, 300);

      // RTL end edge is physical left: drag left from 240 -> 100 (lockX = 230, offset = 130).
      act(() => {
        dispatchTouch(panel, 'touchstart', [{ clientX: 240, clientY: 200 }], 100);
        dispatchTouch(panel, 'touchmove', [{ clientX: 100, clientY: 200 }], 200);
        vi.advanceTimersToNextFrame();
      });
      expect(panel.style.translate).toBe('-130px 0');

      act(() => {
        dispatchTouch(panel, 'touchend', [], 220);
      });
      await flushMicrotasks();

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(sheet()).toBeNull();
    } finally {
      document.documentElement.dir = prevDir;
    }
  });

  it('falls back to discrete dismiss without snapping when entry transform transition is running', async () => {
    const { onClose } = mount(true);
    const panel = sheet()!;
    const scrim = slot.querySelector<HTMLElement>('.scrim')!;
    mockPanelWidth(panel, 300);
    Object.defineProperty(panel, 'getAnimations', {
      configurable: true,
      value: () => [{ transitionProperty: 'transform', playState: 'running' }],
    });

    act(() => {
      dispatchTouch(panel, 'touchstart', [{ clientX: 80, clientY: 200 }], 100);
      dispatchTouch(panel, 'touchmove', [{ clientX: 180, clientY: 200 }], 200);
      vi.advanceTimersToNextFrame();
    });

    // Entry transition is not interrupted by data-swiping or inline translate.
    expect(panel.hasAttribute('data-swiping')).toBe(false);
    expect(scrim.hasAttribute('data-swiping')).toBe(false);
    expect(panel.style.translate).toBe('');
    expect(scrim.style.opacity).toBe('');

    // Releasing past discrete threshold (>= 56 px) still dismisses cleanly.
    act(() => {
      dispatchTouch(panel, 'touchend', [], 220);
    });
    await flushMicrotasks();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
