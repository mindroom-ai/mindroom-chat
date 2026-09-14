import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import type { ThreadPaginationRequest } from './session/threadSessionTypes';
import {
  useThreadBackPaginationController,
  type ThreadBackPaginationController,
} from './threadBackPaginationController';

const request: ThreadPaginationRequest = {
  lease: { roomId: '!room:test', threadId: '$thread', generation: 0 },
  direction: 'backward',
  requestId: 1,
};

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
      expect(getController().begin(request, scrollRoot)).toBe(true);
    });

    expect(getController().owns(request)).toBe(true);
    expect(getController().isOpenBottomPinSuppressed()).toBe(true);

    renderer.unmount();
  });

  it('exposes the pending anchor event id and seq until cleared or reset', () => {
    const { getController, renderer } = renderController();
    const anchor = makeMessageElement('$anchor', 140, 180);
    const scrollRoot = makeScrollRoot([anchor]);

    expect(getController().getPendingAnchorEventId()).toBeUndefined();

    act(() => {
      getController().begin(request, scrollRoot, 200);
    });

    expect(getController().getPendingAnchorEventId()).toBe('$anchor');
    const firstSeq = getController().getPendingAnchorSeq();
    expect(typeof firstSeq).toBe('number');

    act(() => {
      getController().reset();
    });

    expect(getController().getPendingAnchorEventId()).toBeUndefined();

    act(() => {
      getController().begin(request, scrollRoot, 200);
    });

    // A fresh begin issues a NEW seq: the render-time ledger fold keys on
    // it to own exactly one pagination's prepend.
    expect(getController().getPendingAnchorEventId()).toBe('$anchor');
    expect(getController().getPendingAnchorSeq()).not.toBe(firstSeq);

    act(() => {
      getController().clearPendingAnchor();
    });

    expect(getController().getPendingAnchorEventId()).toBeUndefined();

    renderer.unmount();
  });

  it('clears the pending anchor on demand without changing capture ownership', () => {
    const { getController, renderer } = renderController();
    const anchor = makeMessageElement('$anchor', 140, 180);
    const scrollRoot = makeScrollRoot([anchor]);

    act(() => {
      getController().begin(request, scrollRoot, 200);
    });
    expect(getController().getPendingAnchorEventId()).toBe('$anchor');

    act(() => {
      getController().clearPendingAnchor();
    });

    expect(getController().getPendingAnchorEventId()).toBeUndefined();
    expect(getController().owns(request)).toBe(true);

    renderer.unmount();
  });

  it('finishes failed pagination by clearing its pending anchor', () => {
    const { getController, renderer } = renderController();
    const anchor = makeMessageElement('$anchor', 140, 180);
    const scrollRoot = makeScrollRoot([anchor]);

    act(() => {
      getController().begin(request, scrollRoot);
      getController().finish(request, false);
    });

    expect(getController().getPendingAnchorEventId()).toBeUndefined();

    renderer.unmount();
  });
});

describe('prepend capture request fencing', () => {
  it('refuses duplicate begin without clearing or replacing the active capture', () => {
    const { getController, renderer } = renderController();
    const first = makeScrollRoot([makeMessageElement('$first', 140, 180)]);
    const replacement = makeScrollRoot([makeMessageElement('$replacement', 140, 180)]);
    getController().begin(request, first);
    const seq = getController().getPendingAnchorSeq();
    expect(getController().begin({ ...request, requestId: 2 }, replacement)).toBe(false);
    expect(getController().getPendingAnchorEventId()).toBe('$first');
    expect(getController().getPendingAnchorSeq()).toBe(seq);
    renderer.unmount();
  });
  it('old clear, finish, and recapture cannot affect replacement capture with a reused thread ID', () => {
    const { getController, renderer } = renderController();
    const first = makeScrollRoot([makeMessageElement('$first', 140, 180)]);
    const replacement = makeScrollRoot([makeMessageElement('$replacement', 140, 180)]);
    getController().begin(request, first);
    getController().reset();
    const next = { ...request, requestId: 2, lease: { ...request.lease, generation: 2 } };
    getController().begin(next, replacement);
    getController().clear(request);
    getController().finish(request, false);
    expect(getController().recaptureAnchor(request, first)).toBe(false);
    expect(getController().owns(next)).toBe(true);
    expect(getController().getPendingAnchorEventId()).toBe('$replacement');
    expect(getController().recaptureAnchor(next, replacement)).toBe(true);
    renderer.unmount();
  });
  it('successful finish retains capture for ledger consumption and permits the next begin', () => {
    const { getController, renderer } = renderController();
    const root = makeScrollRoot([makeMessageElement('$anchor', 140, 180)]);
    getController().begin(request, root);
    const seq = getController().getPendingAnchorSeq();
    getController().finish(request, true);
    expect(getController().getPendingAnchorEventId()).toBe('$anchor');
    expect(getController().begin({ ...request, requestId: 2 }, root)).toBe(true);
    expect(getController().getPendingAnchorSeq()).not.toBe(seq);
    renderer.unmount();
  });
});
