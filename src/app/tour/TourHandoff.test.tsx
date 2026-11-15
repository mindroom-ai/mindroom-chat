// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockMedia, restoreMedia } from './__tests__/media';
import { HANDOFF_LENGTH_MS, TourHandoff } from './TourHandoff';

const onEnd = vi.fn();

/**
 * Puts a composer on the page, as `ConversationLayout` and the editor mark it: a room's own, or
 * an open thread's.
 */
const addComposer = (of: 'room' | 'thread' = 'room', parent: HTMLElement = document.body) => {
  const footer = parent.appendChild(document.createElement('div'));
  footer.setAttribute('data-room-footer', 'true');
  footer.setAttribute('data-footer-of', of);
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

  it("passes over an open thread's composer for the room's, beside the thread", () => {
    const reply = addComposer('thread');
    const composer = addComposer('room');
    render(<TourHandoff onEnd={onEnd} />);
    tick();
    expect(document.activeElement).toBe(composer);
    expect(document.activeElement).not.toBe(reply);
    expect(ring()).not.toBeNull();
  });

  it('does nothing while a thread fills the page, where typing would reply to it', () => {
    // The room's conversation is under the thread, inert, composer and all.
    const area = document.body.appendChild(document.createElement('div'));
    area.setAttribute('inert', '');
    const covered = addComposer('room', area);
    const reply = addComposer('thread');
    render(<TourHandoff onEnd={onEnd} />);
    tick(HANDOFF_LENGTH_MS);
    expect(ring()).toBeNull();
    expect(document.activeElement).not.toBe(covered);
    expect(document.activeElement).not.toBe(reply);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('does nothing under a dialog that was open under the tour', () => {
    // The command palette opens the tour over Settings, which is still there after Done.
    const composer = addComposer();
    const settings = document.body.appendChild(document.createElement('div'));
    settings.setAttribute('role', 'dialog');
    render(<TourHandoff onEnd={onEnd} />);
    tick(HANDOFF_LENGTH_MS);
    expect(ring()).toBeNull();
    expect(document.activeElement).not.toBe(composer);
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
