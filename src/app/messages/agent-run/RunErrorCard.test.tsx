// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  EventStatus,
  EventType,
  MatrixEvent,
  MsgType,
  RelationType,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiRunErrorInfo, AiRunInfo } from '../../matrix/protocol/aiRun';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { RestartSeam, RunErrorCard, formatRunErrorCode, getRunErrorTone } from './RunErrorCard';

const discardFailedLocalEcho = vi.hoisted(() => vi.fn());
vi.mock('../../matrix/protocol/pendingLocalEcho', () => ({ discardFailedLocalEcho }));

const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root';
const VIEWER = '@alice:example.org';
const AGENT = '@mindroom_dev:example.org';

const makeEvent = (
  eventId: string,
  {
    sender = AGENT,
    threadId = THREAD_ID,
    type = EventType.RoomMessage,
    content = { msgtype: MsgType.Text, body: 'text' },
    status = EventStatus.SENT,
  }: {
    sender?: string;
    threadId?: string | null;
    type?: string;
    content?: Record<string, unknown>;
    status?: EventStatus | null;
  } = {}
): MatrixEvent => {
  const fullContent =
    threadId && !('m.relates_to' in content)
      ? {
          ...content,
          'm.relates_to': {
            rel_type: RelationType.Thread,
            event_id: threadId,
            is_falling_back: true,
            'm.in_reply_to': { event_id: threadId },
          },
        }
      : content;
  const event = new MatrixEvent({
    event_id: eventId,
    room_id: ROOM_ID,
    sender,
    type,
    origin_server_ts: Date.now(),
    content: fullContent,
  });
  event.status = status;
  return event;
};

type MockRoomOptions = {
  membership?: string;
  canSend?: boolean;
  threadEvents?: MatrixEvent[];
  timelineEvents?: MatrixEvent[];
  memberDisplayName?: string;
  pendingEcho?: MatrixEvent;
};

const createMockRoom = ({
  membership = 'join',
  canSend = true,
  threadEvents = [],
  timelineEvents = [],
  memberDisplayName = 'DevAgent',
  pendingEcho,
}: MockRoomOptions = {}) => {
  const room = {
    roomId: ROOM_ID,
    getMyMembership: () => membership,
    currentState: {
      maySendEvent: () => canSend,
    },
    getMember: (userId: string) =>
      userId === AGENT && memberDisplayName ? { rawDisplayName: memberDisplayName } : null,
    getThread: (id: string) =>
      id === THREAD_ID ? { id: THREAD_ID, events: threadEvents } : undefined,
    getLiveTimeline: () => ({ getEvents: () => timelineEvents }),
    getEventForTxnId: () => pendingEcho,
  };
  return room as unknown as Room;
};

const createMockClient = (
  room: Room | null,
  sendMessage = vi.fn().mockResolvedValue({ event_id: '$sent' })
) => {
  const mx = {
    getUserId: () => VIEWER,
    getRoom: (id: string) => (room && id === ROOM_ID ? room : null),
    makeTxnId: () => 'txn-1',
    sendMessage,
  } as unknown as MatrixClient;
  return { mx, sendMessage };
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const STALLED_ERROR: AiRunErrorInfo = {
  kind: 'stream_stalled',
  title: 'Model stopped responding',
  summary: 'OpenRouter sent no data for 5 min (retried once automatically).',
  detail: 'Timed out after 300s waiting for next SSE chunk',
  code: 'stream_stalled',
  statusCode: 504,
  provider: 'OpenRouter',
  retryable: true,
  action: 'continue',
};

const CONTEXT_ERROR: AiRunErrorInfo = {
  kind: 'context_window',
  title: 'Context window full',
  summary: 'This thread exceeded the model context limit.',
  code: 'context_window_exceeded',
  statusCode: 400,
  provider: 'OpenRouter',
  retryable: false,
  action: 'compact',
};

describe('RunErrorCard helpers', () => {
  it('maps transient and safeguard kinds to warning and hard failures to danger', () => {
    const warnKinds = [
      'stream_stalled',
      'provider_unavailable',
      'rate_limited',
      'timeout',
      'safeguard_refusal',
    ];
    for (const kind of warnKinds) {
      expect(getRunErrorTone({ kind, title: 'T', summary: 'S', retryable: false }), kind).toBe(
        'warning'
      );
    }

    const dangerKinds = [
      'context_window',
      'tokens_per_minute',
      'quota_exhausted',
      'missing_api_key',
      'authentication_failed',
      'runtime_error',
    ];
    for (const kind of dangerKinds) {
      expect(getRunErrorTone({ kind, title: 'T', summary: 'S', retryable: false }), kind).toBe(
        'danger'
      );
    }

    expect(
      getRunErrorTone({ kind: 'custom_transient', title: 'T', summary: 'S', retryable: true })
    ).toBe('warning');
    expect(
      getRunErrorTone({ kind: 'custom_fatal', title: 'T', summary: 'S', retryable: false })
    ).toBe('danger');
  });

  it('formats status code and error code cleanly', () => {
    expect(formatRunErrorCode(STALLED_ERROR)).toBe('504 · stream_stalled');
    expect(
      formatRunErrorCode({
        kind: 'timeout',
        title: 'T',
        summary: 'S',
        statusCode: 504,
        retryable: true,
      })
    ).toBe('504');
    expect(
      formatRunErrorCode({
        kind: 'timeout',
        title: 'T',
        summary: 'S',
        code: 'timed_out',
        retryable: true,
      })
    ).toBe('timed_out');
    expect(
      formatRunErrorCode({ kind: 'timeout', title: 'T', summary: 'S', retryable: true })
    ).toBeUndefined();
  });
});

describe('RunErrorCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    discardFailedLocalEcho.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const renderCard = (
    props: {
      error: AiRunErrorInfo;
      aiRun?: AiRunInfo;
      mEvent?: MatrixEvent;
      roomId?: string;
      threadId?: string;
      readOnly?: boolean;
    },
    mx?: MatrixClient
  ) => {
    const element = <RunErrorCard {...props} />;
    act(() => {
      root.render(mx ? <MatrixClientProvider value={mx}>{element}</MatrixClientProvider> : element);
    });
  };

  it('renders warning tone, status chip, summary, and toggles technical details drawer', () => {
    const failedEvent = makeEvent('$failed');
    const room = createMockRoom({ threadEvents: [failedEvent] });
    const { mx } = createMockClient(room);

    renderCard(
      {
        error: STALLED_ERROR,
        aiRun: {
          status: 'error',
          modelId: 'google/gemini-4-neon',
          modelDisplayName: 'Neon',
          modelProvider: 'openrouter',
          error: STALLED_ERROR,
        },
        mEvent: failedEvent,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
      },
      mx
    );

    const card = container.querySelector('[data-run-error-card="open"]');
    expect(card?.getAttribute('data-tone')).toBe('warning');
    expect(container.textContent).toContain('Model stopped responding');
    expect(container.textContent).toContain('Stream stalled');
    expect(container.textContent).toContain('OpenRouter sent no data for 5 min');

    const detailsToggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(detailsToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('dl')).toBeNull();

    act(() => {
      detailsToggle?.click();
    });

    expect(detailsToggle?.getAttribute('aria-expanded')).toBe('true');
    const rows = Object.fromEntries(
      [...container.querySelectorAll('dt')].map((dt) => [
        dt.textContent,
        dt.nextElementSibling?.textContent,
      ])
    );
    expect(rows).toEqual({
      Model: 'google/gemini-4-neon (Neon)',
      Provider: 'OpenRouter',
      Code: '504 · stream_stalled',
      Detail: 'Timed out after 300s waiting for next SSE chunk',
    });
  });

  it('renders danger tone with Context limit chip and hides Technical details when no tech fields exist', () => {
    const minimalDanger: AiRunErrorInfo = {
      kind: 'context_window',
      title: 'Context window full',
      summary: 'Compact or start a new thread.',
      retryable: false,
    };
    renderCard({ error: minimalDanger });

    const card = container.querySelector('[data-run-error-card="open"]');
    expect(card?.getAttribute('data-tone')).toBe('danger');
    expect(container.textContent).toContain('Context limit');
    expect(container.querySelector('button[aria-expanded]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('sends threaded Continue mention with m.mentions and folds to an expandable Resumed receipt', async () => {
    const failedEvent = makeEvent('$failed');
    const room = createMockRoom({ threadEvents: [failedEvent] });
    const { mx, sendMessage } = createMockClient(room);

    renderCard(
      {
        error: STALLED_ERROR,
        mEvent: failedEvent,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
      },
      mx
    );

    const continueBtn = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Continue')
    );
    expect(continueBtn).toBeDefined();

    await act(async () => {
      continueBtn?.click();
      await Promise.resolve();
    });

    expect(sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      THREAD_ID,
      {
        msgtype: MsgType.Text,
        body: `${AGENT} Continue.`,
        format: 'org.matrix.custom.html',
        formatted_body: `<a href="https://matrix.to/#/${encodeURIComponent(AGENT)}">DevAgent</a> Continue.`,
        'm.mentions': { user_ids: [AGENT] },
        'm.relates_to': {
          event_id: THREAD_ID,
          rel_type: RelationType.Thread,
          is_falling_back: true,
          'm.in_reply_to': { event_id: THREAD_ID },
        },
      },
      'txn-1'
    );

    const receipt = container.querySelector('[data-run-error-card="resumed"]');
    expect(receipt).not.toBeNull();
    expect(receipt?.textContent).toContain('Resumed');
    expect(receipt?.textContent).toContain('Model stopped responding');

    const receiptBtn = receipt?.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(receiptBtn?.getAttribute('aria-expanded')).toBe('false');
    act(() => {
      receiptBtn?.click();
    });
    expect(receiptBtn?.getAttribute('aria-expanded')).toBe('true');
    expect(receipt?.textContent).toContain('OpenRouter sent no data for 5 min');
    expect(receipt?.querySelector('dl')).not.toBeNull();
  });

  it('uses Retried for Retry and Compacted for Compact receipts', async () => {
    const roomFailedEvent = makeEvent('$failed-room', { threadId: null });
    const room = createMockRoom({ timelineEvents: [roomFailedEvent] });
    const { mx, sendMessage } = createMockClient(room);

    renderCard(
      {
        error: {
          kind: 'rate_limited',
          title: 'Rate limit reached',
          summary: 'Provider rate limit hit.',
          statusCode: 429,
          retryable: true,
          action: 'retry',
        },
        mEvent: roomFailedEvent,
        roomId: ROOM_ID,
      },
      mx
    );

    expect(container.textContent).toContain('429');
    const retryBtn = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Retry')
    );
    await act(async () => {
      retryBtn?.click();
      await Promise.resolve();
    });

    expect(sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      null,
      {
        msgtype: MsgType.Text,
        body: `${AGENT} Please try again.`,
        format: 'org.matrix.custom.html',
        formatted_body: `<a href="https://matrix.to/#/${encodeURIComponent(AGENT)}">DevAgent</a> Please try again.`,
        'm.mentions': { user_ids: [AGENT] },
      },
      'txn-1'
    );
    const retryReceipt = container.querySelector('[data-run-error-card="resumed"]');
    expect(retryReceipt?.textContent).toContain('Retried');
    expect(retryReceipt?.textContent).toContain('Rate limit reached');

    sendMessage.mockClear();
    const threadFailedEvent = makeEvent('$failed-compact');
    const threadRoom = createMockRoom({ threadEvents: [threadFailedEvent] });
    const compactClient = createMockClient(threadRoom, sendMessage);
    act(() => {
      root.unmount();
      root = createRoot(container);
    });

    renderCard(
      {
        error: CONTEXT_ERROR,
        mEvent: threadFailedEvent,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
      },
      compactClient.mx
    );

    const compactBtn = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Compact')
    );
    await act(async () => {
      compactBtn?.click();
      await Promise.resolve();
    });

    expect(sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      THREAD_ID,
      {
        msgtype: MsgType.Text,
        body: '/compact',
        'm.relates_to': {
          event_id: THREAD_ID,
          rel_type: RelationType.Thread,
          is_falling_back: true,
          'm.in_reply_to': { event_id: THREAD_ID },
        },
      },
      'txn-1'
    );
    const compactReceipt = container.querySelector('[data-run-error-card="resumed"]');
    expect(compactReceipt?.textContent).toContain('Compacted');
    expect(compactReceipt?.textContent).toContain('Context window full');
  });

  it('recovers cleanly when Matrix send fails: unfolds card, discards echo, shows inline alert, and allows retry', async () => {
    const failedEvent = makeEvent('$failed');
    const pendingEcho = makeEvent('$local-echo', { status: EventStatus.NOT_SENT });
    const room = createMockRoom({ threadEvents: [failedEvent], pendingEcho });
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ event_id: '$sent-retry' });
    const { mx } = createMockClient(room, sendMessage);

    renderCard(
      {
        error: STALLED_ERROR,
        mEvent: failedEvent,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
      },
      mx
    );

    const getContinueBtn = () =>
      [...container.querySelectorAll('button')].find((btn) =>
        btn.textContent?.includes('Continue')
      );

    await act(async () => {
      getContinueBtn()?.click();
      await Promise.resolve();
    });

    expect(discardFailedLocalEcho).toHaveBeenCalledWith(mx, pendingEcho);
    expect(container.querySelector('[data-run-error-card="open"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not send message'
    );

    await act(async () => {
      getContinueBtn()?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-run-error-card="resumed"]')).not.toBeNull();
  });

  it('keeps the card open and actionable even when later messages or thread-summary notices exist in the thread', () => {
    const failedEvent = makeEvent('$failed');
    const threadSummaryNotice = makeEvent('$summary-notice', {
      content: {
        msgtype: MsgType.Notice,
        body: 'Thread summary updated',
        'io.mindroom.thread_summary': { version: 1 },
      },
    });
    const concurrentUserMessage = makeEvent('$user-note', {
      sender: VIEWER,
      content: { msgtype: MsgType.Text, body: 'Also check the staging logs please' },
    });
    const room = createMockRoom({
      threadEvents: [failedEvent, threadSummaryNotice, concurrentUserMessage],
      timelineEvents: [failedEvent, threadSummaryNotice, concurrentUserMessage],
    });
    const { mx } = createMockClient(room);

    renderCard(
      {
        error: STALLED_ERROR,
        mEvent: failedEvent,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
      },
      mx
    );

    expect(container.querySelector('[data-run-error-card="open"]')).not.toBeNull();
    expect(container.querySelector('[data-run-error-card="resumed"]')).toBeNull();
    expect(
      [...container.querySelectorAll('button')].some((btn) => btn.textContent?.includes('Continue'))
    ).toBe(true);
  });

  it('moves keyboard focus to the receipt toggle on activation and restores it to the action button on send failure', async () => {
    const failedEvent = makeEvent('$failed');
    const room = createMockRoom({ threadEvents: [failedEvent] });
    const firstSend = createDeferred<{ event_id: string }>();
    const secondSend = createDeferred<{ event_id: string }>();
    const thirdSend = createDeferred<{ event_id: string }>();
    const sendMessage = vi
      .fn()
      .mockReturnValueOnce(firstSend.promise)
      .mockReturnValueOnce(secondSend.promise)
      .mockReturnValueOnce(thirdSend.promise);
    const { mx } = createMockClient(room, sendMessage);

    const externalBtn = document.createElement('button');
    externalBtn.textContent = 'External control';
    document.body.append(externalBtn);

    try {
      renderCard(
        {
          error: STALLED_ERROR,
          mEvent: failedEvent,
          roomId: ROOM_ID,
          threadId: THREAD_ID,
        },
        mx
      );

      const getContinueBtn = () =>
        [...container.querySelectorAll('button')].find((btn) =>
          btn.textContent?.includes('Continue')
        );
      const getReceiptBtn = () =>
        container.querySelector<HTMLButtonElement>(
          '[data-run-error-card="resumed"] button[aria-expanded]'
        );

      // 1. Keyboard activation (detail: 0) moves focus to the folded receipt toggle.
      const continueBtn = getContinueBtn()!;
      act(() => {
        continueBtn.focus();
        continueBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
      });
      const receiptBtn = getReceiptBtn();
      expect(receiptBtn).not.toBeNull();
      expect(document.activeElement).toBe(receiptBtn);

      // 2. Send failure while focus is still on the receipt restores focus to the action button.
      await act(async () => {
        firstSend.reject(new Error('network down'));
        await Promise.resolve();
      });
      const restoredContinueBtn = getContinueBtn();
      expect(restoredContinueBtn).not.toBeNull();
      expect(document.activeElement).toBe(restoredContinueBtn);

      // 3. If the user moves focus elsewhere before send fails, focus is not stolen.
      act(() => {
        restoredContinueBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
      });
      expect(document.activeElement).toBe(getReceiptBtn());
      act(() => {
        externalBtn.focus();
      });
      await act(async () => {
        secondSend.reject(new Error('still down'));
        await Promise.resolve();
      });
      expect(getContinueBtn()).not.toBeNull();
      expect(document.activeElement).toBe(externalBtn);

      // 4. Pointer activation (detail: 1) does not move focus to receipt or action button.
      act(() => {
        externalBtn.focus();
        getContinueBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      });
      expect(getReceiptBtn()).not.toBeNull();
      expect(document.activeElement).toBe(externalBtn);
      await act(async () => {
        thirdSend.reject(new Error('pointer send failed'));
        await Promise.resolve();
      });
      expect(getContinueBtn()).not.toBeNull();
      expect(document.activeElement).toBe(externalBtn);
    } finally {
      externalBtn.remove();
    }
  });

  it('hides action button when user cannot send or card is readOnly', () => {
    const failedEvent = makeEvent('$failed');
    const readOnlyRoom = createMockRoom({ canSend: false, threadEvents: [failedEvent] });
    const { mx } = createMockClient(readOnlyRoom);

    renderCard(
      {
        error: STALLED_ERROR,
        mEvent: failedEvent,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
      },
      mx
    );
    expect(
      [...container.querySelectorAll('button')].some((btn) => btn.textContent?.includes('Continue'))
    ).toBe(false);
    // Technical details button remains available.
    expect(container.querySelector('button[aria-expanded]')).not.toBeNull();

    const writableRoom = createMockRoom({ canSend: true, threadEvents: [failedEvent] });
    const writableClient = createMockClient(writableRoom);
    renderCard(
      {
        error: STALLED_ERROR,
        mEvent: failedEvent,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
        readOnly: true,
      },
      writableClient.mx
    );
    expect(
      [...container.querySelectorAll('button')].some((btn) => btn.textContent?.includes('Continue'))
    ).toBe(false);
  });

  it('renders RestartSeam for single and repeated restarts', () => {
    act(() => {
      root.render(
        <>
          <RestartSeam count={1} />
          <RestartSeam count={3} />
        </>
      );
    });

    const seams = [...container.querySelectorAll('[data-restart-seam]')];
    expect(seams).toHaveLength(2);
    expect(seams[0]?.textContent).toBe('Service restarted · context preserved');
    expect(seams[1]?.textContent).toBe('Service restarted (3×) · context preserved');
  });
});
