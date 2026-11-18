// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnBreak } from './TurnBreak';

vi.mock('./TurnBreak.css', () => ({
  TurnBreak: 'TurnBreak',
  Line: 'Line',
  Pill: 'Pill',
  Dots: 'Dots',
}));

describe('TurnBreak', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const render = (count: number, open: boolean, onToggle = vi.fn()) => {
    act(() => {
      renderer = create(<TurnBreak count={count} open={open} onToggle={onToggle} />);
    });
    return renderer!.root.findByType('button');
  };
  // The words a screen reader reads: the dots are hidden from it.
  const spoken = (button: ReturnType<typeof render>) =>
    button.children
      .map((child) =>
        typeof child === 'string' ? child : child.props['aria-hidden'] ? '' : child.children
      )
      .join('');

  it('counts the folded messages between dots a screen reader skips', () => {
    const button = render(5, false);
    expect(spoken(button)).toBe('5 earlier messages');
    expect(button.findAllByProps({ className: 'Dots' })).toHaveLength(2);
    expect(button.props['aria-expanded']).toBe(false);
    expect(button.props.type).toBe('button');
  });

  it('offers to hide them once open', () => {
    const button = render(5, true);
    expect(spoken(button)).toBe('Hide 5 messages');
    expect(button.props['aria-expanded']).toBe(true);
  });

  it('says one message in the singular', () => {
    expect(spoken(render(1, false))).toBe('1 earlier message');
    expect(spoken(render(1, true))).toBe('Hide 1 message');
  });

  it('toggles on a click', () => {
    const onToggle = vi.fn();
    const button = render(3, false, onToggle);
    act(() => {
      button.props.onClick();
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('draws a line on each side of the pill', () => {
    render(2, false);
    expect(renderer!.root.findAllByProps({ className: 'Line' })).toHaveLength(2);
  });
});
