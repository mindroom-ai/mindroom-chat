import parse from 'html-react-parser';
import { getDefaultStore } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markerParserOptions } from '../../../test/utils/markerParserOptions';
import type { SecretRequest, SecretRequestStatus } from '../../matrix/protocol/secretRequest';
import {
  InlineSecretRequestsContext,
  type InlineSecretRequests,
} from '../../approvals/inlineSecretRequests';
import { settingsAtom } from '../../preferences/settings';
import { ToolCallsFold } from '../agent-run/ToolCallsFold';
import { ToolCallMessageContext, ToolCallsCogContext } from '../agent-run/toolCallStatus';

// The line itself is SecretRequestLine.test.tsx's; here only where the reply draws it.
vi.mock('../../approvals/SecretRequestLine', () => ({
  SecretRequestLine: ({ request }: { request: SecretRequest }) => (
    <div data-secret-line={request.status}>secret line</div>
  ),
}));

const html = [
  '<p>Pulling the checkout.</p>',
  '<p>🔧 <code>shell</code> [1]</p>',
  '<p>🔧 <code>shell</code> [2]</p>',
  '<p>🔧 <code>request_secret</code> [3]</p>',
  '<p>🔧 <code>shell</code> [4]</p>',
  '<p>Done.</p>',
].join('\n');

const content = {
  msgtype: 'm.text',
  body: 'Pulling the checkout.',
  format: 'org.matrix.custom.html',
  formatted_body: html,
  'io.mindroom.tool_trace': {
    version: 2,
    events: ['shell', 'shell', 'request_secret', 'shell'].map((name, index) => ({
      type: 'tool_call_completed',
      tool_name: name,
      tool_call_id: `call_${index + 1}`,
    })),
  },
};

const request = (status: SecretRequestStatus): SecretRequest => ({
  kind: 'temporary',
  requestId: 'req-1',
  requesterId: '@bas:example.org',
  env: 'SUDO_PASSWORD',
  keep: { memory: 900 },
  kept: status === 'saved' ? 'memory' : null,
  reason: 'To restart',
  status,
  expiresAt: Date.now() + 15 * 60_000,
});

const secrets = (status: SecretRequestStatus, callId = 'call_3'): InlineSecretRequests =>
  new Map([
    [
      '$reply',
      new Map([
        [callId, { eventId: '$card', request: request(status), agentUserId: '@mindroom_dev:x' }],
      ]),
    ],
  ]);

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

let renderer: ReactTestRenderer | undefined;
const render = (value: InlineSecretRequests) =>
  act(() => {
    renderer = create(
      <InlineSecretRequestsContext.Provider value={value}>
        <ToolCallMessageContext.Provider
          value={{ eventId: '$reply', roomId: '!room:x', threadId: '$root' }}
        >
          <ToolCallsFold>
            <ToolCallsCogContext.Consumer>{(cog) => cog}</ToolCallsCogContext.Consumer>
            {parse(html, markerParserOptions({}, content))}
          </ToolCallsFold>
        </ToolCallMessageContext.Provider>
      </InlineSecretRequestsContext.Provider>
    );
  });

/** The reply's lines in order: each run of calls by its title, and the secret line. */
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
            .replace(/shell.*$/, '')
            .trim()
    );
const cog = () =>
  renderer!.root.findAll((node) => node.props['data-tool-calls-fold'] !== undefined)[0];

const showToolCalls = (shown: boolean) => {
  const store = getDefaultStore();
  act(() => store.set(settingsAtom, { ...store.get(settingsAtom), showToolCalls: shown }));
};

describe('a secret request in its reply', () => {
  beforeEach(() => showToolCalls(true));
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    showToolCalls(true);
  });

  it('takes the place of the call that asked, splitting its run', () => {
    render(secrets('pending'));
    expect(lines()).toEqual(['Ran 2 tool calls', 'secret:pending', 'Ran 1 tool call']);
  });

  it('starts or ends a run without an empty run beside it', () => {
    render(secrets('saved', 'call_1'));
    expect(lines()).toEqual(['secret:saved', 'Ran 3 tool calls']);
    act(() => renderer?.unmount());
    render(secrets('saved', 'call_4'));
    expect(lines()).toEqual(['Ran 3 tool calls', 'secret:saved']);
  });

  it('leaves the run whole without a request for one of its calls', () => {
    render(new Map());
    expect(lines()).toEqual(['Ran 4 tool calls']);
    act(() => renderer?.unmount());
    render(secrets('pending', 'call_9'));
    expect(lines()).toEqual(['Ran 4 tool calls']);
  });

  it('shows while it waits where the thread hides tool calls, and the cog waits too', () => {
    showToolCalls(false);
    render(secrets('pending'));

    expect(lines()).toEqual(['secret:pending']);
    expect(cog()?.props['data-state']).toBe('waiting');
    expect(textOf(cog()!)).toBe('4');
  });

  it('hides with the other calls once done, and shows with them when the cog opens', () => {
    showToolCalls(false);
    render(secrets('saved'));

    expect(lines()).toEqual([]);
    expect(cog()?.props['data-state']).toBe('done');
    act(() => {
      renderer!.root.findByProps({ 'aria-expanded': false, title: 'Used 4 tools' }).props.onClick();
    });
    expect(lines()).toEqual(['Ran 2 tool calls', 'secret:saved', 'Ran 1 tool call']);
  });
});
