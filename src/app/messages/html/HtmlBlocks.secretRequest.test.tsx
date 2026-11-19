import parse from 'html-react-parser';
import { getDefaultStore } from 'jotai';
import { useEffect } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markerParserOptions } from '../../../test/utils/markerParserOptions';
import type { SecretRequest, SecretRequestStatus } from '../../matrix/protocol/secretRequest';
import {
  InlineSecretRequestsContext,
  createDrawnSecretRequests,
  type InlineSecretRequestPlan,
} from '../inlineSecretRequests';
import { settingsAtom } from '../../preferences/settings';
import { MessageExtras } from '../MessageExtras';
import { ToolCallsFold } from '../agent-run/ToolCallsFold';
import { ToolCallMessageContext, ToolCallsCogContext } from '../agent-run/toolCallStatus';

// The line itself is SecretRequestLine.test.tsx's; here only where the reply draws it, and how
// often it mounts.
const env = vi.hoisted(() => ({ mounts: 0 }));
vi.mock('../../approvals/SecretRequestLine', () => ({
  SecretRequestLine: ({ request }: { request: SecretRequest }) => {
    useEffect(() => {
      env.mounts += 1;
    }, []);
    return <div data-secret-line={request.status}>secret line</div>;
  },
}));

const NAMES = ['shell', 'shell', 'request_secret', 'shell'];
const marker = (index: number, names = NAMES) =>
  `<p>🔧 <code>${names[index - 1]}</code> [${index}]</p>`;

/**
 * A reply as its row shows it: the durable one, or a live frame over it (`status`). Its trace
 * names the tools `names`, each with what `entry` adds.
 */
const reply = (
  parts: string[],
  status?: string,
  names = NAMES,
  entry: (index: number) => Record<string, unknown> = () => ({})
) => ({
  msgtype: 'm.text',
  body: 'To deploy the demo app',
  format: 'org.matrix.custom.html',
  formatted_body: parts.join('\n'),
  'io.mindroom.tool_trace': {
    version: 2,
    events: names.map((name, index) => ({
      type: 'tool_call_completed',
      tool_name: name,
      tool_call_id: `call_${index + 1}`,
      ...entry(index + 1),
    })),
  },
  ...(status ? { 'io.mindroom.stream_status': status } : {}),
});
/** A reply of four calls in one run, the one at `index` the request for the secret. */
const askingAt = (index: number) => {
  const names = NAMES.map((_name, at) => (at + 1 === index ? 'request_secret' : 'shell'));
  return reply(
    [1, 2, 3, 4].map((at) => marker(at, names)),
    undefined,
    names
  );
};

const content = reply([
  '<p>To deploy the demo app</p>',
  marker(1),
  marker(2),
  marker(3),
  marker(4),
  '<p>Done.</p>',
]);

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

/** A plan that lets the reply draw the card at its call `index`, with no line mounted yet. */
const secrets = (
  status: SecretRequestStatus,
  index: number | string = 3,
  value: SecretRequest = request(status)
): InlineSecretRequestPlan => ({
  byReply: new Map([
    [
      '$reply',
      new Map([
        [
          typeof index === 'string' ? index : `call_${index}`,
          { eventId: '$card', request: value, agentUserId: '@mindroom_dev:x' },
        ],
      ]),
    ],
  ]),
  waitingReplyIds: new Set(),
  drawn: createDrawnSecretRequests(),
});
/** The cards whose rows hide. */
const hiddenRows = (plan: InlineSecretRequestPlan) => [...plan.drawn.getIds()];

/** A section of the reply's extras with the marker of its body's third call, as a list item. */
const extras = {
  version: 1 as const,
  sections: [
    {
      title: 'Trace',
      contentType: 'text/markdown' as const,
      content: '- 🔧 `request_secret` [3]',
      collapsed: false,
    },
  ],
};

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

/** The reply's row: what it shows (`shown`), parsed as the row parses it. */
function Reply({ shown = content, withExtras = false }) {
  return (
    <ToolCallMessageContext.Provider
      value={{ eventId: '$reply', roomId: '!room:x', threadId: '$root' }}
    >
      <ToolCallsFold>
        <ToolCallsCogContext.Consumer>{(cog) => cog}</ToolCallsCogContext.Consumer>
        {parse(shown.formatted_body, markerParserOptions({}, shown))}
        {withExtras && (
          <MessageExtras extras={extras} htmlReactParserOptions={{}} markerContent={shown} />
        )}
      </ToolCallsFold>
    </ToolCallMessageContext.Provider>
  );
}

let renderer: ReactTestRenderer | undefined;
/** Draws `rows` (the reply's row by default) in a timeline with the plan `value`. */
const render = (value: InlineSecretRequestPlan, rows: React.ReactNode = <Reply />) =>
  act(() => {
    const tree = (
      <InlineSecretRequestsContext.Provider value={value}>
        {rows}
      </InlineSecretRequestsContext.Provider>
    );
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
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
            .replace(/(shell|request_secret).*$/, '')
            .trim()
    );
const cog = () =>
  renderer!.root.findAll((node) => node.props['data-tool-calls-fold'] !== undefined)[0];

const showToolCalls = (shown: boolean) => {
  const store = getDefaultStore();
  act(() => store.set(settingsAtom, { ...store.get(settingsAtom), showToolCalls: shown }));
};

describe('a secret request in its reply', () => {
  beforeEach(() => {
    showToolCalls(true);
    env.mounts = 0;
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    showToolCalls(true);
  });

  it('takes the place of the call that asked, splitting its run', () => {
    render(secrets('saved'));
    expect(lines()).toEqual(['Ran 2 tool calls', 'secret:saved', 'Ran 1 tool call']);
  });

  it("takes its call's place in the body only: the extras keep their tool line", () => {
    render(secrets('declined'), <Reply withExtras />);
    expect(lines()).toEqual([
      'Ran 2 tool calls',
      'secret:declined',
      'Ran 1 tool call',
      'Ran 1 tool call',
    ]);
    expect(
      renderer!.root.findAll((node) => node.props['data-secret-line'] !== undefined)
    ).toHaveLength(1);
  });

  it('starts or ends a run without an empty run beside it', () => {
    render(secrets('saved', 1), <Reply shown={askingAt(1)} />);
    expect(lines()).toEqual(['secret:saved', 'Ran 3 tool calls']);
    render(secrets('saved', 4), <Reply shown={askingAt(4)} />);
    expect(lines()).toEqual(['Ran 3 tool calls', 'secret:saved']);
  });

  it('leaves the run whole without a request for one of its calls', () => {
    const none = { ...secrets('saved'), byReply: new Map() };
    render(none);
    expect(lines()).toEqual(['Ran 4 tool calls']);
    expect(hiddenRows(none)).toEqual([]);
    const other = secrets('saved', 9);
    render(other);
    expect(lines()).toEqual(['Ran 4 tool calls']);
    expect(hiddenRows(other)).toEqual([]);
  });

  it('counts with the hidden calls and keeps its card no row, until the cog opens its line', () => {
    const hiddenLines = () =>
      renderer!.root.findAll((node) => node.type === 'div' && node.props.hidden === true);
    const toggleCog = (open: boolean) =>
      act(() => {
        renderer!.root
          .findByProps({ 'aria-expanded': open, title: 'Used 4 tools' })
          .props.onClick();
      });
    showToolCalls(false);
    const plan = secrets('saved');
    render(plan);

    // Shown once, on the cog: the done card asks nothing, so its row stays hidden.
    expect(lines()).toEqual([]);
    expect(cog()?.props['data-state']).toBe('done');
    expect(hiddenLines()).toHaveLength(1);
    expect(hiddenRows(plan)).toEqual(['$card']);

    toggleCog(false);
    expect(lines()).toEqual(['Ran 2 tool calls', 'secret:saved', 'Ran 1 tool call']);
    expect(hiddenLines()).toHaveLength(0);
    expect(hiddenRows(plan)).toEqual(['$card']);

    toggleCog(true);
    expect(lines()).toEqual([]);
    expect(hiddenRows(plan)).toEqual(['$card']);

    showToolCalls(true);
    expect(lines()).toEqual(['Ran 2 tool calls', 'secret:saved', 'Ran 1 tool call']);
    expect(hiddenRows(plan)).toEqual(['$card']);

    // Only a mounted reply claims: the reply gone, the row comes back.
    showToolCalls(false);
    render(plan, null);
    expect(hiddenRows(plan)).toEqual([]);
  });
});

describe("a secret request card's row", () => {
  it('goes to the copy of the reply whose cog opens, from a hidden copy, and stays hidden', () => {
    showToolCalls(false);
    const plan = secrets('saved');
    render(
      plan,
      <>
        <Reply />
        <Reply />
      </>
    );
    expect(lines()).toEqual([]);
    expect(hiddenRows(plan)).toEqual(['$card']);

    act(() => {
      renderer!.root
        .findAllByProps({ 'aria-expanded': false, title: 'Used 4 tools' })[1]!
        .props.onClick();
    });
    expect(lines()).toEqual(['Ran 2 tool calls', 'secret:saved', 'Ran 1 tool call']);
    expect(hiddenRows(plan)).toEqual(['$card']);

    act(() => {
      renderer!.root.findByProps({ 'aria-expanded': true, title: 'Used 4 tools' }).props.onClick();
    });
    expect(lines()).toEqual([]);
    expect(hiddenRows(plan)).toEqual(['$card']);
  });

  beforeEach(() => {
    showToolCalls(true);
    env.mounts = 0;
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('hides while the line is mounted, and shows again when the reply leaves', () => {
    const plan = secrets('saved');
    expect(hiddenRows(plan)).toEqual([]);

    render(plan);
    expect(hiddenRows(plan)).toEqual(['$card']);

    // The reply's row scrolls out of the mounted window, a plugin takes it, its work folds.
    render(plan, null);
    expect(hiddenRows(plan)).toEqual([]);
  });

  it("moves into a reply still streaming once a frame shows the call's line, and stays there", () => {
    const plan = secrets('saved');
    const lead = ['<p>To deploy the demo app</p>', marker(1), marker(2)];

    // A live frame that has not reached the call: the done card keeps its row.
    render(plan, <Reply shown={reply([...lead, '<p>Fetching</p>'], 'streaming')} />);
    expect(lines()).toEqual(['Ran 2 tool calls']);
    expect(hiddenRows(plan)).toEqual([]);

    // A frame that shows it: the line, and the row gone.
    render(plan, <Reply shown={reply([...lead, marker(3), marker(4)], 'streaming')} />);
    expect(lines()).toEqual(['Ran 2 tool calls', 'secret:saved', 'Ran 1 tool call']);
    expect(hiddenRows(plan)).toEqual(['$card']);

    // The turn ends with the durable body: the same line, never unmounted, never a row between.
    const rows = vi.fn();
    plan.drawn.subscribe(rows);
    render(plan, <Reply shown={reply([...lead, marker(3), marker(4), '<p>Done.</p>'])} />);
    expect(lines()).toEqual(['Ran 2 tool calls', 'secret:saved', 'Ran 1 tool call']);
    expect(env.mounts).toBe(1);
    expect(rows).not.toHaveBeenCalled();
    expect(hiddenRows(plan)).toEqual(['$card']);
  });

  it('shows again when a newer frame of the reply no longer has the line', () => {
    const plan = secrets('saved');
    render(plan);
    expect(hiddenRows(plan)).toEqual(['$card']);

    render(
      plan,
      <Reply shown={reply(['<p>To deploy the demo app</p>', marker(1)], 'streaming')} />
    );

    expect(lines()).toEqual(['Ran 1 tool call']);
    expect(hiddenRows(plan)).toEqual([]);
  });

  it('shows again once the plan lets the reply draw it no longer', () => {
    const plan = secrets('saved');
    render(plan);

    render({ ...plan, byReply: new Map() });

    expect(lines()).toEqual(['Ran 4 tool calls']);
    expect(hiddenRows(plan)).toEqual([]);
  });

  it('goes for one line: a repeated marker is the call’s own line, as in any run', () => {
    const plan = secrets('saved');
    const repeated = reply([marker(1), marker(3), marker(3), '<p>Then again:</p>', marker(3)]);
    render(plan, <Reply shown={repeated} />);

    expect(lines()).toEqual(['Ran 1 tool call', 'secret:saved', 'Ran 1 tool call']);
    expect(env.mounts).toBe(1);
    expect(hiddenRows(plan)).toEqual(['$card']);
  });

  it('stays when the named call ID is another call’s, which asks for no secret', () => {
    // Providers reuse call IDs within a reply: the ID alone does not say which call asked.
    const plan = secrets('saved');
    const reused = reply([marker(1), marker(2), marker(3), marker(4)], undefined, NAMES, () => ({
      tool_call_id: 'call_3',
    }));
    render(plan, <Reply shown={reused} />);
    expect(lines()).toEqual(['Ran 2 tool calls', 'secret:saved', 'Ran 1 tool call']);

    const shells = NAMES.map(() => 'shell');
    const other = reply([marker(1, shells), marker(3, shells)], undefined, shells);
    render(plan, <Reply shown={other} />);
    expect(lines()).toEqual(['Ran 2 tool calls']);
    expect(hiddenRows(plan)).toEqual([]);
  });

  it('never moves to the command line call that ran the request: the card names the inner call', () => {
    const plan = secrets('saved', 'inner');
    const names = ['shell', 'shell', 'request_temporary_secret', 'shell'];
    const ids = ['call_1', 'outer', 'inner', 'call_4'];
    const entry = (at: number) => ({
      tool_call_id: ids[at - 1],
      ...(at === 2 ? { args_preview: 'command=mindroom-agent request_temporary_secret' } : {}),
    });
    const markers = [1, 2, 3, 4].map((at) => marker(at, names));

    // Only the outer call shows yet: its line stays a tool line, and the card a row.
    render(plan, <Reply shown={reply(markers.slice(0, 2), 'streaming', names, entry)} />);
    expect(lines()).toEqual(['Ran 2 tool calls']);
    expect(hiddenRows(plan)).toEqual([]);

    render(plan, <Reply shown={reply(markers, undefined, names, entry)} />);
    expect(lines()).toEqual(['Ran 2 tool calls', 'secret:saved', 'Ran 1 tool call']);
    expect(hiddenRows(plan)).toEqual(['$card']);
  });

  it('goes for one line: a second place that draws the reply keeps the call’s own line', () => {
    const plan = secrets('saved');
    render(plan, [<Reply key="first" />, <Reply key="second" />]);

    expect(lines()).toEqual([
      'Ran 2 tool calls',
      'secret:saved',
      'Ran 1 tool call',
      'Ran 2 tool calls',
      'Ran 1 tool call',
      'Ran 1 tool call',
    ]);

    // The first place goes: the second draws the line, and the row stays hidden.
    render(plan, [<Reply key="second" />]);
    expect(lines()).toEqual(['Ran 2 tool calls', 'secret:saved', 'Ran 1 tool call']);
    expect(hiddenRows(plan)).toEqual(['$card']);
  });
});
