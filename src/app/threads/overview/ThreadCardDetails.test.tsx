// @vitest-environment jsdom
import { useRef, type ComponentProps, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import type { RegisteredPlugin } from '../../plugins/registry';
import type { ThreadDetail, ThreadDetailProps } from '../../plugins/threadDetails';
import {
  ThreadCardDetails,
  THREAD_CARD_DETAILS_DELAY_MS,
  HOVER_POINTER_QUERY,
} from './ThreadCardDetails';

const { popOut } = vi.hoisted(() => ({ popOut: vi.fn() }));
vi.mock('../../ui/directional', () => ({
  PopOut: (props: {
    anchor?: object;
    content: ReactNode;
    'data-thread-card-details'?: string;
    'aria-hidden'?: 'true';
    style?: React.CSSProperties;
  }) => {
    popOut(props);
    return props.anchor ? (
      <div
        data-layer
        data-thread-card-details={props['data-thread-card-details']}
        aria-hidden={props['aria-hidden']}
        style={props.style}
      >
        {props.content}
      </div>
    ) : null;
  },
}));
vi.mock('../../bug-reports/error-reporting/errorReporting', () => ({
  reportBoundaryError: vi.fn(),
}));

const room = { roomId: '!room:example.org' } as Room;
const Named = ({ threadId }: ThreadDetailProps) => <span>Details of {threadId}</span>;
const Broken = (): never => {
  throw new Error('boom');
};
const plugin = (threadDetails: ThreadDetail[]): RegisteredPlugin => ({
  id: 'test',
  tag: 'test@1.0.0',
  conversationCovers: [],
  messageRenderers: [],
  pages: [],
  roomHeaderSlot: [],
  sidePanels: [],
  headerActions: [],
  slashCommands: [],
  roomActions: [],
  messageLinks: [],
  threadCardBadges: [],
  threadDetails,
});
const defaults = [plugin([{ Component: Named }])];

type HarnessProps = Partial<Omit<ComponentProps<typeof ThreadCardDetails>, 'listRef'>> & {
  config?: ClientConfig;
  withoutA?: boolean;
};
function Harness({ config = {}, withoutA = false, ...props }: HarnessProps) {
  const listRef = useRef<HTMLDivElement>(null);
  return (
    <ClientConfigProvider value={config}>
      <div ref={listRef} data-testid="list">
        {!withoutA && (
          <div data-scroll-anchor="$a">
            <span data-testid="a">A</span>
            <button type="button" data-testid="a-menu">
              More Options
            </button>
          </div>
        )}
        <div data-scroll-anchor="$b">
          <span data-testid="b">B</span>
        </div>
        <div data-scroll-anchor="~local" data-testid="local" />
        <div data-testid="gap" />
      </div>
      <ThreadCardDetails
        room={room}
        menuOpen={false}
        plugins={defaults}
        {...props}
        listRef={listRef}
      />
    </ClientConfigProvider>
  );
}
function point(target: Element, type = 'pointermove', x = 40, y = 50, pointerType = 'mouse') {
  act(() => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    target.dispatchEvent(event);
  });
}
const advance = (ms = THREAD_CARD_DETAILS_DELAY_MS): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const shown = () => document.querySelector<HTMLElement>('[data-thread-card-details]');
const scroll = (): void => {
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
};
const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
let hover: boolean;
beforeEach(() => {
  vi.useFakeTimers();
  hover = true;
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: hover, media: query }));
  vi.stubGlobal('innerHeight', 768);
  popOut.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalHitTest) Object.defineProperty(document, 'elementFromPoint', originalHitTest);
  else Reflect.deleteProperty(document, 'elementFromPoint');
});

describe('ThreadCardDetails', () => {
  it('opens at the pointer once it has rested 500 ms on a card, and moving within the card does not restart the wait', () => {
    expect(THREAD_CARD_DETAILS_DELAY_MS).toBe(500);
    expect(HOVER_POINTER_QUERY).toBe('(hover: hover) and (pointer: fine)');
    const { getByTestId } = render(<Harness />);
    point(getByTestId('a'));
    advance(300);
    point(getByTestId('a'), 'pointermove', 60, 55);
    advance(199);
    expect(shown()).toBeNull();
    advance(1);
    expect(shown()?.textContent).toBe('Details of $a');
    expect(shown()?.getAttribute('aria-hidden')).toBe('true');
    expect(shown()?.style.pointerEvents).toBe('none');
    expect(popOut).toHaveBeenLastCalledWith(
      expect.objectContaining({
        anchor: { x: 60, y: 55, width: 0, height: 0 },
        position: 'Bottom',
        align: 'Start',
        offset: 16,
      })
    );
    point(getByTestId('a'), 'pointermove', 80, 90);
    expect(popOut).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchor: { x: 60, y: 55, width: 0, height: 0 } })
    );
  });
  it('opens above the pointer in the lower half of the window', () => {
    const { getByTestId } = render(<Harness />);
    point(getByTestId('a'), 'pointermove', 40, 600);
    advance();
    expect(popOut).toHaveBeenLastCalledWith(expect.objectContaining({ position: 'Top' }));
  });
  it('stays closed without a detail that shows, for a disabled plugin, and on a card whose root is still sending', () => {
    const shows = vi.fn(() => false);
    const plugins = [plugin([{ Component: Named, shows }])];
    const { getByTestId, rerender } = render(<Harness plugins={plugins} />);
    point(getByTestId('a'));
    advance();
    expect(shown()).toBeNull();
    point(getByTestId('a'));
    advance(1000);
    expect(shows).toHaveBeenCalledTimes(1);
    rerender(<Harness config={{ plugins: { test: { enabled: false } } } as ClientConfig} />);
    point(getByTestId('b'));
    advance();
    expect(shown()).toBeNull();
    rerender(<Harness />);
    point(getByTestId('local'));
    advance();
    expect(shown()).toBeNull();
  });
  it('closes when the pointer leaves the card, and the next card opens after its own wait', () => {
    const { getByTestId } = render(<Harness />);
    point(getByTestId('a'));
    advance();
    expect(shown()).not.toBeNull();
    point(getByTestId('b'));
    expect(shown()).toBeNull();
    advance(499);
    expect(shown()).toBeNull();
    advance(1);
    expect(shown()?.textContent).toBe('Details of $b');
    point(getByTestId('gap'));
    expect(shown()).toBeNull();
    point(getByTestId('a'));
    advance(100);
    point(getByTestId('list'), 'pointerleave');
    advance();
    expect(shown()).toBeNull();
    point(getByTestId('a'));
    advance();
    expect(shown()).not.toBeNull();
    point(getByTestId('list'), 'pointerleave');
    expect(shown()).toBeNull();
  });
  it.each(['pointerdown', 'click', 'scroll'])(
    'closes on a %s and opens again only after the pointer left the card',
    (type) => {
      const { getByTestId } = render(<Harness />);
      let hit = getByTestId('a');
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => hit });
      const dismiss = () => {
        if (type !== 'scroll') return point(getByTestId('a'), type);
        // The scroll moves the pointer off the card, and the pointer comes back by moving.
        hit = getByTestId('gap');
        scroll();
        hit = getByTestId('a');
      };
      point(getByTestId('a'));
      advance();
      dismiss();
      expect(shown()).toBeNull();
      point(getByTestId('a'));
      advance(1000);
      expect(shown()).toBeNull();
      point(getByTestId('b'));
      point(getByTestId('a'));
      advance();
      expect(shown()).not.toBeNull();
      point(getByTestId('gap'));
      point(getByTestId('a'));
      advance(200);
      dismiss();
      advance();
      expect(shown()).toBeNull();
    }
  );
  it.each(['pointerdown', 'click'])(
    'dismisses the card receiving %s before any eligible pointermove',
    (type) => {
      const { getByTestId } = render(<Harness />);
      point(getByTestId('b'), type);
      point(getByTestId('b'));
      advance(1000);
      expect(shown()).toBeNull();
      point(getByTestId('gap'));
      point(getByTestId('b'));
      advance();
      expect(shown()?.textContent).toBe('Details of $b');
    }
  );
  it.each(['pointerdown', 'click'])(
    'dismisses the card receiving %s after scrolling changed the card under the pointer',
    (type) => {
      const { getByTestId } = render(<Harness />);
      point(getByTestId('a'));
      advance();
      expect(shown()?.textContent).toBe('Details of $a');
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: () => getByTestId('b'),
      });
      scroll();
      expect(shown()).toBeNull();
      point(getByTestId('b'), type);
      point(getByTestId('b'), 'pointermove', 41, 51);
      advance(1000);
      expect(shown()).toBeNull();
      point(getByTestId('gap'));
      point(getByTestId('b'));
      advance();
      expect(shown()?.textContent).toBe('Details of $b');
    }
  );
  it.each(['open', 'waiting'])(
    'dismisses on a wheel while %s until the pointer leaves the card',
    (state) => {
      const { getByTestId } = render(<Harness />);
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: () => getByTestId('a'),
      });
      point(getByTestId('a'));
      advance(state === 'open' ? THREAD_CARD_DETAILS_DELAY_MS : 200);
      if (state === 'open') expect(shown()?.textContent).toBe('Details of $a');
      else expect(shown()).toBeNull();
      act(() => {
        getByTestId('a').dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 10 }));
      });
      expect(shown()).toBeNull();
      advance(1000);
      expect(shown()).toBeNull();
      point(getByTestId('a'), 'pointermove', 41, 51);
      advance(1000);
      expect(shown()).toBeNull();
      point(getByTestId('gap'));
      point(getByTestId('a'));
      advance();
      expect(shown()?.textContent).toBe('Details of $a');
    }
  );
  it('keeps the hover card and the pending wait on a scroll while the same card stays under the pointer', () => {
    const { getByTestId } = render(<Harness />);
    const hit = vi.fn(() => getByTestId('a'));
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
    point(getByTestId('a'));
    advance(300);
    scroll();
    advance(200);
    expect(shown()?.textContent).toBe('Details of $a');
    scroll();
    expect(shown()?.textContent).toBe('Details of $a');
    expect(hit).toHaveBeenLastCalledWith(40, 50);
  });
  it('ignores a touch pointer and a page without a fine hovering pointer', () => {
    const { getByTestId } = render(<Harness />);
    point(getByTestId('a'), 'pointermove', 40, 50, 'touch');
    advance();
    expect(shown()).toBeNull();
    hover = false;
    point(getByTestId('a'));
    advance();
    expect(shown()).toBeNull();
    vi.stubGlobal('matchMedia', undefined);
    point(getByTestId('a'));
    advance();
    expect(shown()).toBeNull();
  });
  it('opens nothing while a thread menu is open or after the room changed during the wait', () => {
    const { getByTestId, rerender } = render(<Harness menuOpen />);
    point(getByTestId('a'));
    advance();
    expect(shown()).toBeNull();
    rerender(<Harness />);
    point(getByTestId('b'));
    advance();
    expect(shown()).not.toBeNull();
    rerender(<Harness menuOpen />);
    expect(shown()).toBeNull();
    rerender(<Harness />);
    point(getByTestId('a'));
    advance(200);
    rerender(<Harness room={{ roomId: '!other:example.org' } as Room} />);
    advance();
    expect(shown()).toBeNull();
  });
  it('keeps the pressed card dismissed after its menu opens and closes with Escape', () => {
    const { getByTestId, rerender } = render(<Harness />);
    point(getByTestId('a'));
    advance();
    expect(shown()?.textContent).toBe('Details of $a');
    point(getByTestId('a-menu'), 'pointerdown');
    point(getByTestId('a-menu'), 'click');
    expect(shown()).toBeNull();
    rerender(<Harness menuOpen />);
    expect(shown()).toBeNull();
    // The menu owner clears menuOpen when Escape closes it.
    rerender(<Harness menuOpen={false} />);
    point(getByTestId('a'), 'pointermove', 41, 51);
    advance(1000);
    expect(shown()).toBeNull();
    point(getByTestId('gap'));
    point(getByTestId('a'));
    advance(499);
    expect(shown()).toBeNull();
    advance(1);
    expect(shown()?.textContent).toBe('Details of $a');
  });
  it('cancels a pending wait when the thread menu opens', () => {
    const { getByTestId, rerender } = render(<Harness />);
    point(getByTestId('a'));
    advance(200);
    rerender(<Harness menuOpen />);
    advance();
    expect(shown()).toBeNull();
    rerender(<Harness />);
    advance();
    expect(shown()).toBeNull();
  });
  it('reads the latest room object, plugins and config when the wait ends', () => {
    const shows = vi.fn(() => true);
    const plugins = [plugin([{ Component: Named, shows }])];
    const { getByTestId, rerender } = render(<Harness plugins={[]} />);
    point(getByTestId('a'));
    advance(300);
    const updatedRoom = { roomId: room.roomId } as Room;
    rerender(<Harness room={updatedRoom} plugins={plugins} />);
    advance(200);
    expect(shown()?.textContent).toBe('Details of $a');
    expect(shows).toHaveBeenCalledWith(updatedRoom, '$a');
    point(getByTestId('b'));
    advance(300);
    rerender(
      <Harness
        plugins={plugins}
        config={{ plugins: { test: { enabled: false } } } as ClientConfig}
      />
    );
    advance(200);
    expect(shown()).toBeNull();
  });
  it.each(['missing', 'empty', 'other card'])(
    'dismisses on scroll when the hit test is %s',
    (hit) => {
      const { getByTestId } = render(<Harness />);
      if (hit !== 'missing')
        Object.defineProperty(document, 'elementFromPoint', {
          configurable: true,
          value: () => (hit === 'empty' ? null : getByTestId('b')),
        });
      point(getByTestId('a'));
      advance();
      scroll();
      expect(shown()).toBeNull();
      point(getByTestId('a'));
      advance();
      expect(shown()).toBeNull();
    }
  );
  it('closes when the hovered card leaves the list without a scroll, as when another device resolves its thread', async () => {
    const { getByTestId, rerender } = render(<Harness />);
    point(getByTestId('a'));
    advance();
    expect(shown()?.textContent).toBe('Details of $a');
    await act(async () => {
      rerender(<Harness withoutA />);
      await Promise.resolve();
    });
    expect(shown()).toBeNull();
  });
  it('opens nothing when the waited-on card left the list and another slid under the pointer', async () => {
    const { getByTestId, rerender } = render(<Harness />);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => getByTestId('b'),
    });
    point(getByTestId('a'));
    advance(200);
    await act(async () => {
      rerender(<Harness withoutA />);
      await Promise.resolve();
    });
    advance(1000);
    expect(shown()).toBeNull();
  });
  it('opens nothing when the wait ends with another card under the pointer', () => {
    const { getByTestId } = render(<Harness />);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => getByTestId('b'),
    });
    point(getByTestId('a'));
    advance(1000);
    expect(shown()).toBeNull();
  });
  it('cancels a pending wait on unmount', () => {
    const shows = vi.fn(() => true);
    const { getByTestId, unmount } = render(
      <Harness plugins={[plugin([{ Component: Named, shows }])]} />
    );
    point(getByTestId('a'));
    advance(200);
    unmount();
    advance();
    expect(shows).not.toHaveBeenCalled();
    expect(shown()).toBeNull();
  });
  it('keeps the details it opened with, and the others when one throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const shows = vi.fn(() => true);
    const plugins = [plugin([{ Component: Broken }, { Component: Named, shows }])];
    const { getByTestId, rerender } = render(<Harness plugins={plugins} />);
    point(getByTestId('a'));
    advance();
    expect(shown()?.textContent).toBe('Details of $a');
    shows.mockReturnValue(false);
    rerender(<Harness plugins={plugins} />);
    expect(shown()?.textContent).toBe('Details of $a');
    expect(shows).toHaveBeenCalledTimes(1);
  });
});
