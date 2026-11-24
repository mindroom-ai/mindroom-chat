import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as overlay from '../ui/styles/RoomOverlay.css';
import { JumpToLatestAction } from './RoomTimelineOverlays';

vi.mock('./RoomTimeline.css', () => ({
  ExpandAllToggle: 'ExpandAllToggle',
  FloatingAction: 'FloatingAction',
  TimelineFloat: () => 'TimelineFloat',
}));

describe('JumpToLatestAction', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('applies overlay.jumpToLatestBottom as its inline bottom style', () => {
    act(() => {
      renderer = create(<JumpToLatestAction onSelect={vi.fn()} />);
    });
    const container = renderer!.root.findByProps({ className: 'TimelineFloat' });
    expect(overlay.jumpToLatestBottom).toContain('max(');
    expect(container.props.style).toEqual({ bottom: overlay.jumpToLatestBottom });
  });
});
