// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RectCords } from 'folds';
import { useAnchoredCard, useLiveAnchor } from './useAnchoredCard';

let rect = { x: 10, y: 20, width: 100, height: 16 };
let cardRect = { x: 10, y: 40, width: 200, height: 100 };
let renders = 0;

// A trigger and, while open, a focusable card that shows the anchor's top.
function Harness({
  closeDelayMs,
  triggerKey,
  onAnchor,
}: {
  closeDelayMs?: number;
  triggerKey?: string;
  onAnchor?: (anchor: RectCords) => void;
}) {
  renders += 1;
  const { open, triggerRef, cardRef, toggle, pin, hover, onFocusLeave } =
    useAnchoredCard(closeDelayMs);
  if (open) onAnchor?.(open.anchor);
  return (
    <>
      <button
        key={triggerKey}
        ref={(node) => {
          if (node) node.getBoundingClientRect = () => ({ ...rect }) as DOMRect;
          triggerRef.current = node;
        }}
        type="button"
        {...hover}
        onClick={toggle}
        onBlur={onFocusLeave}
        // Like the title marker: Tab from the trigger goes into the open card.
        onKeyDown={(evt) => {
          if (evt.key !== 'Tab' || evt.shiftKey || !open) return;
          evt.preventDefault();
          screen.getByText('Example action').focus();
        }}
      >
        Example trigger
      </button>
      {open && (
        <div
          ref={(node) => {
            if (node) node.getBoundingClientRect = () => ({ ...cardRect }) as DOMRect;
            cardRef.current = node;
          }}
          data-testid="card"
          data-top={open.anchor.y}
          tabIndex={-1}
          onFocus={pin}
        >
          <button type="button">Example action</button>
        </div>
      )}
    </>
  );
}

function LiveAnchorHarness({
  opener,
  onGone,
}: {
  opener: HTMLElement | undefined;
  onGone: () => void;
}) {
  const anchor = useLiveAnchor(opener, onGone);
  return anchor ? <div data-testid="live-anchor" data-top={anchor.y} /> : null;
}

const card = () => screen.queryByTestId('card');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rect = { x: 10, y: 20, width: 100, height: 16 };
  cardRect = { x: 10, y: 40, width: 200, height: 100 };
  renders = 0;
});

describe('useAnchoredCard', () => {
  it('stays idle without polling rAF, coalesces scroll/resize, and stops on close', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    render(<Harness />);
    fireEvent.click(screen.getByText('Example trigger'));
    // Drain the post-mount MutationObserver microtask and its single coalesced settling frame.
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersToNextFrame();
    });
    rafSpy.mockClear();
    const settled = renders;

    // Open and idle: no repeated rAF polling loop and no renders.
    for (let i = 0; i < 5; i += 1) {
      act(() => {
        vi.advanceTimersToNextFrame();
      });
    }
    expect(rafSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(renders).toBe(settled);

    // Multiple scroll events within a frame coalesce into a single rAF measurement.
    rect = { ...rect, y: 140 };
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('scroll'));
    });
    expect(rafSpy).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(card()?.dataset.top).toBe('140');
    expect(vi.getTimerCount()).toBe(0);

    // Remains idle after updating: no further rAF scheduled.
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        vi.advanceTimersToNextFrame();
      });
    }
    expect(rafSpy).toHaveBeenCalledTimes(1);

    // A trigger not displayed measures all zeros: the card stays where it was.
    rect = { x: 0, y: 0, width: 0, height: 0 };
    act(() => {
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersToNextFrame();
    });
    expect(card()?.dataset.top).toBe('140');

    fireEvent.click(screen.getByText('Example trigger'));
    expect(card()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    // Closed: listeners are torn down and events schedule no rAF.
    rafSpy.mockClear();
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
    });
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('re-anchors on ResizeObserver content resize and disconnects on close', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const observed = new Set<Element>();
    const callbacks: ResizeObserverCallback[] = [];
    const disconnect = vi.fn(() => observed.clear());
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe(el: Element) {
          observed.add(el);
        }
        unobserve(el: Element) {
          observed.delete(el);
        }
        disconnect = disconnect;
      }
    );

    const anchors = new Set<RectCords>();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    render(<Harness onAnchor={(anchor) => anchors.add(anchor)} />);
    const trigger = screen.getByText('Example trigger');
    fireEvent.click(trigger);
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersToNextFrame();
    });

    const openedCard = card()!;
    expect(observed.has(document.documentElement)).toBe(true);
    expect(observed.has(trigger)).toBe(true);
    expect(observed.has(openedCard)).toBe(true);

    const placed = anchors.size;
    rafSpy.mockClear();
    cardRect = { ...cardRect, height: 260 };
    act(() => {
      callbacks.forEach((cb) => cb([], {} as ResizeObserver));
    });
    expect(rafSpy).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(anchors.size).toBe(placed + 1);
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(trigger);
    expect(disconnect).toHaveBeenCalled();
  });

  it('keeps the card open and follows a trigger remounted under the same ref', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const { rerender } = render(<Harness triggerKey="original" />);
    const trigger = screen.getByText('Example trigger');
    fireEvent.click(trigger);
    const opened = card();
    expect(opened?.dataset.top).toBe('20');

    rect = { ...rect, y: 140 };
    rerender(<Harness triggerKey="replacement" />);
    expect(trigger.isConnected).toBe(false);
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(card()).toBe(opened);
    expect(opened?.dataset.top).toBe('140');
  });

  it('fires onGone on trigger removal and when the trigger loses its layout boxes', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const makeTrigger = () => {
      const button = document.createElement('button');
      button.getBoundingClientRect = () => ({ ...rect }) as DOMRect;
      button.getClientRects = () => [{ ...rect }] as unknown as DOMRectList;
      document.body.append(button);
      return button;
    };

    const removable = makeTrigger();
    const onRemoved = vi.fn();
    const first = render(<LiveAnchorHarness opener={removable} onGone={onRemoved} />);
    expect(screen.getByTestId('live-anchor').dataset.top).toBe('20');
    expect(onRemoved).not.toHaveBeenCalled();

    await act(async () => {
      removable.remove();
      await Promise.resolve();
      vi.advanceTimersToNextFrame();
    });
    expect(onRemoved).toHaveBeenCalledTimes(1);
    first.unmount();

    const hideable = makeTrigger();
    const onHidden = vi.fn();
    const second = render(<LiveAnchorHarness opener={hideable} onGone={onHidden} />);
    try {
      expect(onHidden).not.toHaveBeenCalled();

      await act(async () => {
        hideable.getClientRects = () => [] as unknown as DOMRectList;
        hideable.style.display = 'none';
        await Promise.resolve();
        vi.advanceTimersToNextFrame();
      });
      expect(onHidden).toHaveBeenCalledTimes(1);
    } finally {
      second.unmount();
      hideable.remove();
    }
  });

  it('lets a trigger send Tab into the card, and Tab in the card goes on from the trigger', () => {
    render(<Harness />);
    const trigger = screen.getByText('Example trigger');
    fireEvent.click(trigger);
    act(() => trigger.focus());

    // The bubbling Tab reaches the document with focus already in the card: it stays there.
    fireEvent.keyDown(trigger, { key: 'Tab' });
    const action = screen.getByText('Example action');
    expect(document.activeElement).toBe(action);

    fireEvent.keyDown(action, { key: 'Tab' });
    expect(document.activeElement).toBe(trigger);
  });

  it('gives focus in the card back to the trigger on Escape, and keeps that Escape from the room', () => {
    render(<Harness />);
    const trigger = screen.getByText('Example trigger');
    fireEvent.click(trigger);
    act(() => screen.getByText('Example action').focus());

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    act(() => {
      document.dispatchEvent(escape);
    });
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(escape.defaultPrevented).toBe(true);

    // Focus outside the card: the card closes and the room keeps its Escape.
    fireEvent.click(trigger);
    const later = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    act(() => {
      document.dispatchEvent(later);
    });
    expect(card()).toBeNull();
    expect(later.defaultPrevented).toBe(false);
  });
});
