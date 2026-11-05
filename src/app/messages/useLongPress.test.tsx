// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS, useLongPress } from './useLongPress';

function Row({
  onLongPress,
  canStart = () => true,
}: {
  onLongPress: (x: number, y: number) => void;
  canStart?: () => boolean;
}) {
  const handlers = useLongPress(onLongPress, canStart);
  return <div {...handlers}>text</div>;
}

const finger = (x: number, y: number) => ({ clientX: x, clientY: y, identifier: 1 });

describe('useLongPress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const setup = (canStart?: () => boolean) => {
    const onLongPress = vi.fn();
    const view = render(<Row onLongPress={onLongPress} canStart={canStart} />);
    return { onLongPress, row: view.container.firstElementChild as HTMLElement, view };
  };

  it('fires at the resting point after the delay, and the lift does not click', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, { touches: [finger(40, 60)] });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    });
    expect(onLongPress).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onLongPress).toHaveBeenCalledWith(40, 60);
    // fireEvent answers false when a handler prevented the default.
    expect(fireEvent.touchEnd(row, { touches: [] })).toBe(false);
  });

  it('lets a short tap end normally', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, { touches: [finger(40, 60)] });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(fireEvent.touchEnd(row, { touches: [] })).toBe(true);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('keeps a press through a small drift and cancels it past 10 px', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, { touches: [finger(40, 60)] });
    fireEvent.touchMove(row, { touches: [finger(46, 66)] });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);

    fireEvent.touchEnd(row, { touches: [] });
    fireEvent.touchStart(row, { touches: [finger(40, 60)] });
    fireEvent.touchMove(row, { touches: [finger(40, 71)] });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('cancels on a scroll, a second finger, a cancelled touch or a refused start', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, { touches: [finger(40, 60)] });
    act(() => {
      document.body.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onLongPress).not.toHaveBeenCalled();

    fireEvent.touchStart(row, { touches: [finger(40, 60)] });
    fireEvent.touchMove(row, { touches: [finger(40, 60), finger(90, 90)] });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onLongPress).not.toHaveBeenCalled();

    fireEvent.touchStart(row, { touches: [finger(40, 60)] });
    fireEvent.touchCancel(row, { touches: [] });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onLongPress).not.toHaveBeenCalled();

    const refused = setup(() => false);
    fireEvent.touchStart(refused.row, { touches: [finger(40, 60)] });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(refused.onLongPress).not.toHaveBeenCalled();
  });

  it('stops its timer when the row unmounts mid-press', () => {
    const { onLongPress, row, view } = setup();
    fireEvent.touchStart(row, { touches: [finger(40, 60)] });
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
