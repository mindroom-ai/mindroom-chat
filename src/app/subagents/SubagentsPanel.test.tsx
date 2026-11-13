// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../config/useClientConfig';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import type { LiveDocs } from '../matrix/protocol/liveFrame';
import type { SubagentFrame, SubagentMeta, SubagentStatus } from '../matrix/protocol/subagentFrame';
import type { ToolTraceEvent } from '../matrix/protocol/toolTrace';
import { loadLiveMarkdown } from '../messages/live/liveMarkdown';
import { getSubagentRunStore } from '../messages/live/subagentRunStore';
import { SubagentsPanel } from './SubagentsPanel';
import { showToolCalls } from '../../test/utils/showToolCalls';

// These tests show how tool calls render, so they show them.
beforeEach(showToolCalls);

const ROOM_ID = '!room:example.org';
const VIEWER = '@ann:example.org';
const SENDER = '@mindroom_lead:example.org';
const SID = '1762790000123-0a1b2c3d';
/** Unix seconds the tests' clock reads. */
const NOW = 1_762_790_600;

const navigation = vi.hoisted(() => ({ navigateRoomThread: vi.fn() }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ ...navigation, navigateRoom: vi.fn(), navigateSpace: vi.fn() }),
}));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

// The room knows the lead and the researcher by their names; the writer is not a member. The
// helper and the coordinator are agents of a namespaced MindRoom (`mindroom_<agent>_<namespace>`).
const MEMBERS: Record<string, string> = {
  '@mindroom_lead:example.org': 'Lead',
  '@mindroom_researcher:example.org': 'Research Desk',
  '@mindroom_helper_ns4321:example.org': 'Helper Desk',
  '@mindroom_coordinator_ns4321:example.org': 'Coordinator',
};
const PICTURES: Record<string, string> = {
  '@mindroom_helper_ns4321:example.org': 'mxc://example.org/helper',
};
const member = (userId: string) => ({
  userId,
  name: MEMBERS[userId],
  rawDisplayName: MEMBERS[userId],
  membership: 'join',
  getMxcAvatarUrl: () => PICTURES[userId],
});
const room = {
  roomId: ROOM_ID,
  getMember: (userId: string) => (MEMBERS[userId] ? member(userId) : null),
  getJoinedMembers: () => Object.keys(MEMBERS).map(member),
  getMembers: () => [],
  membersLoaded: () => true,
  loadMembersIfNeeded: () => Promise.resolve(true),
  hasEncryptionStateEvent: () => false,
} as unknown as Room;

const mx = {
  getUserId: () => VIEWER,
  getSafeUserId: () => VIEWER,
  getRoom: () => room,
  getHomeserverUrl: () => 'https://example.org',
  mxcUrlToHttp: (mxc: string) => `https://media.example.org/${mxc.slice('mxc://'.length)}`,
} as unknown as MatrixClient;

/** A run's meta; `ingest` makes a run without a `subagent` a sub-agent of its own. */
type RunMeta = Omit<SubagentMeta, 'subagent'> & { subagent?: string };
const meta = (status: SubagentStatus, extra: Partial<SubagentMeta> = {}): RunMeta => ({
  agent: 'researcher',
  caller: 'lead',
  root: 'lead',
  parent: null,
  threadId: '$thread:example.org',
  source: 'delegate',
  status,
  startedAt: NOW - 45,
  endedAt:
    status === 'running' || status === 'awaiting_approval' || status === 'paused' ? null : NOW,
  ...extra,
});

const docs = (md: string, tools: ToolTraceEvent[] = [], working = true): LiveDocs => ({
  md,
  reasoning: '',
  tools,
  status: working ? 'streaming' : 'pending',
  activity: '',
});

const seqs = new Map<string, number>();
const ingest = (run: string, runMeta: RunMeta, runDocs: LiveDocs) => {
  const seq = (seqs.get(run) ?? -1) + 1;
  seqs.set(run, seq);
  const frame: SubagentFrame = {
    run,
    sid: SID,
    seq,
    meta: { subagent: run, ...runMeta },
    snapshot: runDocs,
  };
  act(() => getSubagentRunStore(mx).ingest(ROOM_ID, SENDER, frame, Date.now()));
};

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

const render = () => {
  act(() => {
    root.render(
      <ClientConfigProvider value={{}}>
        <MatrixClientProvider value={mx}>
          <SubagentsPanel room={room} onClose={onClose} />
        </MatrixClientProvider>
      </ClientConfigProvider>
    );
  });
};

const cards = () => [...container.querySelectorAll<HTMLElement>('[data-subagent]')];
const card = (run: string) => {
  const found = container.querySelector<HTMLElement>(`[data-subagent="${run}"]`);
  if (!found) throw new Error(`no card for ${run}`);
  return found;
};
const button = (scope: HTMLElement, name: string) => {
  const found = [...scope.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === name || candidate.getAttribute('aria-label') === name
  );
  if (!found) throw new Error(`no button ${name}`);
  return found;
};
/** The open run, or null while the list shows. */
const view = () => container.querySelector<HTMLElement>('[data-subagent-view]');
const open = (run: string) => act(() => card(run).click());
const transcript = () => view()?.querySelector<HTMLElement>('[data-subagent-transcript]') ?? null;
const heading = () => container.querySelector('header h2')?.textContent;

beforeAll(async () => {
  await loadLiveMarkdown();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW * 1000 });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  seqs.clear();
  navigation.navigateRoomThread.mockReset();
  onClose.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  getSubagentRunStore(mx).clear();
  vi.useRealTimers();
});

describe('SubagentsPanel', () => {
  it('says so while the room has no sub-agents, and closes', () => {
    render();

    expect(container.textContent).toContain('No sub-agents are running in this room.');
    expect(cards()).toHaveLength(0);
    act(() => button(container, 'Close').click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lists a card per run, the one that started first on top, titled by its task', () => {
    ingest('late', meta('running', { agent: 'writer', startedAt: NOW - 10 }), docs('Drafting.'));
    ingest(
      'early',
      meta('running', { task: 'Find when version 2 shipped.\nCite the changelog.' }),
      docs('Looking it up.')
    );
    render();

    expect(cards().map((element) => element.dataset.subagent)).toEqual(['early', 'late']);
    expect(container.querySelector('header')?.textContent).toContain('2 active');
    // The task's first line is the title; a run without a task goes by its agent.
    expect(card('early').textContent).toContain('Find when version 2 shipped.');
    expect(card('early').textContent).not.toContain('Cite the changelog.');
    expect(card('early').textContent).toContain('Looking it up.');
    // A member shows by the room's name for them, an agent outside the room by its own name.
    expect(card('early').textContent).toContain('Research Desk');
    expect(card('late').textContent).toContain('writer');
    expect(card('early').textContent).toContain('Running');
    expect(card('early').textContent).toContain('45 sec');
  });

  it("names a namespaced MindRoom's agent by its account, with the agent's picture", () => {
    ingest('run', meta('running', { agent: 'helper', caller: 'coordinator' }), docs('Looking.'));
    render();

    expect(card('run').textContent).toContain('Helper Desk');
    expect(card('run').querySelector('img')?.getAttribute('src')).toBe(
      'https://media.example.org/example.org/helper'
    );
  });

  it('lists finished runs after the running ones, the one that ended last first', () => {
    ingest('old', meta('completed', { endedAt: NOW - 300 }), docs('A', [], false));
    ingest('busy', meta('running'), docs('B'));
    ingest('new', meta('failed', { endedAt: NOW - 20 }), docs('C', [], false));
    render();

    expect(cards().map((element) => element.dataset.subagent)).toEqual(['busy', 'new', 'old']);
    expect(container.querySelector('header')?.textContent).toContain('1 active');
  });

  it('counts paused runs and runs waiting for approval as active, as the header badge does', () => {
    ingest('waiting', meta('awaiting_approval'), docs('May I?'));
    ingest('paused', meta('paused', { startedAt: NOW - 30 }), docs('Later.', [], false));
    ingest('done', meta('completed'), docs('Done.', [], false));
    render();

    expect(container.querySelector('header')?.textContent).toContain('2 active');
  });

  it('names each status', () => {
    const statuses: Array<[SubagentStatus, string]> = [
      ['running', 'Running'],
      ['awaiting_approval', 'Waiting for approval'],
      ['paused', 'Paused'],
      ['completed', 'Done'],
      ['failed', 'Failed'],
      ['cancelled', 'Stopped'],
      ['denied', 'Denied'],
    ];
    statuses.forEach(([status], index) =>
      ingest(status, meta(status, { startedAt: NOW - 60 + index }), docs('Text.', [], false))
    );
    render();

    statuses.forEach(([status, label]) => expect(card(status).textContent).toContain(label));
  });

  it('previews what a run wrote as a thread card does, and why a failed one ended', () => {
    ingest(
      'tools',
      meta('running'),
      docs('Checking **the tags**.\n\n🔧 `run_shell_command` [1] ⏳\n\n', [
        { type: 'tool_call_started', tool_name: 'run_shell_command' },
      ])
    );
    ingest(
      'broke',
      meta('failed', { result: 'Tool **crashed**.', endedAt: NOW - 5 }),
      docs('Trying.', [], false)
    );
    render();

    expect(card('tools').textContent).toContain('1 tool');
    expect(card('tools').textContent).toContain('Checking the tags.');
    expect(card('broke').textContent).toContain('Tool crashed.');
    expect(card('broke').textContent).not.toContain('Trying.');
  });

  it('lists the runs a run started inside it, counted on its card, and an orphan on its own', () => {
    ingest('parent', meta('running'), docs('Splitting the work.'));
    ingest('child', meta('running', { agent: 'writer', parent: 'parent' }), docs('Writing.'));
    ingest('orphan', meta('running', { parent: 'gone', startedAt: NOW - 5 }), docs('Alone.'));
    render();

    expect(cards().map((element) => element.dataset.subagent)).toEqual(['parent', 'orphan']);
    expect(card('parent').textContent).toContain('1 sub-agent');
    expect(card('orphan').textContent).not.toContain('sub-agent');
  });

  it("shows a sub-agent's turns as one card and opens them as one thread, in order", () => {
    const turn = (run: string, subagent: string, n: number, status: SubagentStatus) =>
      ingest(
        run,
        meta(status, {
          subagent,
          task: `Turn ${n}.`,
          startedAt: NOW - 40 + n * 10,
          endedAt: status === 'running' ? null : NOW - 35 + n * 10,
        }),
        docs(`Answer ${n} of ${subagent}.`, [], status === 'running')
      );
    turn('a3', 'a', 3, 'running');
    turn('a1', 'a', 1, 'completed');
    turn('b1', 'b', 1, 'completed');
    turn('a2', 'a', 2, 'completed');
    render();

    expect(cards().map((element) => element.dataset.subagent)).toEqual(['a', 'b']);
    expect(card('a').textContent).toContain('Turn 1.');
    expect(card('a').textContent).toContain('Answer 3 of a.');
    expect(card('a').textContent).toContain('Running');
    expect(card('a').textContent).toContain('3 turns');
    expect(card('b').textContent).not.toContain('turn');

    open('a');
    const tasks = [...(view()?.querySelectorAll('[data-subagent-task]') ?? [])];
    expect(tasks.map((task) => task.textContent)).toEqual(['Turn 1.', 'Turn 2.', 'Turn 3.']);
    const answers = [...(view()?.querySelectorAll('[data-subagent-transcript]') ?? [])];
    expect(answers.map((answer) => answer.textContent?.trim())).toEqual([
      'Answer 1 of a.',
      'Answer 2 of a.',
      'Answer 3 of a.',
    ]);
  });

  it('nests a sub-agent under the turn that started it, and goes back to its starter', () => {
    ingest('p1', meta('completed', { subagent: 'p', task: 'Plan it.' }), docs('Planned.'));
    ingest(
      'p2',
      meta('running', { subagent: 'p', task: 'Do it.', startedAt: NOW - 20 }),
      docs('Doing.')
    );
    ingest(
      'c1',
      meta('running', { agent: 'writer', parent: 'p2', task: 'Write it.', startedAt: NOW - 10 }),
      docs('Writing.')
    );
    render();

    expect(cards().map((element) => element.dataset.subagent)).toEqual(['p']);
    expect(card('p').textContent).toContain('2 turns');
    expect(card('p').textContent).toContain('1 sub-agent');
    open('p');
    // The second turn's task, then the card of the sub-agent it started, then its reply.
    const parts = view()?.querySelectorAll<HTMLElement>(
      '[data-subagent-task], [data-subagent], [data-subagent-transcript]'
    );
    const order = [...(parts ?? [])].map(
      (part) => part.dataset.subagent ?? part.textContent?.trim()
    );
    expect(order).toEqual(['Plan it.', 'Planned.', 'Do it.', 'c1', 'Doing.']);

    open('c1');
    expect(heading()).toBe('writer');
    act(() => button(container, 'Back').click());
    expect(view()?.dataset.subagentView).toBe('p');
    act(() => button(container, 'Back').click());
    expect(document.activeElement).toBe(card('p'));
  });

  it('opens a run as a thread: the caller asks, the run answers with its tool calls', () => {
    ingest(
      'run',
      meta('running', { task: 'Find the tags.' }),
      docs('Checking **the tags**.\n\n🔧 `run_shell_command` [1] ⏳\n\n', [
        {
          type: 'tool_call_started',
          tool_name: 'run_shell_command',
          args_preview: 'command=git tag',
        },
      ])
    );
    render();
    open('run');

    expect(heading()).toBe('Research Desk');
    expect(container.querySelector('header')?.textContent).toContain('Running');
    expect(view()?.querySelector('[data-subagent-task]')?.textContent).toBe('Find the tags.');
    // The caller's message, then the run's.
    const [asked, answer] = [...(view()?.querySelectorAll('[data-subagent-message]') ?? [])];
    expect(asked?.textContent).toContain('Lead');
    expect(asked?.textContent).toContain('Find the tags.');
    expect(answer?.textContent).toContain('Research Desk');
    const body = transcript();
    expect(body?.querySelector('strong')?.textContent).toBe('the tags');
    const calls = body?.querySelector<HTMLButtonElement>('[data-message-disclosure] > button');
    expect(calls?.textContent).toContain('Running 1 tool call');
    act(() => calls?.click());
    expect(body?.querySelector('[data-tool-index="1"]')?.textContent).toContain('git tag');
  });

  it('shows the typing dots while an open run is running, not while it waits for approval', () => {
    ingest('waiting', meta('awaiting_approval'), docs('May I run it?'));
    ingest('busy', meta('running', { startedAt: NOW - 30 }), docs('Working.'));
    render();
    const dots = () => transcript()?.querySelector('[aria-label="AI is responding"]') ?? null;

    open('waiting');
    expect(transcript()?.textContent).toContain('May I run it?');
    expect(dots()).toBeNull();
    act(() => button(container, 'Back').click());
    open('busy');
    expect(dots()).not.toBeNull();
  });

  it('shows the typing dots only in the newest turn, not in one that missed its end', () => {
    const turn = (run: string, startedAt: number) =>
      ingest(run, meta('running', { subagent: 'sub', task: run, startedAt }), docs(`${run} text`));
    turn('first', NOW - 30);
    turn('second', NOW - 10);
    render();
    expect(container.textContent).toContain('1 active');
    open('sub');

    const answers = [...(view()?.querySelectorAll('[data-subagent-transcript]') ?? [])];
    const typing = answers.map(
      (answer) => !!answer.querySelector('[aria-label="AI is responding"]')
    );
    expect(typing).toEqual([false, true]);
  });

  it('answers with the result when a run wrote nothing, and says why a failed run ended', () => {
    ingest(
      'quiet',
      meta('completed', { result: 'Version 2 shipped in **March**.' }),
      docs('', [], false)
    );
    ingest(
      'broke',
      meta('failed', { result: 'Tool crashed.', endedAt: NOW - 5 }),
      docs('Trying.', [], false)
    );
    render();

    open('quiet');
    expect(transcript()?.querySelector('strong')?.textContent).toBe('March');
    act(() => button(container, 'Back').click());
    open('broke');
    expect(transcript()?.textContent).toContain('Trying.');
    expect(view()?.querySelector('[data-subagent-failure]')?.textContent).toBe('Tool crashed.');
  });

  it('says why a failed run that wrote nothing ended, not as its answer', () => {
    ingest('broke', meta('failed', { result: 'Tool crashed.' }), docs('', [], false));
    render();
    open('broke');

    expect(transcript()).toBeNull();
    expect(view()?.querySelector('[data-subagent-failure]')?.textContent).toBe('Tool crashed.');
    expect(view()?.querySelectorAll('[data-subagent-message]')).toHaveLength(1);
  });

  it('shows no reply for a run that ended without writing anything', () => {
    ingest('quiet', meta('cancelled', { task: 'Wait.' }), docs('', [], false));
    render();
    open('quiet');

    expect(view()?.textContent).toContain('Wait.');
    expect(transcript()).toBeNull();
    expect(view()?.textContent).not.toContain('Thinking');
  });

  it('opens a run it started from its cards, and goes back up one run at a time', () => {
    ingest(
      'parent',
      meta('completed', { result: 'All done.' }),
      docs('Asked a writer.', [], false)
    );
    ingest(
      'child',
      meta('completed', { agent: 'writer', parent: 'parent', task: 'Write it.' }),
      docs('Written.', [], false)
    );
    render();

    open('parent');
    expect(heading()).toBe('Research Desk');
    // The card that opened it is gone; focus moves to the way back.
    expect(document.activeElement).toBe(button(container, 'Back'));
    expect(card('child').textContent).toContain('Write it.');
    // Its cards come before its reply, whose end a reader follows.
    const reply = transcript();
    expect(reply && card('child').compareDocumentPosition(reply)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    open('child');
    expect(heading()).toBe('writer');
    expect(transcript()?.textContent).toContain('Written.');
    act(() => button(container, 'Back').click());
    expect(heading()).toBe('Research Desk');
    // Back gives focus to the card of the run it closed.
    expect(document.activeElement).toBe(card('child'));
    act(() => button(container, 'Back').click());
    expect(view()).toBeNull();
    expect(heading()).toBe('Sub-agents');
    expect(document.activeElement).toBe(card('parent'));
  });

  it('opens the thread the run was started from', () => {
    ingest('run', meta('running', { threadId: '$thread:example.org' }), docs('Looking.'));
    ingest('loose', meta('running', { threadId: null, startedAt: NOW - 5 }), docs('Looking.'));
    render();

    open('run');
    act(() => button(container, 'Open thread').click());
    expect(navigation.navigateRoomThread).toHaveBeenCalledWith(ROOM_ID, '$thread:example.org');
    act(() => button(container, 'Back').click());
    open('loose');
    expect(() => button(container, 'Open thread')).toThrow();
  });

  it('shows the list again when the open run is gone', () => {
    ingest('run', meta('running'), docs('Looking.'));
    render();
    open('run');
    expect(view()).not.toBeNull();

    act(() => getSubagentRunStore(mx).clear());
    expect(view()).toBeNull();
    expect(container.textContent).toContain('No sub-agents are running in this room.');
    // The focus its Back held goes to the panel, not the page.
    expect(document.activeElement).toBe(container.querySelector('[data-testid="subagents-panel"]'));
    // The run's next frame lists it again without opening it.
    seqs.clear();
    ingest('run', meta('running'), docs('Still looking.'));
    expect(view()).toBeNull();
    expect(card('run').textContent).toContain('Still looking.');
  });

  it('opens an ended run at its task and stays there', () => {
    ingest('run', meta('completed'), docs('First line.', [], false));
    render();
    open('run');
    const box = view();
    if (!box) throw new Error('no open run');
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => 1_000 });
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 200 });

    ingest('run', meta('completed'), docs('First line. Second line.', [], false));
    expect(box.scrollTop).toBe(0);
  });

  it("follows a sub-agent's next turn when the reader is at the end, not when they scrolled up", () => {
    const turn = (run: string, status: SubagentStatus, startedAt: number) =>
      ingest(run, meta(status, { subagent: 'sub', task: run, startedAt }), docs(`${run} text`));
    turn('first', 'completed', NOW - 40);
    render();
    open('sub');
    const box = view();
    if (!box) throw new Error('no open sub-agent');
    let height = 150;
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => height });
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 200 });

    // The whole thread fits: the reader sees its end, so the next turn is followed.
    turn('first', 'completed', NOW - 40);
    height = 1_000;
    turn('second', 'running', NOW - 20);
    expect(box.scrollTop).toBe(1_000);

    // A reader who scrolled up after a turn ended keeps their place when another turn starts.
    turn('second', 'completed', NOW - 20);
    expect(box.scrollTop).toBe(1_000);
    box.scrollTop = 300;
    act(() => {
      box.dispatchEvent(new Event('scroll'));
    });
    height = 2_000;
    turn('third', 'running', NOW - 10);
    expect(box.scrollTop).toBe(300);
  });

  it('follows new text at the end of a running run until the reader scrolls up more than 24 px', () => {
    ingest('run', meta('running'), docs('First line.'));
    render();
    open('run');
    const box = view();
    if (!box) throw new Error('no open run');
    let height = 1_000;
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => height });
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 200 });
    const grow = (md: string) => {
      height += 100;
      ingest('run', meta('running'), docs(md));
    };

    grow('First line. Second line.');
    expect(box.scrollTop).toBe(1_100);

    // 20 px above the end still counts as there.
    box.scrollTop = height - 200 - 20;
    act(() => {
      box.dispatchEvent(new Event('scroll'));
    });
    grow('First line. Second line. Third line.');
    expect(box.scrollTop).toBe(1_200);

    // 30 px above it, the reader keeps their place.
    box.scrollTop = height - 200 - 30;
    act(() => {
      box.dispatchEvent(new Event('scroll'));
    });
    grow('First line. Second line. Third line. Fourth line.');
    expect(box.scrollTop).toBe(970);
  });
});
