import parse from 'html-react-parser';
import { getDefaultStore } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markerParserOptions } from '../../../test/utils/markerParserOptions';
import type { SecretRequest } from '../../matrix/protocol/secretRequest';
import { InlineSecretRequestsContext, type InlineSecretRequestPlan } from '../inlineSecretRequests';
import { settingsAtom } from '../../preferences/settings';
import { MessageExtras } from '../MessageExtras';
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

/** A reply of these lines whose trace completed these calls, `call_1` and on unless `ids` is false. */
const reply = (lines: string[], names: string[], ids = true) => ({
  msgtype: 'm.text',
  body: 'Working.',
  format: 'org.matrix.custom.html',
  formatted_body: lines.join('\n'),
  'io.mindroom.tool_trace': {
    version: 2,
    events: names.map((name, index) => ({
      type: 'tool_call_completed',
      tool_name: name,
      ...(ids ? { tool_call_id: `call_${index + 1}` } : {}),
    })),
  },
});

/** The reply's one approval card: a `shell` call denied, the one named, or none (older backends). */
const deniedShell = (toolCallId?: string) => {
  approvals.current = {
    records: [
      {
        eventId: '$card',
        sender: '@mindroom_router:example.org',
        wireStatus: 'denied',
        approval: {
          toolName: 'shell',
          toolCallId: toolCallId ?? null,
          status: 'denied',
          responseEventId: '$reply',
          expiresAt: '2999-01-01T00:00:00Z',
        },
      },
    ],
    now: Date.now(),
  };
};

const noSecrets: InlineSecretRequestPlan = {
  hiddenEventIds: new Set(),
  byReply: new Map(),
  waitingReplyIds: new Set(),
};

/** A saved secret request drawn in place of the reply's call at `index`. */
const savedSecretAt = (index: number): InlineSecretRequestPlan => ({
  ...noSecrets,
  byReply: new Map([
    [
      '$reply',
      new Map([
        [
          index,
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
});

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

let renderer: ReactTestRenderer | undefined;
const render = (
  content: ReturnType<typeof reply>,
  { secrets = noSecrets, extras }: { secrets?: InlineSecretRequestPlan; extras?: string } = {}
) =>
  act(() => {
    renderer = create(
      <InlineSecretRequestsContext.Provider value={secrets}>
        <ToolCallMessageContext.Provider
          value={{ eventId: '$reply', roomId: '!room:x', threadId: '$root' }}
        >
          <ToolCallsFold>
            <ToolCallsCogContext.Consumer>{(cog) => cog}</ToolCallsCogContext.Consumer>
            {parse(content.formatted_body, markerParserOptions({}, content))}
            {extras && (
              <MessageExtras
                extras={{
                  version: 1,
                  sections: [
                    {
                      title: 'Trace',
                      contentType: 'text/markdown',
                      content: extras,
                      collapsed: false,
                    },
                  ],
                }}
                htmlReactParserOptions={{}}
                markerContent={content}
              />
            )}
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

/** Two `shell` calls, in two runs with text between them. */
const twoRuns = (ids = true) =>
  reply([marker('shell', 1), '<p>Trying again.</p>', marker('shell', 2)], ['shell', 'shell'], ids);

describe("a reply's approval cards across its runs of calls", () => {
  beforeEach(() => showToolCalls(true));
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    approvals.current = undefined;
  });

  it('gives a card to the call it names, in whichever run', () => {
    deniedShell('call_2');
    render(twoRuns());
    expect(lines()).toEqual(['Ran 1 tool call', 'Denied 1 tool call']);
  });

  it('gives a card that names a call the reply does not show to none of its calls', () => {
    deniedShell('call_9');
    render(twoRuns());
    expect(lines()).toEqual(['Ran 1 tool call', 'Ran 1 tool call']);
  });

  it("gives a card that names no call to the reply's first call of its tool only", () => {
    deniedShell();
    render(twoRuns());
    expect(lines()).toEqual(['Denied 1 tool call', 'Ran 1 tool call']);
  });

  it('gives a card by its tool to a trace from before call IDs', () => {
    deniedShell('call_2');
    render(twoRuns(false));
    expect(lines()).toEqual(['Denied 1 tool call', 'Ran 1 tool call']);
  });

  it("counts the reply's calls on its cog the same way", () => {
    showToolCalls(false);
    deniedShell();
    render(twoRuns());
    const cog = renderer!.root.findAll((node) => node.props['data-tool-calls-fold'] !== undefined);
    expect(cog[0]?.props['data-state']).toBe('done');
  });

  it('gives no card to a call its secret request is drawn in place of', () => {
    deniedShell();
    render(
      reply([marker('shell', 1), '<p>Got it.</p>', marker('shell', 2)], ['shell', 'shell'], false),
      { secrets: savedSecretAt(1) }
    );
    expect(lines()).toEqual(['secret:saved', 'Denied 1 tool call']);
  });

  it('resolves a run split by a secret request with the rest of the reply', () => {
    deniedShell();
    render(
      reply(
        [marker('shell', 1), marker('request_secret', 2), marker('shell', 3)],
        ['shell', 'request_secret', 'shell']
      ),
      { secrets: savedSecretAt(2) }
    );
    expect(lines()).toEqual(['Denied 1 tool call', 'secret:saved', 'Ran 1 tool call']);
  });

  it("resolves a repeated marker as one call, both its lines showing that call's state", () => {
    deniedShell();
    render(
      reply(
        [marker('shell', 1), marker('shell', 1), '<p>Trying again.</p>', marker('shell', 2)],
        ['shell', 'shell']
      )
    );
    expect(lines()).toEqual(['Denied 1 tool call', 'Ran 1 tool call']);

    act(() => renderer?.unmount());
    showToolCalls(false);
    render(
      reply(
        [marker('shell', 1), marker('shell', 1), '<p>Trying again.</p>', marker('shell', 2)],
        ['shell', 'shell']
      )
    );
    const cog = renderer!.root.findAll(
      (node) => node.type === 'button' && node.props['aria-expanded'] === false
    );
    expect(cog[0]?.props.title).toMatch(/^2 tool calls: /);
  });

  it("leaves the cards the body took by tool name to it, not to the extras' markers", () => {
    deniedShell();
    render(twoRuns(), { extras: '- 🔧 `shell` [1]' });
    expect(lines()).toEqual(['Denied 1 tool call', 'Ran 1 tool call', 'Ran 1 tool call']);
  });

  it('gives the extras the card that names their call', () => {
    deniedShell('call_1');
    render(twoRuns(), { extras: '- 🔧 `shell` [1]' });
    expect(lines()).toEqual(['Denied 1 tool call', 'Ran 1 tool call', 'Denied 1 tool call']);
  });
});
