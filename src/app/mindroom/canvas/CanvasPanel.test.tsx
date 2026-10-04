// @vitest-environment jsdom

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { EventStatus, MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_SEND_ARM_DELAY_MS, CanvasPanel, type CanvasPanelProps } from './CanvasPanel';
import { CANVAS_RESPONSE_KEY } from './canvasMessages';
import { FALLBACK_CANVAS_THEMES } from './canvasTheme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom does not run the wrapper document, so each panel frame gets a stand-in canvas window.
const canvasWindows = vi.hoisted(() => new WeakMap<object, object>());
vi.mock('./canvasDocument', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./canvasDocument')>();
  return {
    ...actual,
    canvasFrameWindow: (panelFrame: HTMLIFrameElement | null) => {
      if (!panelFrame) return undefined;
      if (!canvasWindows.has(panelFrame)) canvasWindows.set(panelFrame, {});
      return canvasWindows.get(panelFrame);
    },
  };
});

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    fill: _fill,
    variant: _variant,
    size: _size,
    ...props
  }: React.ComponentProps<'button'> & { fill?: string; variant?: string; size?: string }) => (
    <button {...props}>{children}</button>
  ),
  Icon: () => <span />,
  IconButton: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
  Icons: { Cross: 'Cross', Category: 'Category' },
  Text: ({
    children,
    className,
    role,
  }: {
    children?: React.ReactNode;
    className?: string;
    role?: string;
  }) => (
    <span className={className} role={role}>
      {children}
    </span>
  ),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

vi.mock('./CanvasPanel.css.ts', () => ({
  Panel: 'Panel',
  Header: 'Header',
  Title: 'Title',
  Frame: 'Frame',
  Footer: 'Footer',
  Error: 'Error',
  Notice: 'Notice',
  Staged: 'Staged',
  Data: 'Data',
}));

const AGENT = '@mindroom_planner:example.org';
const canvas = {
  eventId: '$canvas',
  revisionEventId: '$canvas',
  agentUserId: AGENT,
  threadId: '$thread',
  title: 'Choose a plan',
  html: '<button>Pro</button>',
};

let container: HTMLDivElement;
let root: Root;
let sendMessage: ReturnType<typeof vi.fn>;
let resendEvent: ReturnType<typeof vi.fn>;
let cancelPendingEvent: ReturnType<typeof vi.fn>;
let pendingEvents: Map<string, MatrixEvent>;
const room = { getEventForTxnId: (txnId: string) => pendingEvents.get(txnId) };
let txn = 0;
const nextTxnId = () => {
  txn += 1;
  return `txn-${txn}`;
};

const render = (props: Partial<CanvasPanelProps> = {}) =>
  act(() => {
    root.render(
      <CanvasPanel
        mx={
          {
            sendMessage,
            resendEvent,
            cancelPendingEvent,
            getRoom: () => room,
            makeTxnId: nextTxnId,
          } as unknown as MatrixClient
        }
        roomId="!room:example.org"
        canvas={canvas}
        agentName="Planner"
        colorScheme="dark"
        theme={{ ...FALLBACK_CANVAS_THEMES.dark, accent: '#123456' }}
        onClose={() => undefined}
        {...props}
      />
    );
  });

const frame = () => container.querySelector('iframe') as HTMLIFrameElement;
const button = (selector: string) => container.querySelector(selector) as HTMLButtonElement;
const canvasWindow = () => {
  if (!canvasWindows.has(frame())) canvasWindows.set(frame(), {});
  return canvasWindows.get(frame());
};
/** The canvas page, which the wrapper document carries as a script string. */
const page = () => {
  const literal = /frame\.srcdoc = ("(?:[^"\\]|\\.)*");/.exec(frame().getAttribute('srcdoc') ?? '');
  return literal ? (JSON.parse(literal[1]) as string) : '';
};
const echo = (txnId: string, status: EventStatus) => {
  const event = new MatrixEvent({ type: 'm.room.message', content: {} });
  event.setTxnId(txnId);
  event.setStatus(status);
  pendingEvents.set(txnId, event);
  return event;
};

const post = async (data: unknown, source: unknown = canvasWindow()) => {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', { data, origin: 'null', source: source as Window })
    );
  });
};

const submit = (label = 'Pro plan', data: unknown = { plan: 'pro' }) => ({
  type: 'mindroom.canvas.submit',
  version: 1,
  data,
  label,
});

const arm = () =>
  act(async () => {
    vi.advanceTimersByTime(CANVAS_SEND_ARM_DELAY_MS);
  });

const clickSend = () =>
  act(async () => {
    button('[data-canvas-send]').click();
  });

const touchFrame = () =>
  act(async () => {
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => frame() });
    window.dispatchEvent(new Event('blur'));
    delete (document as { activeElement?: unknown }).activeElement;
  });

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  sendMessage = vi.fn().mockResolvedValue({ event_id: '$response' });
  // Like the SDK, a resend marks the local echo as sending before it returns.
  resendEvent = vi.fn((event: MatrixEvent) => {
    event.setStatus(EventStatus.SENDING);
    return Promise.resolve({ event_id: '$response' });
  });
  cancelPendingEvent = vi.fn();
  pendingEvents = new Map();
  txn = 0;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('CanvasPanel', () => {
  it('renders agent HTML in an opaque-origin sandbox with provenance and disclosure', () => {
    render();
    const iframe = frame();
    // The panel frame holds a wrapper whose policy keeps the canvas frame from navigating.
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(iframe.getAttribute('allow')).toContain("camera 'none'");
    expect(iframe.getAttribute('srcdoc')).toContain("frame-src 'none'");
    expect(iframe.getAttribute('srcdoc')).toContain(
      "setAttribute('sandbox', 'allow-scripts allow-forms')"
    );
    expect(page()).toContain('<button>Pro</button>');
    expect(page()).toContain('content="dark"');
    expect(container.textContent).toContain('Choose a plan');
    expect(container.textContent).toContain('Interactive panel from Planner');
    expect(container.textContent).toContain('what you enter here may leave this panel');
  });

  it('stages a canvas submission until the user sends it from the host', async () => {
    render();
    await post(submit());
    expect(sendMessage).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Send to Planner: Pro plan');
    expect(container.textContent).toContain('"plan": "pro"');
    expect(button('[data-canvas-send]').disabled).toBe(true);
    await arm();
    await clickSend();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [roomId, content, txnId] = sendMessage.mock.calls[0];
    expect(roomId).toBe('!room:example.org');
    expect(txnId).toBe('txn-1');
    expect(content[CANVAS_RESPONSE_KEY]).toMatchObject({
      canvas_event_id: '$canvas',
      canvas_revision_event_id: '$canvas',
      label: 'Pro plan',
      data: { plan: 'pro' },
    });
    expect(container.textContent).toContain('Sent to Planner: Pro plan');
    expect(button('[data-canvas-send]')).toBeNull();
  });

  it('keeps the pending snapshot until the user sends or discards it', async () => {
    // Even right after a real click, a canvas cannot swap what the user is reviewing.
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { isActive: true, hasBeenActive: true },
    });
    render();
    await post(submit('Basic', { plan: 'basic' }));
    await arm();
    await post(submit('Everything', { plan: 'everything' }));
    expect(container.textContent).toContain('Send to Planner: Basic');
    await act(async () => button('[data-canvas-discard]').click());
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await post(submit('Pro plan'));
    expect(button('[data-canvas-send]').disabled).toBe(true);
    await clickSend();
    expect(sendMessage).not.toHaveBeenCalled();
    await arm();
    await clickSend();
    expect(sendMessage.mock.calls[0][1][CANVAS_RESPONSE_KEY].label).toBe('Pro plan');
    delete (navigator as { userActivation?: unknown }).userActivation;
  });

  it('bounds how fast a canvas can stage snapshots', async () => {
    render();
    await post(submit('one'));
    await act(async () => button('[data-canvas-discard]').click());
    await post(submit('two'));
    expect(button('[data-canvas-send]')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await post(submit('three'));
    expect(container.textContent).toContain('Send to Planner: three');
  });

  it('discards a staged snapshot', async () => {
    render();
    await post(submit());
    await act(async () => button('[data-canvas-discard]').click());
    expect(button('[data-canvas-send]')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('ignores messages from other windows', async () => {
    render();
    await post(submit(), window);
    expect(button('[data-canvas-send]')).toBeNull();
  });

  it('retries a failed answer by resending the SDK local echo', async () => {
    sendMessage.mockImplementationOnce(
      async (_roomId: string, _content: unknown, txnId: string) => {
        // The SDK keeps the failed local echo under the transaction ID.
        echo(txnId, EventStatus.NOT_SENT);
        throw new Error('offline');
      }
    );
    render();
    await post(submit());
    await arm();
    await clickSend();
    expect(container.textContent).toContain('Could not send your response');
    await clickSend();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(resendEvent).toHaveBeenCalledWith(pendingEvents.get('txn-1'), room);
    expect(container.textContent).toContain('Sent to Planner: Pro plan');
  });

  it('discards the failed local echo with a failed answer', async () => {
    sendMessage.mockImplementationOnce(
      async (_roomId: string, _content: unknown, txnId: string) => {
        echo(txnId, EventStatus.NOT_SENT);
        throw new Error('offline');
      }
    );
    render();
    await post(submit());
    await arm();
    await clickSend();
    await act(async () => button('[data-canvas-discard]').click());
    expect(cancelPendingEvent).toHaveBeenCalledWith(pendingEvents.get('txn-1'));
    expect(button('[data-canvas-send]')).toBeNull();
    expect(container.textContent).not.toContain('Could not send');
  });

  it('keeps Discard unavailable while an answer is sending', async () => {
    let finish: () => void = () => undefined;
    sendMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ event_id: '$response' });
        })
    );
    render();
    await post(submit());
    await arm();
    await clickSend();
    expect(button('[data-canvas-discard]').disabled).toBe(true);
    await act(async () => finish());
    expect(container.textContent).toContain('Sent to Planner: Pro plan');
  });

  const failFirstSend = () =>
    sendMessage.mockImplementationOnce(
      async (_roomId: string, _content: unknown, txnId: string) => {
        echo(txnId, EventStatus.NOT_SENT);
        throw new Error('offline');
      }
    );

  it('follows a retry the timeline started until it is sent', async () => {
    failFirstSend();
    render();
    await post(submit());
    await arm();
    await clickSend();
    // The timeline's Retry resent the same echo, which is still on its way.
    await act(async () => pendingEvents.get('txn-1')?.setStatus(EventStatus.SENDING));
    await clickSend();
    expect(resendEvent).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Sending to Planner');
    expect(button('[data-canvas-discard]').disabled).toBe(true);
    await act(async () => pendingEvents.get('txn-1')?.setStatus(EventStatus.SENT));
    expect(container.textContent).toContain('Sent to Planner: Pro plan');
    expect(button('[data-canvas-send]')).toBeNull();
  });

  it('offers Send again when a retry the timeline started fails', async () => {
    failFirstSend();
    render();
    await post(submit());
    await arm();
    await clickSend();
    await act(async () => pendingEvents.get('txn-1')?.setStatus(EventStatus.SENDING));
    await clickSend();
    await act(async () => pendingEvents.get('txn-1')?.setStatus(EventStatus.NOT_SENT));
    expect(container.textContent).toContain('Could not send your response');
    expect(button('[data-canvas-send]').disabled).toBe(false);
  });

  it('follows a retry or cancellation the timeline starts after a failure', async () => {
    failFirstSend();
    render();
    await post(submit());
    await arm();
    await clickSend();
    expect(container.textContent).toContain('Could not send your response');
    // The timeline's Retry resends the echo without any click in the panel.
    await act(async () => pendingEvents.get('txn-1')?.setStatus(EventStatus.SENDING));
    expect(container.textContent).toContain('Sending to Planner');
    expect(button('[data-canvas-discard]').disabled).toBe(true);
    await act(async () => pendingEvents.get('txn-1')?.setStatus(EventStatus.NOT_SENT));
    expect(container.textContent).toContain('Could not send your response');
    await act(async () => pendingEvents.get('txn-1')?.setStatus(EventStatus.CANCELLED));
    expect(button('[data-canvas-send]')).toBeNull();
    expect(container.textContent).not.toContain('Could not send');
  });

  it('does not mark a newer revision as worked on when an earlier answer fails late', async () => {
    const finishes: Array<{ resolve: () => void; reject: () => void }> = [];
    sendMessage.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finishes.push({
            resolve: () => resolve({ event_id: '$response' }),
            reject: () => reject(new Error('offline')),
          });
        })
    );
    render();
    await post(submit('one'));
    await arm();
    await clickSend();
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await post(submit('two'));
    await arm();
    await clickSend();
    await act(async () => finishes[0].reject());
    await act(async () => finishes[1].resolve());
    // The next step loads at once: nothing unsent is in the frame since the answer to step 2.
    render({ canvas: { ...canvas, revisionEventId: '$edit-2', html: '<p>Step 3</p>' } });
    expect(page()).toContain('<p>Step 3</p>');
    expect(container.textContent).not.toContain('updated this panel');
  });

  it('keeps the panel on a newer answer when an earlier send finishes late', async () => {
    const finishes: Array<{ resolve: () => void; reject: () => void }> = [];
    sendMessage.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finishes.push({
            resolve: () => resolve({ event_id: '$response' }),
            reject: () => reject(new Error('offline')),
          });
        })
    );
    render();
    await post(submit('one'));
    await arm();
    await clickSend();
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await post(submit('two'));
    await arm();
    await clickSend();
    expect(container.textContent).toContain('Sending to Planner');
    await act(async () => finishes[0].reject());
    expect(container.textContent).toContain('Sending to Planner');
    expect(button('[data-canvas-discard]').disabled).toBe(true);
    await act(async () => finishes[1].resolve());
    expect(container.textContent).toContain('Sent to Planner: two');
  });

  it('keeps an answer that is still sending when an update waits, so a failure can be retried', async () => {
    let fail: () => void = () => undefined;
    sendMessage.mockImplementationOnce(
      (_roomId: string, _content: unknown, txnId: string) =>
        new Promise((_resolve, reject) => {
          fail = () => {
            echo(txnId, EventStatus.NOT_SENT);
            reject(new Error('offline'));
          };
        })
    );
    render();
    await post(submit());
    await arm();
    await clickSend();
    // The user goes back into the page while the answer is on its way, then an update arrives.
    await touchFrame();
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(container.textContent).toContain('Planner updated this panel.');
    expect(container.textContent).toContain('Send to Planner: Pro plan');
    await act(async () => fail());
    expect(container.textContent).toContain('Could not send your response');
    expect(button('[data-canvas-send]').disabled).toBe(false);
    expect(button('[data-canvas-discard]').disabled).toBe(false);
  });

  it('does not strand a failed answer when an update replaces it', async () => {
    failFirstSend();
    render();
    await post(submit());
    await arm();
    await clickSend();
    expect(container.textContent).toContain('Could not send your response');
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(container.textContent).toContain('Planner updated this panel.');
    expect(container.textContent).not.toContain('Could not send');
    expect(container.textContent).toContain('what you enter here may leave this panel');
  });

  it('accepts the first answer of a new revision right after the previous one', async () => {
    render();
    await post(submit('one'));
    await arm();
    await clickSend();
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    await post(submit('two'));
    expect(container.textContent).toContain('Send to Planner: two');
  });

  it('keeps the page when the theme changes', async () => {
    render();
    const first = frame();
    render({ colorScheme: 'light' });
    expect(frame()).toBe(first);
  });

  it('keeps an answer staged while an update waits for the user', async () => {
    render();
    await touchFrame();
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(container.textContent).toContain('Planner updated this panel.');
    await post(submit());
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(container.textContent).toContain('Send to Planner: Pro plan');
  });

  it('stops a canvas that navigates away from its document', async () => {
    render();
    await act(async () => {
      frame().dispatchEvent(new Event('load'));
      frame().dispatchEvent(new Event('load'));
    });
    expect(frame()).toBeNull();
    expect(container.textContent).toContain('tried to leave');
    await act(async () => button('[data-canvas-reload]').click());
    expect(frame()).not.toBeNull();
  });

  it('stops a canvas whose wrapper reports that it navigated', async () => {
    render();
    await post({ type: 'mindroom.canvas.escaped' });
    expect(frame()).not.toBeNull();
    await post({ type: 'mindroom.canvas.escaped' }, frame().contentWindow);
    expect(frame()).toBeNull();
    expect(container.textContent).toContain('tried to leave');
  });

  it('loads an update at once when the user has not worked in the panel', async () => {
    render();
    const first = frame();
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(frame()).not.toBe(first);
    expect(page()).toContain('<p>Step 2</p>');
  });

  it('loads the next step at once after the user answered the current one', async () => {
    render();
    await touchFrame();
    await post(submit());
    await arm();
    await clickSend();
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(page()).toContain('<p>Step 2</p>');
  });

  it('asks before an update replaces unsent work', async () => {
    render();
    await touchFrame();
    await post(submit());
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(page()).toContain('<button>Pro</button>');
    expect(container.textContent).toContain('Planner updated this panel.');
    expect(button('[data-canvas-send]')).toBeNull();
    const load = [...container.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('Load update')
    ) as HTMLButtonElement;
    await act(async () => load.click());
    expect(page()).toContain('<p>Step 2</p>');
    expect(container.textContent).not.toContain('updated this panel');
  });

  it('gives the page the Chat theme as CSS variables', () => {
    render();
    expect(page()).toContain('--mr-accent:#123456');
  });

  it('shows a page that is still downloading, then the page itself', async () => {
    render({ canvas: { ...canvas, html: '', status: 'loading' } });
    expect(frame()).toBeNull();
    expect(container.textContent).toContain('Loading panel');
    render({ canvas: { ...canvas, html: '<p>Downloaded</p>' } });
    expect(page()).toContain('<p>Downloaded</p>');
  });

  it('explains a page that could not be loaded and offers a retry', () => {
    const onRetry = vi.fn();
    render({ canvas: { ...canvas, html: '', status: 'failed' }, onRetry });
    expect(frame()).toBeNull();
    expect(container.textContent).toContain('could not be loaded');
    const retry = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Retry'
    ) as HTMLButtonElement;
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows a downloaded page at once even after the user focused the panel', async () => {
    render({ canvas: { ...canvas, html: '', status: 'loading' } });
    await touchFrame();
    render({ canvas: { ...canvas, html: '<p>Downloaded</p>' } });
    expect(page()).toContain('<p>Downloaded</p>');
    expect(container.textContent).not.toContain('updated this panel');
  });

  it('offers expanding the panel where the room allows it', () => {
    const onToggleExpanded = vi.fn();
    render({ onToggleExpanded });
    act(() => button('[aria-label="Expand canvas"]').click());
    expect(onToggleExpanded).toHaveBeenCalled();
    expect(button('[aria-label="Expand canvas"]').getAttribute('aria-pressed')).toBe('false');
    render({ onToggleExpanded, expanded: true });
    expect(button('[aria-label="Expand canvas"]').getAttribute('aria-pressed')).toBe('true');
    render({ onToggleExpanded: undefined });
    expect(button('[aria-label="Expand canvas"]')).toBeNull();
  });

  it('closes', () => {
    const onClose = vi.fn();
    render({ onClose });
    act(() => button('[aria-label="Close canvas"]').click());
    expect(onClose).toHaveBeenCalled();
  });
});
