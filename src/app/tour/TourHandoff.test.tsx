// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockMedia, restoreMedia } from './__tests__/media';
import { HANDOFF_LENGTH_MS, TourHandoff } from './TourHandoff';

const onEnd = vi.fn();

/** Puts a room's composer on the page, as `ConversationLayout` and the editor mark it. */
const addComposer = (): HTMLElement => {
  const footer = document.body.appendChild(document.createElement('div'));
  footer.setAttribute('data-room-footer', 'true');
  const composer = footer.appendChild(document.createElement('div'));
  composer.setAttribute('data-editable-name', 'RoomInput');
  composer.tabIndex = 0;
  composer.getBoundingClientRect = () => new DOMRect(300, 640, 500, 48);
  return composer;
};

const ring = () => document.querySelector<HTMLElement>('[data-tour-handoff]');
const tick = (ms = 0) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  restoreMedia();
  onEnd.mockReset();
  document.body.innerHTML = '';
});

describe('TourHandoff', () => {
  it("pulses a ring around the room's composer and gives it the focus", () => {
    const composer = addComposer();
    render(<TourHandoff onEnd={onEnd} />);

    expect(ring()?.style.transform).toBe('translate(296px, 636px)');
    expect(ring()?.style.width).toBe('508px');
    expect(ring()?.style.height).toBe('56px');
    // After the dialog's focus trap has handed the focus back to what opened the tour.
    expect(document.activeElement).not.toBe(composer);
    tick();
    expect(document.activeElement).toBe(composer);
    expect(onEnd).not.toHaveBeenCalled();

    const shown = ring();
    if (!shown) throw new Error('no ring');
    fireEvent.animationEnd(shown);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('ends by itself where the pulse never reports its end', () => {
    addComposer();
    render(<TourHandoff onEnd={onEnd} />);
    tick(HANDOFF_LENGTH_MS - 1);
    expect(onEnd).not.toHaveBeenCalled();
    tick(1);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('leaves the focus alone on a touch screen, where it would raise the keyboard', () => {
    mockMedia({ touch: true });
    const composer = addComposer();
    render(<TourHandoff onEnd={onEnd} />);
    tick();
    expect(ring()).toBeTruthy();
    expect(document.activeElement).not.toBe(composer);
  });

  it('gives the focus without a pulse with reduced motion', () => {
    mockMedia({ reducedMotion: true });
    const composer = addComposer();
    render(<TourHandoff onEnd={onEnd} />);
    expect(ring()).toBeNull();
    tick();
    expect(document.activeElement).toBe(composer);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('does nothing without a room on the page', () => {
    const other = document.body.appendChild(document.createElement('button'));
    other.focus();
    render(<TourHandoff onEnd={onEnd} />);
    tick(HANDOFF_LENGTH_MS);
    expect(ring()).toBeNull();
    expect(document.activeElement).toBe(other);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('gives up the focus it has not given yet when it is taken away', () => {
    const composer = addComposer();
    const { unmount } = render(<TourHandoff onEnd={onEnd} />);
    unmount();
    tick(HANDOFF_LENGTH_MS);
    expect(document.activeElement).not.toBe(composer);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
