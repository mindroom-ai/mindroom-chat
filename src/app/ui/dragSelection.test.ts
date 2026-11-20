// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { blockSelection } from './dragSelection';

const blocked = () => document.documentElement.hasAttribute('data-drag-no-select');
const selectStartPrevented = () =>
  !document.body.dispatchEvent(new Event('selectstart', { cancelable: true }));

describe('blockSelection', () => {
  it('blocks a new selection until it is lifted, and keeps the one there was', () => {
    document.body.textContent = 'Example text';
    window.getSelection()!.selectAllChildren(document.body);
    const unblock = blockSelection();
    expect(window.getSelection()!.toString()).toBe('Example text');
    expect(selectStartPrevented()).toBe(true);
    // No style hides the kept selection's highlight.
    expect(blocked()).toBe(false);
    unblock();
    expect(blocked()).toBe(false);
    expect(selectStartPrevented()).toBe(false);
    expect(window.getSelection()!.toString()).toBe('Example text');
  });

  it('holds until the last holder lets go, each once', () => {
    window.getSelection()!.removeAllRanges();
    const first = blockSelection();
    const second = blockSelection();
    first();
    first();
    expect(blocked()).toBe(true);
    second();
    expect(blocked()).toBe(false);
  });

  it('lets go of every hold when the page is left, ending each drag once', () => {
    window.getSelection()!.removeAllRanges();
    const ends = [vi.fn(), vi.fn()];
    const releases = ends.map((end) => blockSelection(end));
    window.dispatchEvent(new Event('pagehide'));
    expect(blocked()).toBe(false);
    expect(ends.map((end) => end.mock.calls.length)).toEqual([1, 1]);
    // A drag's own end after that changes nothing, and the next drag blocks again.
    releases.forEach((release) => release());
    window.dispatchEvent(new Event('pagehide'));
    expect(ends.map((end) => end.mock.calls.length)).toEqual([1, 1]);
    const next = blockSelection();
    expect(blocked()).toBe(true);
    next();
  });
});
