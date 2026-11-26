// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  EventType,
  MatrixEvent,
  MsgType,
  type IContent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import type { AiRunErrorInfo } from '../../matrix/protocol/aiRun';
import {
  collapseRestartMarkersHtml,
  stripTrailingRunErrorHtml,
  stripTrailingRunErrorText,
} from '../agent-run/runErrorHtml';
import { RenderMessageContent } from './RenderMessageContent';

const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_dev:example.org';
const HUMAN = '@colleague:example.org';
const ROOM_ID = '!room:example.org';

const STALLED_ERROR: AiRunErrorInfo = {
  kind: 'stream_stalled',
  title: 'Model stopped responding',
  summary: 'OpenRouter sent no data for 5 min (retried once automatically).',
  code: 'stream_stalled',
  statusCode: 504,
  provider: 'OpenRouter',
  retryable: true,
  action: 'continue',
};

const RATE_LIMITED_ERROR: AiRunErrorInfo = {
  kind: 'rate_limited',
  title: 'Rate limit reached',
  summary: "Neon hit OpenRouter's rate limit after automatic retries.",
  statusCode: 429,
  provider: 'OpenRouter',
  retryable: true,
  action: 'retry',
};

const QUOTA_EXHAUSTED_ERROR: AiRunErrorInfo = {
  kind: 'quota_exhausted',
  title: 'Account quota reached',
  summary: "OpenRouter rejected this request because the account's quota or credits are exhausted.",
  code: 'quota_exhausted',
  statusCode: 402,
  provider: 'OpenRouter',
  retryable: false,
};

const MISSING_KEY_ERROR_MARKDOWN: AiRunErrorInfo = {
  kind: 'missing_api_key',
  title: 'No AI provider key configured',
  summary:
    "No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose **Connect your AI provider**, paste your key, then send your message again.",
  code: 'missing_api_key',
  retryable: false,
};

const MISSING_KEY_ERROR_PLAIN: AiRunErrorInfo = {
  ...MISSING_KEY_ERROR_MARKDOWN,
  summary:
    "No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose Connect your AI provider, paste your key, then send your message again.",
};

describe('runErrorHtml transforms', () => {
  it('strips trailing fallback paragraph matching summary or prefixed with emoji or [agent]', () => {
    const cases = [
      '<p>OpenRouter sent no data for 5 min (retried once automatically).</p>',
      '<p>⚠️ OpenRouter sent no data for 5 min (retried once automatically).</p>',
      '<p>⚠ OpenRouter sent no data for 5 min (retried once automatically).</p>',
      '<p>❌ OpenRouter sent no data for 5 min (retried once automatically).</p>',
      '<p>🔑 OpenRouter sent no data for 5 min (retried once automatically).</p>',
      '<p>⏰ OpenRouter sent no data for 5 min (retried once automatically).</p>',
      '<p>⏱️ OpenRouter sent no data for 5 min (retried once automatically).</p>',
      '<p>⏱ OpenRouter sent no data for 5 min (retried once automatically).</p>',
      '<p>💳 OpenRouter sent no data for 5 min (retried once automatically).</p>',
      '<p>[mindroom_dev] ⚠️ OpenRouter sent no data for 5 min (retried once automatically).</p>',
      '<p>⚠️ Model stopped responding — OpenRouter sent no data for 5 min (retried once automatically).</p>',
      '<p>[mindroom_dev] ⚠️ Model stopped responding — OpenRouter sent no data for 5 min (retried once automatically).</p>',
    ];

    for (const html of cases) {
      expect(stripTrailingRunErrorHtml(html, STALLED_ERROR), html).toEqual({
        html: '',
        stripped: true,
      });
    }
  });

  it('strips exact backend plain_text + to_wire() shapes for rate_limited, quota_exhausted, authentication_failed, and missing_api_key', () => {
    // rate_limited: own-user reply emits ⏱️ (or ⏱) without [agent] prefix
    expect(
      stripTrailingRunErrorHtml(
        "<p>⏱️ Rate limit reached — Neon hit OpenRouter's rate limit after automatic retries.</p>",
        RATE_LIMITED_ERROR
      )
    ).toEqual({ html: '', stripped: true });
    expect(
      stripTrailingRunErrorHtml(
        "<p>⏱ Rate limit reached — Neon hit OpenRouter's rate limit after automatic retries.</p>",
        RATE_LIMITED_ERROR
      )
    ).toEqual({ html: '', stripped: true });
    expect(
      stripTrailingRunErrorText(
        "⏱️ Rate limit reached — Neon hit OpenRouter's rate limit after automatic retries.",
        RATE_LIMITED_ERROR
      )
    ).toEqual({ body: '', stripped: true });

    // quota_exhausted: own-user reply emits 💳 without [agent] prefix
    expect(
      stripTrailingRunErrorHtml(
        "<p>💳 Account quota reached — OpenRouter rejected this request because the account's quota or credits are exhausted.</p>",
        QUOTA_EXHAUSTED_ERROR
      )
    ).toEqual({ html: '', stripped: true });
    expect(
      stripTrailingRunErrorText(
        "💳 Account quota reached — OpenRouter rejected this request because the account's quota or credits are exhausted.",
        QUOTA_EXHAUSTED_ERROR
      )
    ).toEqual({ body: '', stripped: true });

    // authentication_failed: emits ❌ {title}: {summary}
    const authError: AiRunErrorInfo = {
      kind: 'authentication_failed',
      title: 'Authentication failed (OpenRouter)',
      summary: 'Invalid API key',
      statusCode: 401,
      provider: 'OpenRouter',
      retryable: false,
    };
    expect(
      stripTrailingRunErrorHtml(
        '<p>❌ Authentication failed (OpenRouter): Invalid API key</p>',
        authError
      )
    ).toEqual({ html: '', stripped: true });

    // missing_api_key: rendered HTML has <strong> while wire summary may keep ** or omit **
    const missingKeyHtml =
      "<p>🔑 No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose <strong>Connect your AI provider</strong>, paste your key, then send your message again.</p>";
    expect(stripTrailingRunErrorHtml(missingKeyHtml, MISSING_KEY_ERROR_MARKDOWN)).toEqual({
      html: '',
      stripped: true,
    });
    expect(stripTrailingRunErrorHtml(missingKeyHtml, MISSING_KEY_ERROR_PLAIN)).toEqual({
      html: '',
      stripped: true,
    });

    const missingKeyPlain =
      "🔑 No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose **Connect your AI provider**, paste your key, then send your message again.";
    expect(stripTrailingRunErrorText(missingKeyPlain, MISSING_KEY_ERROR_MARKDOWN)).toEqual({
      body: '',
      stripped: true,
    });
    expect(stripTrailingRunErrorText(missingKeyPlain, MISSING_KEY_ERROR_PLAIN)).toEqual({
      body: '',
      stripped: true,
    });

    // Inline code backticks and __emphasis__ normalize cleanly too
    const headlessMissingKey: AiRunErrorInfo = {
      kind: 'missing_api_key',
      title: 'No AI provider key configured',
      summary:
        "No AI provider key is set up yet, so I can't reply. Missing key. A `.env` file at __storage/.env__ works too.",
      code: 'missing_api_key',
      retryable: false,
    };
    expect(
      stripTrailingRunErrorHtml(
        "<p>🔑 No AI provider key is set up yet, so I can't reply. Missing key. A <code>.env</code> file at <strong>storage/.env</strong> works too.</p>",
        headlessMissingKey
      )
    ).toEqual({ html: '', stripped: true });
  });

  it('strips only the trailing fallback paragraph and preserves earlier streamed paragraphs', () => {
    const html =
      '<p>First paragraph of progress.</p>' +
      '<p>Second paragraph before failure.</p>' +
      '<p>[mindroom_dev] ⚠️ OpenRouter sent no data for 5 min (retried once automatically).</p>';

    expect(stripTrailingRunErrorHtml(html, STALLED_ERROR)).toEqual({
      html: '<p>First paragraph of progress.</p><p>Second paragraph before failure.</p>',
      stripped: true,
    });
  });

  it('does not strip normal reply paragraphs even when prefixed with an icon or bracket label containing the summary', () => {
    const unrelated = '<p>Partial answer that should stay visible.</p>';
    expect(stripTrailingRunErrorHtml(unrelated, STALLED_ERROR)).toEqual({
      html: unrelated,
      stripped: false,
    });

    const warningNote =
      '<p>⚠️ Note: earlier we saw OpenRouter sent no data for 5 min (retried once automatically). Please check the logs.</p>';
    expect(stripTrailingRunErrorHtml(warningNote, STALLED_ERROR)).toEqual({
      html: warningNote,
      stripped: false,
    });

    const bracketNote =
      '<p>[status] Logged error: OpenRouter sent no data for 5 min (retried once automatically). Next step is to inspect metrics.</p>';
    expect(stripTrailingRunErrorHtml(bracketNote, STALLED_ERROR)).toEqual({
      html: bracketNote,
      stripped: false,
    });
  });

  it('strips trailing fallback paragraph from plain text bodies', () => {
    expect(
      stripTrailingRunErrorText(
        'Earlier line.\n\n[mindroom_dev] ⚠️ OpenRouter sent no data for 5 min (retried once automatically).',
        STALLED_ERROR
      )
    ).toEqual({
      body: 'Earlier line.',
      stripped: true,
    });

    expect(
      stripTrailingRunErrorText(
        '⚠️ OpenRouter sent no data for 5 min (retried once automatically).',
        STALLED_ERROR
      )
    ).toEqual({
      body: '',
      stripped: true,
    });
  });

  it('collapses standalone and consecutive restart markers without merging across content', () => {
    const consecutive =
      '<p>Before.</p>' +
      '<p><strong>[Response interrupted by service restart]</strong></p>' +
      '<p><strong>[Response interrupted by service restart]</strong></p>' +
      '<p>After.</p>';
    expect(collapseRestartMarkersHtml(consecutive)).toEqual({
      html: '<p>Before.</p><p>\uE000restart-seam:2\uE000</p><p>After.</p>',
      hasRestartSeam: true,
    });

    const separated =
      '<p><strong>[Response interrupted by service restart]</strong></p>' +
      '<p>Middle work.</p>' +
      '<p><strong>[Response interrupted: agent restarted to apply a config change]</strong></p>';
    expect(collapseRestartMarkersHtml(separated)).toEqual({
      html: '<p>\uE000restart-seam:1\uE000</p><p>Middle work.</p><p>\uE000restart-seam:1\uE000</p>',
      hasRestartSeam: true,
    });

    const normal = '<p>Nothing restarted here.</p>';
    expect(collapseRestartMarkersHtml(normal)).toEqual({
      html: normal,
      hasRestartSeam: false,
    });
  });
});

describe('renderAgentMessageContent run error card & restart seam', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderMessage = (
    content: IContent,
    {
      sender = AGENT,
      eventId = '$err-1',
      highlightRegex,
    }: { sender?: string; eventId?: string; highlightRegex?: RegExp } = {}
  ) => {
    const mEvent = new MatrixEvent({
      type: EventType.RoomMessage,
      room_id: ROOM_ID,
      event_id: eventId,
      sender,
      origin_server_ts: 1000,
      content,
    });
    const room = {
      roomId: ROOM_ID,
      getMyMembership: () => 'join',
      currentState: { maySendEvent: () => true },
      getMember: () => ({ rawDisplayName: 'DevAgent' }),
      getThread: () => undefined,
      getLiveTimeline: () => ({ getEvents: () => [mEvent] }),
    } as unknown as Room;
    const mx = {
      getUserId: () => VIEWER,
      getRoom: (id: string) => (id === ROOM_ID ? room : null),
      makeTxnId: () => 'txn-1',
      sendMessage: async () => ({ event_id: '$sent' }),
    } as unknown as MatrixClient;

    act(() => {
      root.render(
        <ClientConfigProvider value={{}}>
          <MatrixClientProvider value={mx}>
            <RenderMessageContent
              mEvent={mEvent}
              eventId={eventId}
              roomId={ROOM_ID}
              displayName="DevAgent"
              msgType={String(content.msgtype ?? MsgType.Text)}
              ts={1000}
              highlightRegex={highlightRegex}
              getContent={() => content as never}
              htmlReactParserOptions={{}}
              linkifyOpts={{}}
            />
          </MatrixClientProvider>
        </ClientConfigProvider>
      );
    });
  };

  it('deduplicates trailing fallback text and renders RunErrorCard alone when body has only fallback error', () => {
    renderMessage({
      msgtype: MsgType.Text,
      body: '[mindroom_dev] ⚠️ OpenRouter sent no data for 5 min (retried once automatically).',
      format: 'org.matrix.custom.html',
      formatted_body:
        '<p>[mindroom_dev] ⚠️ OpenRouter sent no data for 5 min (retried once automatically).</p>',
      'io.mindroom.stream_status': 'error',
      'io.mindroom.ai_run': {
        version: 1,
        status: 'error',
        model: { id: 'google/gemini-4-neon', display_name: 'Neon', provider: 'openrouter' },
        error: {
          kind: 'stream_stalled',
          title: 'Model stopped responding',
          summary: 'OpenRouter sent no data for 5 min (retried once automatically).',
          code: 'stream_stalled',
          status_code: 504,
          provider: 'OpenRouter',
          retryable: true,
          action: 'continue',
        },
      },
    });

    const card = container.querySelector('[data-run-error-card="open"]');
    expect(card).not.toBeNull();
    // No duplicated raw prefix paragraph outside the card.
    expect(container.textContent).not.toContain('[mindroom_dev]');
    expect(container.querySelectorAll('p')).toHaveLength(0);
    // Summary appears once (inside the card), not twice.
    const matches = container.textContent?.match(/OpenRouter sent no data for 5 min/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('deduplicates exact own-user backend shapes for rate_limited, quota_exhausted, and missing_api_key', () => {
    const cases: Array<{
      name: string;
      body: string;
      formattedBody: string;
      error: Record<string, unknown>;
      needle: string;
    }> = [
      {
        name: 'rate_limited',
        body: "⏱️ Rate limit reached — Neon hit OpenRouter's rate limit after automatic retries.",
        formattedBody:
          "<p>⏱️ Rate limit reached — Neon hit OpenRouter's rate limit after automatic retries.</p>",
        error: {
          kind: 'rate_limited',
          title: 'Rate limit reached',
          summary: "Neon hit OpenRouter's rate limit after automatic retries.",
          status_code: 429,
          provider: 'OpenRouter',
          retryable: true,
          action: 'retry',
        },
        needle: "Neon hit OpenRouter's rate limit",
      },
      {
        name: 'quota_exhausted',
        body: "💳 Account quota reached — OpenRouter rejected this request because the account's quota or credits are exhausted.",
        formattedBody:
          "<p>💳 Account quota reached — OpenRouter rejected this request because the account's quota or credits are exhausted.</p>",
        error: {
          kind: 'quota_exhausted',
          title: 'Account quota reached',
          summary:
            "OpenRouter rejected this request because the account's quota or credits are exhausted.",
          code: 'quota_exhausted',
          status_code: 402,
          provider: 'OpenRouter',
          retryable: false,
        },
        needle: "account's quota or credits are exhausted",
      },
      {
        name: 'missing_api_key_markdown_wire',
        body: "🔑 No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose **Connect your AI provider**, paste your key, then send your message again.",
        formattedBody:
          "<p>🔑 No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose <strong>Connect your AI provider</strong>, paste your key, then send your message again.</p>",
        error: {
          kind: 'missing_api_key',
          title: 'No AI provider key configured',
          summary:
            "No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose **Connect your AI provider**, paste your key, then send your message again.",
          code: 'missing_api_key',
          retryable: false,
        },
        needle: 'No AI provider key is set up yet',
      },
      {
        name: 'missing_api_key_plain_wire',
        body: "🔑 No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose **Connect your AI provider**, paste your key, then send your message again.",
        formattedBody:
          "<p>🔑 No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose <strong>Connect your AI provider</strong>, paste your key, then send your message again.</p>",
        error: {
          kind: 'missing_api_key',
          title: 'No AI provider key configured',
          summary:
            "No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose Connect your AI provider, paste your key, then send your message again.",
          code: 'missing_api_key',
          retryable: false,
        },
        needle: 'No AI provider key is set up yet',
      },
    ];

    for (const testCase of cases) {
      renderMessage({
        msgtype: MsgType.Text,
        body: testCase.body,
        format: 'org.matrix.custom.html',
        formatted_body: testCase.formattedBody,
        'io.mindroom.stream_status': 'error',
        'io.mindroom.ai_run': {
          version: 1,
          status: 'error',
          error: testCase.error,
        },
      });

      expect(container.querySelector('[data-run-error-card="open"]'), testCase.name).not.toBeNull();
      expect(container.querySelectorAll('p'), testCase.name).toHaveLength(0);
      const count = container.textContent?.split(testCase.needle).length ?? 0;
      expect(count - 1, testCase.name).toBe(1);
    }
  });

  it('preserves earlier streamed paragraphs and collapsed restart seams above RunErrorCard', () => {
    renderMessage({
      msgtype: MsgType.Text,
      body:
        'Checked the build logs first.\n\n' +
        '**[Response interrupted by service restart]**\n\n' +
        '**[Response interrupted by service restart]**\n\n' +
        '[mindroom_dev] ⚠️ OpenRouter sent no data for 5 min (retried once automatically).',
      format: 'org.matrix.custom.html',
      formatted_body:
        '<p>Checked the build logs first.</p>' +
        '<p><strong>[Response interrupted by service restart]</strong></p>' +
        '<p><strong>[Response interrupted by service restart]</strong></p>' +
        '<p>[mindroom_dev] ⚠️ OpenRouter sent no data for 5 min (retried once automatically).</p>',
      'io.mindroom.stream_status': 'error',
      'io.mindroom.ai_run': {
        version: 1,
        status: 'error',
        error: {
          kind: 'stream_stalled',
          title: 'Model stopped responding',
          summary: 'OpenRouter sent no data for 5 min (retried once automatically).',
          retryable: true,
          action: 'continue',
        },
      },
    });

    expect(container.textContent).toContain('Checked the build logs first.');
    const seams = container.querySelectorAll('[data-restart-seam]');
    expect(seams).toHaveLength(1);
    expect(seams[0]?.getAttribute('data-restart-seam')).toBe('2');
    expect(seams[0]?.textContent).toBe('Service restarted (2×) · context preserved');
    expect(container.textContent).not.toContain('[Response interrupted by service restart]');
    expect(container.textContent).not.toContain('[mindroom_dev]');
    expect(container.querySelector('[data-run-error-card="open"]')).not.toBeNull();
  });

  it('renders tool call rows, collapsed restart seam, and RunErrorCard together in one reply', () => {
    renderMessage({
      msgtype: MsgType.Text,
      body: 'Running checks.\n\n🔧 `bash` [1]\n\n**[Response interrupted by service restart]**\n\n⚠️ OpenRouter sent no data.',
      format: 'org.matrix.custom.html',
      formatted_body:
        '<p>Running checks.</p>' +
        '<p>🔧 <code>bash</code> [1]</p>' +
        '<p><strong>[Response interrupted by service restart]</strong></p>' +
        '<p>⚠️ OpenRouter sent no data.</p>',
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_completed',
            tool_name: 'bash',
            args_preview: 'npm test',
            result_preview: 'ok',
          },
        ],
      },
      'io.mindroom.stream_status': 'error',
      'io.mindroom.ai_run': {
        version: 1,
        status: 'error',
        error: {
          kind: 'stream_stalled',
          title: 'Model stopped responding',
          summary: 'OpenRouter sent no data.',
          retryable: true,
          action: 'continue',
        },
      },
    });

    expect(container.textContent).toContain('Running checks.');
    expect(container.querySelector('[data-message-disclosure]')).not.toBeNull();
    expect(container.querySelector('[data-restart-seam="1"]')?.textContent).toBe(
      'Service restarted · context preserved'
    );
    expect(container.querySelector('[data-run-error-card="open"]')).not.toBeNull();
  });

  it('keeps RunErrorCard visible outside a collapsed FinishedWorkFold', () => {
    renderMessage({
      msgtype: MsgType.Text,
      body: 'Checking files.\n\n🔧 `bash` [1]\n\nPartial summary.\n\n⚠️ Provider error.',
      format: 'org.matrix.custom.html',
      formatted_body:
        '<p>Checking files.</p>' +
        '<p>🔧 <code>bash</code> [1]</p>' +
        '<p>Partial summary.</p>' +
        '<p>⚠️ Provider error.</p>',
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_completed',
            tool_name: 'bash',
            args_preview: 'ls',
            result_preview: 'ok',
          },
        ],
      },
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.ai_run': {
        version: 1,
        status: 'completed',
        error: {
          kind: 'provider_unavailable',
          title: 'Provider unavailable',
          summary: 'Provider error.',
          status_code: 503,
          retryable: true,
          action: 'retry',
        },
      },
    });

    const card = container.querySelector('[data-run-error-card="open"]');
    const workFold = container.querySelector('[data-work-fold]');
    expect(card).not.toBeNull();
    expect(workFold).not.toBeNull();
    expect(workFold?.getAttribute('aria-expanded')).toBe('false');
    // FinishedWorkFold collapsed the earlier tool work behind [data-work-fold],
    // while both the partial answer and RunErrorCard remain visible outside it.
    expect(container.textContent).not.toContain('Checking files.');
    expect(container.textContent).toContain('Partial summary.');
    expect(card?.closest('[data-work-fold]')).toBeNull();
    expect(workFold?.parentElement?.contains(card)).toBe(false);
  });

  it('keeps original highlighted text intact without RunErrorCard or RestartSeam in search results', () => {
    renderMessage(
      {
        msgtype: MsgType.Text,
        body:
          '**[Response interrupted by service restart]**\n\n' +
          "⏱️ Rate limit reached — Neon hit OpenRouter's rate limit after automatic retries.",
        format: 'org.matrix.custom.html',
        formatted_body:
          '<p><strong>[Response interrupted by service restart]</strong></p>' +
          "<p>⏱️ Rate limit reached — Neon hit OpenRouter's rate limit after automatic retries.</p>",
        'io.mindroom.stream_status': 'error',
        'io.mindroom.ai_run': {
          version: 1,
          status: 'error',
          error: {
            kind: 'rate_limited',
            title: 'Rate limit reached',
            summary: "Neon hit OpenRouter's rate limit after automatic retries.",
            status_code: 429,
            provider: 'OpenRouter',
            retryable: true,
            action: 'retry',
          },
        },
      },
      { highlightRegex: /OpenRouter/gi }
    );

    expect(container.querySelector('[data-run-error-card]')).toBeNull();
    expect(container.querySelector('[data-restart-seam]')).toBeNull();
    expect(container.textContent).toContain('[Response interrupted by service restart]');
    expect(container.textContent).toContain(
      "⏱️ Rate limit reached — Neon hit OpenRouter's rate limit after automatic retries."
    );
    const highlighted = [...container.querySelectorAll('span')].find(
      (span) => span.textContent === 'OpenRouter' && span.style.backgroundColor !== ''
    );
    expect(highlighted).toBeDefined();
  });

  it('ignores ai_run.error and restart markers on non-agent messages', () => {
    renderMessage(
      {
        msgtype: MsgType.Text,
        body: '**[Response interrupted by service restart]**\n\n⚠️ Spoofed error.',
        format: 'org.matrix.custom.html',
        formatted_body:
          '<p><strong>[Response interrupted by service restart]</strong></p><p>⚠️ Spoofed error.</p>',
        'io.mindroom.ai_run': {
          version: 1,
          status: 'error',
          error: {
            kind: 'runtime_error',
            title: 'Spoofed',
            summary: 'Spoofed error.',
            retryable: false,
          },
        },
      },
      { sender: HUMAN }
    );

    expect(container.querySelector('[data-run-error-card]')).toBeNull();
    expect(container.querySelector('[data-restart-seam]')).toBeNull();
    expect(container.textContent).toContain('[Response interrupted by service restart]');
  });
});
