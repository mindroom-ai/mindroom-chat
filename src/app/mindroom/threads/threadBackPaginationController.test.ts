import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import {
  useThreadBackPaginationController,
  type ThreadBackPaginationController,
} from './threadBackPaginationController';

type HarnessProps = {
  onRender: (controller: ThreadBackPaginationController) => void;
};

function Harness({ onRender }: HarnessProps) {
  onRender(useThreadBackPaginationController());
  return null;
}

const renderController = (): {
  getController: () => ThreadBackPaginationController;
  renderer: ReactTestRenderer;
} => {
  let controller: ThreadBackPaginationController | undefined;
  let renderer: ReactTestRenderer | undefined;

  act(() => {
    renderer = create(
      React.createElement(Harness, {
        onRender: (nextController) => {
          controller = nextController;
        },
      })
    );
  });

  return {
    getController: () => controller as ThreadBackPaginationController,
    renderer: renderer as ReactTestRenderer,
  };
};

const makeMessageElement = (eventId: string, top: number, bottom: number): HTMLElement =>
  ({
    getAttribute: (name: string) => (name === 'data-message-id' ? eventId : null),
    getBoundingClientRect: () => ({ top, bottom }),
    parentElement: null,
  } as unknown as HTMLElement);

const makeScrollRoot = (messages: HTMLElement[]): HTMLElement =>
  ({
    getBoundingClientRect: () => ({
      top: 100,
      bottom: 500,
    }),
    querySelector: () => messages[0],
    querySelectorAll: () => messages,
    scrollHeight: 1000,
    clientHeight: 400,
    scrollTop: 40,
  } as unknown as HTMLElement);

describe('useThreadBackPaginationController', () => {
  it('begins back pagination by capturing the visible anchor and suppressing open-bottom pinning', () => {
    const { getController, renderer } = renderController();
    const above = makeMessageElement('$above', 40, 90);
    const anchor = makeMessageElement('$anchor', 140, 180);
    const scrollRoot = makeScrollRoot([above, anchor]);

    act(() => {
      expect(getController().begin('$thread', scrollRoot)).toBe(true);
    });

    expect(getController().isPaginatingBack).toBe(true);
    expect(getController().isPaginatingBackRef.current).toBe(true);
    expect(getController().suppressOpenBottomPinRef.current).toBe(true);

    renderer.unmount();
  });

  it('restores the pending anchor exactly once for the matching thread', () => {
    const { getController, renderer } = renderController();
    const anchor = makeMessageElement('$anchor', 140, 180);
    const scrollRoot = makeScrollRoot([anchor]);

    act(() => {
      getController().begin('$thread', scrollRoot);
    });

    const shiftedAnchor = makeMessageElement('$anchor', 420, 460);
    const shiftedScrollRoot = makeScrollRoot([shiftedAnchor]);
    act(() => {
      expect(getController().restorePendingAnchor(shiftedScrollRoot, '$thread')).toBe(true);
    });

    expect(shiftedScrollRoot.scrollTop).toBe(320);
    expect(getController().restorePendingAnchor(shiftedScrollRoot, '$thread')).toBe(false);

    renderer.unmount();
  });

  it('keeps the pending anchor when the first restore runs before the anchor is mounted', () => {
    const { getController, renderer } = renderController();
    const anchor = makeMessageElement('$anchor', 140, 180);
    const scrollRoot = makeScrollRoot([anchor]);

    act(() => {
      getController().begin('$thread', scrollRoot);
    });

    expect(getController().restorePendingAnchor(makeScrollRoot([]), '$thread')).toBe(false);

    const shiftedAnchor = makeMessageElement('$anchor', 420, 460);
    const shiftedScrollRoot = makeScrollRoot([shiftedAnchor]);
    expect(getController().restorePendingAnchor(shiftedScrollRoot, '$thread')).toBe(true);
    expect(shiftedScrollRoot.scrollTop).toBe(320);
    expect(getController().restorePendingAnchor(shiftedScrollRoot, '$thread')).toBe(false);

    renderer.unmount();
  });

  it('keeps the pending anchor when restore runs before prepended events are rendered', () => {
    const { getController, renderer } = renderController();
    const anchor = makeMessageElement('$anchor', 140, 180);
    const scrollRoot = makeScrollRoot([anchor]);

    act(() => {
      getController().begin('$thread', scrollRoot, 200);
    });

    expect(getController().restorePendingAnchor(makeScrollRoot([anchor]), '$thread', 200)).toBe(
      false
    );

    const shiftedAnchor = makeMessageElement('$anchor', 420, 460);
    const shiftedScrollRoot = makeScrollRoot([shiftedAnchor]);
    expect(getController().restorePendingAnchor(shiftedScrollRoot, '$thread', 400)).toBe(true);
    expect(shiftedScrollRoot.scrollTop).toBe(320);
    expect(getController().restorePendingAnchor(shiftedScrollRoot, '$thread', 400)).toBe(false);

    renderer.unmount();
  });

  it('exposes the pending anchor event id until restore or reset clears it', () => {
    const { getController, renderer } = renderController();
    const anchor = makeMessageElement('$anchor', 140, 180);
    const scrollRoot = makeScrollRoot([anchor]);

    expect(getController().getPendingAnchorEventId()).toBeUndefined();

    act(() => {
      getController().begin('$thread', scrollRoot, 200);
    });

    expect(getController().getPendingAnchorEventId()).toBe('$anchor');

    act(() => {
      getController().reset();
    });

    expect(getController().getPendingAnchorEventId()).toBeUndefined();

    act(() => {
      getController().begin('$thread', scrollRoot, 200);
    });

    expect(getController().getPendingAnchorEventId()).toBe('$anchor');

    const shiftedScrollRoot = makeScrollRoot([makeMessageElement('$anchor', 420, 460)]);
    act(() => {
      expect(getController().restorePendingAnchor(shiftedScrollRoot, '$thread', 400)).toBe(true);
    });

    expect(getController().getPendingAnchorEventId()).toBeUndefined();

    renderer.unmount();
  });

  it('exposes the captured client top of the pending anchor for the coarse restore target', () => {
    const { getController, renderer } = renderController();
    // First row intersecting the viewport (viewport top = 100): partially
    // scrolled off above, the common capture geometry — the coarse restore
    // must reproduce this exact viewport offset, not align to the top.
    const anchor = makeMessageElement('$anchor', -448, 148);
    const scrollRoot = makeScrollRoot([anchor]);

    expect(getController().getPendingAnchorClientTop()).toBeUndefined();

    act(() => {
      getController().begin('$thread', scrollRoot, 200);
    });

    expect(getController().getPendingAnchorClientTop()).toBe(-448);

    act(() => {
      getController().clearPendingAnchor();
    });

    expect(getController().getPendingAnchorClientTop()).toBeUndefined();

    renderer.unmount();
  });

  it('clears the pending anchor on demand without touching pagination state', () => {
    const { getController, renderer } = renderController();
    const anchor = makeMessageElement('$anchor', 140, 180);
    const scrollRoot = makeScrollRoot([anchor]);

    act(() => {
      getController().begin('$thread', scrollRoot, 200);
    });
    expect(getController().getPendingAnchorEventId()).toBe('$anchor');

    act(() => {
      getController().clearPendingAnchor();
    });

    expect(getController().getPendingAnchorEventId()).toBeUndefined();
    expect(getController().isPaginatingBackRef.current).toBe(true);

    renderer.unmount();
  });

  it('finishes failed pagination by clearing the paginating flag and pending anchor', () => {
    const { getController, renderer } = renderController();
    const anchor = makeMessageElement('$anchor', 140, 180);
    const scrollRoot = makeScrollRoot([anchor]);

    act(() => {
      getController().begin('$thread', scrollRoot);
      getController().finish({
        didPaginateBack: false,
        threadId: '$thread',
        currentThreadId: '$thread',
      });
    });

    expect(getController().isPaginatingBack).toBe(false);
    expect(getController().isPaginatingBackRef.current).toBe(false);
    expect(getController().restorePendingAnchor(scrollRoot, '$thread')).toBe(false);

    renderer.unmount();
  });
});
