import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JumpToLatestAction } from './RoomTimelineOverlays';

vi.mock('./RoomTimeline.css', () => ({
  ExpandAllToggle: 'ExpandAllToggle',
  FloatingAction: 'FloatingAction',
  JumpToLatestButton: 'JumpToLatestButton',
  JumpToLatestFloat: 'JumpToLatestFloat',
  JumpToLatestLabel: 'JumpToLatestLabel',
  TimelineFloat: () => 'TimelineFloat',
}));

describe('JumpToLatestAction', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('renders the dock-sharing classes, data attribute, title, and no inline bottom style', () => {
    act(() => {
      renderer = create(<JumpToLatestAction onSelect={vi.fn()} />);
    });
    const container = renderer!.root.findByProps({ 'data-jump-to-latest': '' });
    expect(container.props.className).toBe('TimelineFloat JumpToLatestFloat');
    expect(container.props.style).toBeUndefined();

    const button = renderer!.root.findByType('button');
    expect(button.props.className).toContain('FloatingAction');
    expect(button.props.className).toContain('JumpToLatestButton');
    expect(button.props.title).toBe('Jump to Latest');

    const label = renderer!.root.findByType('span');
    expect(label.props.className).toContain('JumpToLatestLabel');
    expect(label.props.children).toBe('Jump to Latest');
  });
});
