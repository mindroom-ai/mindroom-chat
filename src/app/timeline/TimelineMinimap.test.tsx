// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TimelineMinimap } from './TimelineMinimap';

afterEach(cleanup);

describe('TimelineMinimap', () => {
  it('jumps on a plain Space or Enter, never on a chord or a key another listener took', () => {
    const onSelect = vi.fn();
    const items = ['$a', '$b'].map((id) => ({ id, userText: id, agentText: null }));
    render(<TimelineMinimap items={items} stripMap={new Map()} onSelect={onSelect} />);
    const rail = screen.getByRole('slider');
    fireEvent.focus(rail);
    fireEvent.keyDown(rail, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(rail, { key: 'Enter', code: 'Enter', metaKey: true });
    const taken = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener('keydown', taken, true);
    fireEvent.keyDown(rail, { key: ' ', code: 'Space' });
    window.removeEventListener('keydown', taken, true);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(rail, { key: ' ', code: 'Space' });
    fireEvent.keyDown(rail, { key: 'Enter', code: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });
});
