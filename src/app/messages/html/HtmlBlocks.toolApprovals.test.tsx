import parse from 'html-react-parser';
import { getDefaultStore } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markerParserOptions } from '../../../test/utils/markerParserOptions';
import type { SecretRequest } from '../../matrix/protocol/secretRequest';
import { InlineSecretRequestsContext, type InlineSecretRequestPlan } from '../inlineSecretRequests';
import { settingsAtom } from '../../preferences/settings';
import { ToolCallsFold } from '../agent-run/ToolCallsFold';
import { ToolCallMessageContext, ToolCallsCogContext } from '../agent-run/toolCallStatus';

const approvals = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../../approvals/ThreadApprovalProvider', () => ({
  useThreadApprovals: () => approvals.current,
}));
vi.mock('../../approvals/SecretRequestLine', () => ({
  SecretRequestLine: ({ request }: { request: SecretRequest }) => (
    <div data-secret-line={request.status}>secret line</div>
  ),
}));

const marker = (name: string, index: number) => `<p>🔧 <code>${name}</code> [${index}]</p>`;

const reply = (html: string, names: string[]) => ({
  msgtype: 'm.text',
  body: 'Working.',
  format: 'org.matrix.custom.html',
  formatted_body: html,
  'io.mindroom.tool_trace': {
    version: 2,
    events: names.map((name, index) => ({
      type: 'tool_call_completed',
      tool_name: name,
      tool_call_id: `call_${index + 1}`,
    })),
  },
});

/** The reply's one approval card: its `shell` call was denied. */
const deniedShell = {
  records: [
    {
      eventId: '$card',
      sender: '@mindroom_router:example.org',
      wireStatus: 'denied',
      approval: {
        toolName: 'shell',
        status: 'denied',
        responseEventId: '$reply',
        expiresAt: '2999-01-01T00:00:00Z',
      },
    },
  ],
  now: Date.now(),
};

const noSecrets: InlineSecretRequestPlan = {
  hiddenEventIds: new Set(),
  byReply: new Map(),
  waitingReplyIds: new Set(),
};

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

let renderer: ReactTestRenderer | undefined;
const render = (content: ReturnType<typeof reply>, secrets = noSecrets) =>
  act(() => {
    renderer = create(
      <InlineSecretRequestsContext.Provider value={secrets}>
        <ToolCallMessageContext.Provider
          value={{ eventId: '$reply', roomId: '!room:x', threadId: '$root' }}
        >
          <ToolCallsFold>
            <ToolCallsCogContext.Consumer>{(cog) => cog}</ToolCallsCogContext.Consumer>
            {parse(content.formatted_body, markerParserOptions({}, content))}
          </ToolCallsFold>
        </ToolCallMessageContext.Provider>
      </InlineSecretRequestsContext.Provider>
    );
  });

/** Each run of calls by its title, and the secret line, in order. */
const lines = () =>
  renderer!.root
    .findAll(
      (node) =>
        typeof node.type === 'string' &&
        (node.props['data-secret-line'] !== undefined ||
          (node.type === 'button' && node.props['aria-controls'] !== undefined))
    )
    .map((node) =>
      node.props['data-secret-line'] !== undefined
        ? `secret:${node.props['data-secret-line']}`
        : textOf(node)
            .replace(/(shell|request_secret).*$/, '')
            .trim()
    );

const showToolCalls = (shown: boolean) => {
  const store = getDefaultStore();
  act(() => store.set(settingsAtom, { ...store.get(settingsAtom), showToolCalls: shown }));
};

describe("a reply's approval cards across its runs of calls", () => {
  beforeEach(() => showToolCalls(true));
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    approvals.current = undefined;
  });

  it('gives a denied card to the first matching call of the reply only, not of every run', () => {
    approvals.current = deniedShell;
    render(
      reply([marker('shell', 1), '<p>Trying again.</p>', marker('shell', 2)].join('\n'), [
        'shell',
        'shell',
      ])
    );
    expect(lines()).toEqual(['Denied 1 tool call', 'Ran 1 tool call']);
  });

  it("counts the reply's calls on its cog the same way", () => {
    showToolCalls(false);
    approvals.current = deniedShell;
    render(
      reply([marker('shell', 1), '<p>Trying again.</p>', marker('shell', 2)].join('\n'), [
        'shell',
        'shell',
      ])
    );
    const cog = renderer!.root.findAll((node) => node.props['data-tool-calls-fold'] !== undefined);
    expect(cog[0]?.props['data-state']).toBe('done');
  });

  it('does so too when a secret request splits the run', () => {
    approvals.current = deniedShell;
    const secrets: InlineSecretRequestPlan = {
      ...noSecrets,
      byReply: new Map([
        [
          '$reply',
          new Map([
            [
              2,
              {
                eventId: '$secret',
                agentUserId: '@mindroom_dev:x',
                request: {
                  kind: 'temporary',
                  requestId: 'req-1',
                  requesterId: '@bas:example.org',
                  env: 'SUDO_PASSWORD',
                  keep: { memory: 900 },
                  kept: 'memory',
                  reason: 'To restart',
                  status: 'saved',
                  expiresAt: Date.now() + 15 * 60_000,
                },
              },
            ],
          ]),
        ],
      ]),
    };
    render(
      reply([marker('shell', 1), marker('request_secret', 2), marker('shell', 3)].join('\n'), [
        'shell',
        'request_secret',
        'shell',
      ]),
      secrets
    );
    expect(lines()).toEqual(['Denied 1 tool call', 'secret:saved', 'Ran 1 tool call']);
  });
});
