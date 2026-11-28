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
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import type { AiRunErrorInfo } from '../../matrix/protocol/aiRun';
import { isText, type ChildNode } from 'domhandler';
import { sanitizeText } from '../../rich-text/sanitize';
import { getReplySlot, parseRenderedHtml } from '../agent-run/replyDom';
import {
  collapseRestartMarkersDom,
  stripTrailingRunErrorDom,
  stripTrailingRunErrorText,
} from '../agent-run/runErrorHtml';
import { isDomElementNode } from '../agent-run/toolRefDom';
import { LINKIFY_OPTS } from '../html/react-custom-html-parser';
import { RenderMessageContent } from './RenderMessageContent';

const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_dev:example.org';
const HUMAN = '@colleague:example.org';
const ROOM_ID = '!room:example.org';

const serializeDom = (nodes: readonly ChildNode[]): string =>
  nodes
    .map((node) => {
      const slot = getReplySlot(node);
      if (slot?.kind === 'restartSeam') return `<restart-seam count="${slot.count}"/>`;
      if (isText(node)) return sanitizeText(node.data);
      if (!isDomElementNode(node)) return '';
      const attrs = Object.entries(node.attribs)
        .map(([name, value]) => ` ${name}="${sanitizeText(value)}"`)
        .join('');
      return node.name === 'br'
        ? `<br${attrs}>`
        : `<${node.name}${attrs}>${serializeDom(node.children)}</${node.name}>`;
    })
    .join('');

const stripTrailingRunErrorHtml = (html: string, error: AiRunErrorInfo) => {
  const result = stripTrailingRunErrorDom(parseRenderedHtml(html, {}), error);
  return { html: serializeDom(result.nodes), stripped: result.stripped };
};

const collapseRestartMarkersHtml = (html: string) => {
  const result = collapseRestartMarkersDom(parseRenderedHtml(html, {}));
  return { html: serializeDom(result.nodes), hasRestartSeam: result.hasRestartSeam };
};

const STALLED_FALLBACK =
  '[mindroom_dev] ⚠️ OpenRouter sent no data for 5 min (retried once automatically).';

const STALLED_ERROR: AiRunErrorInfo = {
  kind: 'stream_stalled',
  title: 'Model stopped responding',
  summary: 'OpenRouter sent no data for 5 min (retried once automatically).',
  code: 'stream_stalled',
  statusCode: 504,
  provider: 'OpenRouter',
  retryable: true,
  action: 'continue',
  fallback: STALLED_FALLBACK,
};

const RATE_LIMITED_FALLBACK =
  "⏱️ Rate limit reached — Neon hit OpenRouter's rate limit after automatic retries.";

const RATE_LIMITED_ERROR: AiRunErrorInfo = {
  kind: 'rate_limited',
  title: 'Rate limit reached',
  summary: "Neon hit OpenRouter's rate limit after automatic retries.",
  statusCode: 429,
  provider: 'OpenRouter',
  retryable: true,
  action: 'retry',
  fallback: RATE_LIMITED_FALLBACK,
};

const QUOTA_EXHAUSTED_FALLBACK =
  "💳 Account quota reached — OpenRouter rejected this request because the account's quota or credits are exhausted.";

const QUOTA_EXHAUSTED_ERROR: AiRunErrorInfo = {
  kind: 'quota_exhausted',
  title: 'Account quota reached',
  summary: "OpenRouter rejected this request because the account's quota or credits are exhausted.",
  code: 'quota_exhausted',
  statusCode: 402,
  provider: 'OpenRouter',
  retryable: false,
  fallback: QUOTA_EXHAUSTED_FALLBACK,
};

const MISSING_KEY_FALLBACK =
  "🔑 No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose **Connect your AI provider**, paste your key, then send your message again.";

const MISSING_KEY_ERROR: AiRunErrorInfo = {
  kind: 'missing_api_key',
  title: 'No AI provider key configured',
  summary:
    "No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose Connect your AI provider, paste your key, then send your message again.",
  code: 'missing_api_key',
  retryable: false,
  fallback: MISSING_KEY_FALLBACK,
};

describe('runErrorHtml transforms', () => {
  it('deduplicates exact fallback copy in both plain text and HTML, including markdown and arbitrary copy', () => {
    const cases: Array<{ name: string; plain: string; html: string; error: AiRunErrorInfo }> = [
      {
        name: '[agent] prefixed fallback',
        plain: STALLED_FALLBACK,
        html: `<p>${STALLED_FALLBACK}</p>`,
        error: STALLED_ERROR,
      },
      {
        name: '[team] prefixed fallback',
        plain: `[team] ${RATE_LIMITED_FALLBACK}`,
        html: `<p>[team] ${RATE_LIMITED_FALLBACK}</p>`,
        error: { ...RATE_LIMITED_ERROR, fallback: `[team] ${RATE_LIMITED_FALLBACK}` },
      },
      {
        name: 'quota_exhausted emoji fallback',
        plain: QUOTA_EXHAUSTED_FALLBACK,
        html: `<p>${QUOTA_EXHAUSTED_FALLBACK}</p>`,
        error: QUOTA_EXHAUSTED_ERROR,
      },
      {
        name: 'authentication_failed title: summary fallback',
        plain: '❌ Authentication failed (OpenRouter): Invalid API key',
        html: '<p>❌ Authentication failed (OpenRouter): Invalid API key</p>',
        error: {
          kind: 'authentication_failed',
          title: 'Authentication failed (OpenRouter)',
          summary: 'Invalid API key',
          statusCode: 401,
          provider: 'OpenRouter',
          retryable: false,
          fallback: '❌ Authentication failed (OpenRouter): Invalid API key',
        },
      },
      {
        name: 'NoteKind.ERROR bold markdown fallback',
        plain: '**[Response interrupted by an error: setup failed]**',
        html: '<p><strong>[Response interrupted by an error: setup failed]</strong></p>',
        error: {
          kind: 'runtime_error',
          title: 'Reply failed',
          summary: 'setup failed',
          retryable: false,
          fallback: '**[Response interrupted by an error: setup failed]**',
        },
      },
      {
        name: 'missing_api_key with bold markdown',
        plain: MISSING_KEY_FALLBACK,
        html: "<p>🔑 No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose <strong>Connect your AI provider</strong>, paste your key, then send your message again.</p>",
        error: MISSING_KEY_ERROR,
      },
      {
        name: 'headless missing_api_key with inline code and __emphasis__',
        plain:
          "🔑 No AI provider key is set up yet, so I can't reply. Missing key. A `.env` file at __storage/.env__ works too.",
        html: "<p>🔑 No AI provider key is set up yet, so I can't reply. Missing key. A <code>.env</code> file at <strong>storage/.env</strong> works too.</p>",
        error: {
          kind: 'missing_api_key',
          title: 'No AI provider key configured',
          summary: "No AI provider key is set up yet, so I can't reply.",
          code: 'missing_api_key',
          retryable: false,
          fallback:
            "🔑 No AI provider key is set up yet, so I can't reply. Missing key. A `.env` file at __storage/.env__ works too.",
        },
      },
      {
        name: 'future backend copy change independent of title and summary',
        plain: '🔌 Upstream stream closed before tokens arrived.',
        html: '<p>🔌 Upstream stream closed before tokens arrived.</p>',
        error: {
          ...STALLED_ERROR,
          fallback: '🔌 Upstream stream closed before tokens arrived.',
        },
      },
    ];

    for (const testCase of cases) {
      expect(stripTrailingRunErrorHtml(testCase.html, testCase.error), testCase.name).toEqual({
        html: '',
        stripped: true,
      });
      expect(stripTrailingRunErrorText(testCase.plain, testCase.error), testCase.name).toEqual({
        body: '',
        stripped: true,
      });
    }
  });

  it('strips only the trailing fallback paragraph and preserves earlier streamed paragraphs', () => {
    const html =
      '<p>First paragraph of progress.</p>' +
      '<p>Second paragraph before failure.</p>' +
      `<p>${STALLED_FALLBACK}</p>`;

    expect(stripTrailingRunErrorHtml(html, STALLED_ERROR)).toEqual({
      html: '<p>First paragraph of progress.</p><p>Second paragraph before failure.</p>',
      stripped: true,
    });
  });

  it('never strips trailing text that does not match fallback', () => {
    const cases = [
      '<p>Partial answer that should stay visible.</p>',
      '<p>OpenRouter sent no data for 5 min (retried once automatically).</p>',
      '<p>⚠️ OpenRouter sent no data for 5 min (retried once automatically).</p>',
      '<p>⚠️ Note: earlier we saw OpenRouter sent no data for 5 min (retried once automatically). Please check the logs.</p>',
      '<p>[status] Logged error: OpenRouter sent no data for 5 min (retried once automatically). Next step is to inspect metrics.</p>',
    ];

    for (const html of cases) {
      expect(stripTrailingRunErrorHtml(html, STALLED_ERROR), html).toEqual({
        html,
        stripped: false,
      });
    }

    expect(
      stripTrailingRunErrorText('Earlier line.\n\nDifferent trailing paragraph.', STALLED_ERROR)
    ).toEqual({
      body: 'Earlier line.\n\nDifferent trailing paragraph.',
      stripped: false,
    });
  });

  it('matches error.summary verbatim on legacy payloads without fallback and does not strip arbitrary text', () => {
    const legacyError: AiRunErrorInfo = {
      kind: 'stream_stalled',
      title: 'Model stopped responding',
      summary: 'OpenRouter sent no data for 5 min (retried once automatically).',
      retryable: true,
      action: 'continue',
    };

    expect(
      stripTrailingRunErrorHtml(
        '<p>OpenRouter sent no data for 5 min (retried once automatically).</p>',
        legacyError
      )
    ).toEqual({ html: '', stripped: true });
    expect(
      stripTrailingRunErrorText(
        'OpenRouter sent no data for 5 min (retried once automatically).',
        legacyError
      )
    ).toEqual({ body: '', stripped: true });

    const prefixed = '<p>⚠️ OpenRouter sent no data for 5 min (retried once automatically).</p>';
    expect(stripTrailingRunErrorHtml(prefixed, legacyError)).toEqual({
      html: prefixed,
      stripped: false,
    });

    const unrelated = '<p>Partial output that stays visible.</p>';
    expect(stripTrailingRunErrorHtml(unrelated, legacyError)).toEqual({
      html: unrelated,
      stripped: false,
    });
  });

  it('deduplicates bold+italic ***...*** and ___...___ spans against Matrix HTML', () => {
    const redactedError: AiRunErrorInfo = {
      kind: 'authentication_failed',
      title: 'Authentication failed',
      summary: 'API key ***redacted*** failed for ___prod___ (***a*** and ***b***).',
      retryable: false,
    };

    expect(
      stripTrailingRunErrorHtml(
        '<p>API key <em><strong>redacted</strong></em> failed for <em><strong>prod</strong></em> (<em><strong>a</strong></em> and <em><strong>b</strong></em>).</p>',
        redactedError
      )
    ).toEqual({
      html: '',
      stripped: true,
    });
  });

  it('strips trailing fallback paragraph from plain text bodies', () => {
    expect(
      stripTrailingRunErrorText(`Earlier line.\n\n${STALLED_FALLBACK}`, STALLED_ERROR)
    ).toEqual({
      body: 'Earlier line.',
      stripped: true,
    });

    expect(
      stripTrailingRunErrorText(
        'Earlier line.\n\n**[Response interrupted by an error: setup failed]**',
        {
          kind: 'runtime_error',
          title: 'Reply failed',
          summary: 'setup failed',
          retryable: false,
          fallback: '**[Response interrupted by an error: setup failed]**',
        }
      )
    ).toEqual({
      body: 'Earlier line.',
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
      html: '<p>Before.</p><restart-seam count="2"/><p>After.</p>',
      hasRestartSeam: true,
    });

    const separated =
      '<p><strong>[Response interrupted by service restart]</strong></p>' +
      '<p>Middle work.</p>' +
      '<p><strong>[Response interrupted: agent restarted to apply a config change]</strong></p>';
    expect(collapseRestartMarkersHtml(separated)).toEqual({
      html: '<restart-seam count="1"/><p>Middle work.</p><restart-seam count="1"/>',
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
      disableRunErrorUi,
      linkifyOpts = {},
    }: {
      sender?: string;
      eventId?: string;
      highlightRegex?: RegExp;
      disableRunErrorUi?: boolean;
      linkifyOpts?: LinkifyOpts;
    } = {}
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
              disableRunErrorUi={disableRunErrorUi}
              getContent={() => content as never}
              htmlReactParserOptions={{}}
              linkifyOpts={linkifyOpts}
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
          fallback: STALLED_FALLBACK,
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
          fallback: RATE_LIMITED_FALLBACK,
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
          fallback: QUOTA_EXHAUSTED_FALLBACK,
        },
        needle: "account's quota or credits are exhausted",
      },
      {
        name: 'missing_api_key',
        body: MISSING_KEY_FALLBACK,
        formattedBody:
          "<p>🔑 No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose <strong>Connect your AI provider</strong>, paste your key, then send your message again.</p>",
        error: {
          kind: 'missing_api_key',
          title: 'No AI provider key configured',
          summary:
            "No AI provider key is set up yet, so I can't reply. Open the MindRoom dashboard, choose Connect your AI provider, paste your key, then send your message again.",
          code: 'missing_api_key',
          retryable: false,
          fallback: MISSING_KEY_FALLBACK,
        },
        needle: 'No AI provider key is set up yet',
      },
      {
        name: 'note_error',
        body: '**[Response interrupted by an error: setup failed]**',
        formattedBody: '<p><strong>[Response interrupted by an error: setup failed]</strong></p>',
        error: {
          kind: 'runtime_error',
          title: 'Reply failed',
          summary: 'setup failed',
          retryable: false,
          fallback: '**[Response interrupted by an error: setup failed]**',
        },
        needle: 'setup failed',
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
          fallback: STALLED_FALLBACK,
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
          fallback: '⚠️ OpenRouter sent no data.',
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
          fallback: '⚠️ Provider error.',
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
            fallback: RATE_LIMITED_FALLBACK,
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

  it('skips RunErrorCard, fallback stripping, and RestartSeam when disableRunErrorUi is true even without highlightRegex', () => {
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
            fallback: RATE_LIMITED_FALLBACK,
          },
        },
      },
      { highlightRegex: undefined, disableRunErrorUi: true }
    );

    expect(container.querySelector('[data-run-error-card]')).toBeNull();
    expect(container.querySelector('[data-restart-seam]')).toBeNull();
    expect(
      [...container.querySelectorAll('button')].some((btn) => btn.textContent?.includes('Retry'))
    ).toBe(false);
    expect(container.textContent).toContain('[Response interrupted by service restart]');
    expect(container.textContent).toContain(
      "⏱️ Rate limit reached — Neon hit OpenRouter's rate limit after automatic retries."
    );
  });

  it('renders missing_api_key summary once with a clickable dashboard URL link', () => {
    const summary =
      'Add your provider key at https://dashboard.example.com/setup to resume replies.';
    renderMessage(
      {
        msgtype: MsgType.Text,
        body: `🔑 ${summary}`,
        format: 'org.matrix.custom.html',
        formatted_body:
          '<p>🔑 Add your provider key at <a href="https://dashboard.example.com/setup">https://dashboard.example.com/setup</a> to resume replies.</p>',
        'io.mindroom.stream_status': 'error',
        'io.mindroom.ai_run': {
          version: 1,
          status: 'error',
          error: {
            kind: 'missing_api_key',
            title: 'Missing API key',
            summary,
            retryable: false,
            fallback: `🔑 ${summary}`,
          },
        },
      },
      { linkifyOpts: LINKIFY_OPTS }
    );

    const card = container.querySelector('[data-run-error-card="open"]');
    expect(card).not.toBeNull();
    expect(container.textContent?.split(summary)).toHaveLength(2);
    const link = card?.querySelector('a[href="https://dashboard.example.com/setup"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe('https://dashboard.example.com/setup');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noreferrer noopener');
  });

  it('deduplicates ***redacted*** summary against <em><strong>redacted</strong></em> HTML', () => {
    renderMessage({
      msgtype: MsgType.Text,
      body: '❌ API key ***redacted*** was rejected by provider.',
      format: 'org.matrix.custom.html',
      formatted_body:
        '<p>❌ API key <em><strong>redacted</strong></em> was rejected by provider.</p>',
      'io.mindroom.stream_status': 'error',
      'io.mindroom.ai_run': {
        version: 1,
        status: 'error',
        error: {
          kind: 'authentication_failed',
          title: 'Authentication failed',
          summary: 'API key ***redacted*** was rejected by provider.',
          status_code: 401,
          retryable: false,
          fallback: '❌ API key ***redacted*** was rejected by provider.',
        },
      },
    });

    const card = container.querySelector('[data-run-error-card="open"]');
    expect(card).not.toBeNull();
    expect(container.querySelector('em')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent?.split('was rejected by provider.')).toHaveLength(2);
  });

  it('renders RunErrorCard outside MessageTextBody so it never inherits body opacity dimming', () => {
    for (const msgtype of [MsgType.Text, MsgType.Notice]) {
      renderMessage({
        msgtype,
        body: 'Partial output.\n\n⚠️ OpenRouter sent no data for 5 min (retried once automatically).',
        format: 'org.matrix.custom.html',
        formatted_body:
          '<p>Partial output.</p><p>⚠️ OpenRouter sent no data for 5 min (retried once automatically).</p>',
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
            fallback: '⚠️ OpenRouter sent no data for 5 min (retried once automatically).',
          },
        },
      });

      const card = container.querySelector('[data-run-error-card="open"]');
      const textBody = container.querySelector('[data-body-direction]');
      expect(card).not.toBeNull();
      expect(textBody).not.toBeNull();
      expect(card?.closest('[data-body-direction]')).toBeNull();
      expect(textBody?.contains(card)).toBe(false);
    }
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
            fallback: '⚠️ Spoofed error.',
          },
        },
      },
      { sender: HUMAN }
    );

    expect(container.querySelector('[data-run-error-card]')).toBeNull();
    expect(container.querySelector('[data-restart-seam]')).toBeNull();
    expect(container.textContent).toContain('[Response interrupted by service restart]');
  });

  it('renders literal sentinel strings in untrusted HTML as plain text without injecting RestartSeam or QuestionCard', () => {
    renderMessage({
      msgtype: MsgType.Text,
      body: '\uE000restart-seam:1\uE000 and \uE000question-card\uE000',
      format: 'org.matrix.custom.html',
      formatted_body: '<p>\uE000restart-seam:1\uE000</p><p>\uE000question-card\uE000</p>',
    });

    expect(container.querySelector('[data-restart-seam]')).toBeNull();
    expect(container.querySelector('[data-question-card]')).toBeNull();
    expect(container.textContent).toContain('\uE000restart-seam:1\uE000');
    expect(container.textContent).toContain('\uE000question-card\uE000');

    // Even when a real restart seam enables slot replacement, forged sentinel paragraphs stay literal text.
    renderMessage({
      msgtype: MsgType.Text,
      body: '[Response interrupted by service restart]\n\n\uE000restart-seam:9\uE000\n\n\uE000question-card\uE000',
      format: 'org.matrix.custom.html',
      formatted_body:
        '<p><strong>[Response interrupted by service restart]</strong></p><p>\uE000restart-seam:9\uE000</p><p>\uE000question-card\uE000</p>',
    });

    const seams = container.querySelectorAll('[data-restart-seam]');
    expect(seams).toHaveLength(1);
    expect(seams[0]?.getAttribute('data-restart-seam')).toBe('1');
    expect(container.querySelector('[data-question-card]')).toBeNull();
    expect(container.textContent).toContain('\uE000restart-seam:9\uE000');
    expect(container.textContent).toContain('\uE000question-card\uE000');
  });
});
