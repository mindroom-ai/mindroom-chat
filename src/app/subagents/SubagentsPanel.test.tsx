// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../config/useClientConfig';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import type { LiveDocs } from '../matrix/protocol/liveFrame';
import type { SubagentFrame, SubagentMeta, SubagentStatus } from '../matrix/protocol/subagentFrame';
import type { ToolTraceEvent } from '../matrix/protocol/toolTrace';
import { MessageTextBody as MessageTextBodyCss } from '../messages/layout/layout.css';
import { loadLiveMarkdown } from '../messages/live/liveMarkdown';
import { getSubagentRunStore } from '../messages/live/subagentRunStore';
import { openSubagentsPanel, subagentsPanelAtom } from '../navigation/subagentsPanel';
import { getSettings, settingsAtom } from '../preferences/settings';
import { SubagentsPanel } from './SubagentsPanel';
import { keepCancelsOf } from '../matrix/state/sentCancels';
import { showToolCalls } from '../../test/utils/showToolCalls';
import { showUsageDetails } from '../../test/utils/showUsageDetails';

// These tests show how tool calls render, so they show them; and what runs used, so they show the
// usage details too, but for the tests of how they start, without them.
beforeEach(showToolCalls);
beforeEach(() => showUsageDetails());

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
const markdownState = vi.hoisted(() => ({ readyOverride: undefined as boolean | undefined }));
vi.mock('../messages/live/liveMarkdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../messages/live/liveMarkdown')>();
  return {
    ...actual,
    useLiveMarkdownReady: (wanted?: boolean) => {
      const ready = actual.useLiveMarkdownReady(wanted);
      return markdownState.readyOverride ?? ready;
    },
  };
});
// The room's background jobs, which an open run's Stop cancels, and whether the viewer may.
const jobsState = vi.hoisted(() => ({
  jobs: [] as import('../matrix/protocol/backgroundJobsContract').BackgroundJob[],
  canCancel: true,
}));
vi.mock('../matrix/hooks/useRoomBackgroundJobs', () => ({
  useRoomBackgroundJobs: () => ({ jobs: jobsState.jobs, total: jobsState.jobs.length }),
}));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ event: () => jobsState.canCancel }),
}));
// The swipe from the screen's left edge the panel last asked for, and whether it is on.
const edgeSwipe = vi.hoisted(() => ({ onBack: (): void => undefined, enabled: false }));
vi.mock('../navigation/useEdgeSwipeBack', () => ({
  useEdgeSwipeBack: (onBack: () => void, enabled = true) => {
    edgeSwipe.onBack = onBack;
    edgeSwipe.enabled = enabled;
  },
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
  getEventForTxnId: () => undefined,
  membersLoaded: () => true,
  loadMembersIfNeeded: () => Promise.resolve(true),
  hasEncryptionStateEvent: () => false,
} as unknown as Room;

const sendEvent = vi.fn();
const mx = {
  sendEvent: (...args: unknown[]) => sendEvent(...args),
  makeTxnId: () => 'txn',
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

  segments: [],
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

const render = (
  screenSize: ScreenSize = ScreenSize.Desktop,
  threadId?: string | null,
  readOnly = false
) => {
  act(() => {
    root.render(
      <ScreenSizeProvider value={screenSize}>
        <ClientConfigProvider value={{}}>
          <MatrixClientProvider value={mx}>
            <SubagentsPanel room={room} threadId={threadId} onClose={onClose} readOnly={readOnly} />
          </MatrixClientProvider>
        </ClientConfigProvider>
      </ScreenSizeProvider>
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
  edgeSwipe.enabled = false;
  markdownState.readyOverride = undefined;
  jobsState.jobs = [];
  jobsState.canCancel = true;
  sendEvent.mockReset();
  sendEvent.mockResolvedValue({ event_id: '$sent' });
  keepCancelsOf(ROOM_ID, new Set());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  getSubagentRunStore(mx).clear();
  getDefaultStore().set(subagentsPanelAtom, undefined);
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

  it('lists only the runs started in the conversation on screen, and counts only those', () => {
    ingest('here', meta('running', { threadId: '$thread:example.org' }), docs('Here.'));
    ingest('other', meta('running', { threadId: '$other:example.org' }), docs('Elsewhere.'));
    ingest('room', meta('running', { threadId: null }), docs('In the room.'));
    render(ScreenSize.Desktop, '$thread:example.org');

    expect(cards().map((element) => element.dataset.subagent)).toEqual(['here']);
    expect(container.querySelector('header')?.textContent).toContain('1 active');

    // The room's own timeline lists the runs started there, not those of its threads.
    render(ScreenSize.Desktop, null);
    expect(cards().map((element) => element.dataset.subagent)).toEqual(['room']);

    // A thread without runs says so of the thread.
    render(ScreenSize.Desktop, '$empty:example.org');
    expect(cards()).toHaveLength(0);
    expect(container.textContent).toContain('No sub-agents are running in this thread.');
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
    // How long it has run, as the jobs bar says it.
    expect(card('early').querySelector('[data-subagent-time]')?.textContent).toBe('45s');
  });

  it("names a namespaced MindRoom's agent by its account, with the agent's picture", () => {
    ingest('run', meta('running', { agent: 'helper', caller: 'coordinator' }), docs('Looking.'));
    render();

    expect(card('run').textContent).toContain('Helper Desk');
    expect(card('run').querySelector('img')?.getAttribute('src')).toBe(
      'https://media.example.org/example.org/helper'
    );
  });

  it("shows the model of a sub-agent's newest turn after its agent, and none it was not sent", () => {
    const opus = {
      modelConfig: 'harry_opus',
      modelDisplayName: 'Opus 5.5',
      modelId: 'anthropic/claude-opus-5.5',
      modelProvider: 'openrouter',
    };
    ingest(
      'modeled',
      meta('completed', { subagent: 'modeled', model: { modelConfig: 'sonnet' } }),
      docs('A.')
    );
    ingest(
      'modeled-2',
      meta('running', { subagent: 'modeled', model: opus, startedAt: NOW - 10 }),
      docs('B.')
    );
    ingest(
      'unnamed',
      meta('running', { model: { modelConfig: 'bedtime_fable' }, startedAt: NOW - 8 }),
      docs('C.')
    );
    ingest('old', meta('running', { startedAt: NOW - 5 }), docs('D.'));
    render();

    const model = card('modeled').querySelector('[data-subagent-model]');
    expect(model?.textContent).toBe('Opus 5.5');
    expect(model?.getAttribute('title')).toBe(
      'harry_opus (openrouter / anthropic/claude-opus-5.5)'
    );
    // Without a display name, the short name the message badge shows.
    expect(card('unnamed').querySelector('[data-subagent-model]')?.textContent).toBe(
      'Bedtime Fable'
    );
    // After the agent's name, before its status.
    const name = [...card('modeled').querySelectorAll('span')].find(
      (element) => element.textContent === 'Research Desk'
    );
    expect(name?.compareDocumentPosition(model as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(model?.nextElementSibling?.textContent).toBe('Running');
    expect(card('old').querySelector('[data-subagent-model]')).toBeNull();

    open('modeled');
    // The open run's header: its agent, then its model, its turn and, without usage, its status.
    const standing = container.querySelector('header [data-subagent-model]');
    expect(standing?.textContent).toBe('Opus 5.5');
    expect(standing?.previousElementSibling?.textContent).toBe('Research Desk');
    expect(standing?.parentElement?.textContent).toContain('Running');
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

    // A run at a call says so instead.
    expect(card('tools').querySelector('[data-subagent-line]')?.textContent).toBe(
      'Nowrun_shell_command'
    );
    expect(card('broke').querySelector('[data-subagent-line]')?.textContent).toBe(
      '✕FailedTool crashed.'
    );
    expect(card('broke').textContent).not.toContain('Trying.');
    // Between calls it previews what it wrote, unlabelled, as before.
    ingest(
      'tools',
      meta('running'),
      docs('Checking **the tags**.\n\n🔧 `run_shell_command` [1]\n\n', [
        { type: 'tool_call_completed', tool_name: 'run_shell_command' },
      ])
    );
    const line = card('tools').querySelector('[data-subagent-line]');
    expect(line?.getAttribute('data-subagent-line')).toBe('plain');
    expect(line?.textContent).toContain('1 tool');
    expect(line?.textContent).toContain('Checking the tags.');
  });

  it('lists the runs a run started inside its card, and an orphan on its own', () => {
    ingest('parent', meta('running'), docs('Splitting the work.'));
    ingest('child', meta('running', { agent: 'writer', parent: 'parent' }), docs('Writing.'));
    ingest('orphan', meta('running', { parent: 'gone', startedAt: NOW - 5 }), docs('Alone.'));
    render();

    expect(cards().map((element) => element.dataset.subagent)).toEqual(['parent', 'orphan']);
    const child = card('parent').querySelector('[data-subagent-nested]');
    expect(child?.getAttribute('data-subagent-nested')).toBe('child');
    expect(child?.textContent).toContain('writer');
    expect(child?.querySelector('[data-subagent-line]')?.textContent).toBe('Writing.');
    expect(card('orphan').querySelector('[data-subagent-nested]')).toBeNull();
  });

  it('says a paused run inside a card is paused, beside its time', () => {
    ingest('parent', meta('running'), docs('Splitting the work.'));
    ingest(
      'child',
      meta('paused', { agent: 'writer', parent: 'parent', startedAt: NOW - 30 }),
      docs('Later.', [], false)
    );
    render();

    const time = card('parent').querySelector('[data-subagent-nested-time]');
    expect(time?.textContent).toBe('Paused 30s');
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
    expect(tasks.map((task) => task.textContent?.trim())).toEqual([
      'Turn 1.',
      'Turn 2.',
      'Turn 3.',
    ]);
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
    expect(card('p').querySelector('[data-subagent-nested]')?.textContent).toContain('Write it.');
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
    expect(heading()).toBe('Write it.');
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

    // Its task's first line heads it, its agent under it.
    expect(heading()).toBe('Find the tags.');
    expect(container.querySelector('header [data-subagent-agent]')?.textContent).toBe(
      'Research Desk'
    );
    expect(container.querySelector('header')?.textContent).toContain('Running');
    // The call it makes now, under the header.
    expect(container.querySelector('[data-subagent-now]')?.textContent).toContain(
      'run_shell_command command=git tag'
    );
    expect(view()?.querySelector('[data-subagent-task]')?.textContent?.trim()).toBe(
      'Find the tags.'
    );
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

  it('renders a Markdown task as formatted HTML without pre-wrap', () => {
    const markdownTask =
      '> Quoted note from the issue.\n\n## Release checklist\n\n' +
      'Check **cache TTL** in `config.toml` against [the spec](https://example.org/spec):\n\n' +
      '- Verify retry backoff\n- Confirm metrics export';
    ingest('run', meta('running', { task: markdownTask }), docs('Working.'));
    render();
    open('run');

    const task = view()?.querySelector<HTMLElement>('[data-subagent-task]');
    expect(task?.dataset.subagentTurn).toBe('run');
    expect(task?.getAttribute('dir')).toBe('ltr');
    expect(task?.dataset.bodyDirection).toBe('ltr');
    expect(task?.querySelector('blockquote')?.textContent?.trim()).toBe(
      'Quoted note from the issue.'
    );
    expect(task?.querySelector('h2')?.textContent).toBe('Release checklist');
    expect(task?.querySelector('strong')?.textContent).toBe('cache TTL');
    expect(task?.querySelector('code')?.textContent).toBe('config.toml');
    expect([...(task?.querySelectorAll('ul li') ?? [])].map((item) => item.textContent)).toEqual([
      'Verify retry backoff',
      'Confirm metrics export',
    ]);
    const link = task?.querySelector<HTMLAnchorElement>('a');
    expect(link?.textContent).toBe('the spec');
    expect(link?.getAttribute('href')).toBe('https://example.org/spec');
    expect(task?.classList.contains(MessageTextBodyCss.classNames.variants.preWrap.true)).toBe(
      false
    );
  });

  it('sanitizes HTML in a task and keeps quoted tool markers literal', () => {
    const taskText =
      'Inspect this output:\n\n' +
      '<script>alert(1)</script><iframe src="https://example.org"></iframe>\n' +
      '<a href="javascript:alert(1)">bad</a> <span onclick="alert(1)">safe</span>\n\n' +
      '🔧 `run_shell_command` [1] ⏳';
    ingest('run', meta('running', { task: taskText }), docs('Checking.'));
    render();
    open('run');

    const task = view()?.querySelector<HTMLElement>('[data-subagent-task]');
    expect(task?.querySelector('script, iframe')).toBeNull();
    expect(task?.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(task?.querySelector('[onclick]')).toBeNull();
    expect(task?.textContent).toContain('safe');
    expect(task?.querySelector('[data-message-disclosure], [data-tool-index]')).toBeNull();
    expect(task?.textContent).toContain('🔧 run_shell_command [1] ⏳');
  });

  it('uses pre-wrap while the Markdown renderer is not ready, then switches to HTML', () => {
    markdownState.readyOverride = false;
    ingest('run', meta('running', { task: '## Plan\n\nKeep **line breaks**.' }), docs('Working.'));
    render();
    open('run');

    const preWrapClass = MessageTextBodyCss.classNames.variants.preWrap.true;
    const task = () => view()?.querySelector<HTMLElement>('[data-subagent-task]');
    expect(task()?.classList.contains(preWrapClass)).toBe(true);
    expect(task()?.querySelector('h2, strong')).toBeNull();
    expect(task()?.textContent).toBe('## Plan\n\nKeep **line breaks**.');

    markdownState.readyOverride = undefined;
    render();
    expect(task()?.classList.contains(preWrapClass)).toBe(false);
    expect(task()?.querySelector('h2')?.textContent).toBe('Plan');
    expect(task()?.querySelector('strong')?.textContent).toBe('line breaks');
  });

  it('shows how long a running tool call has run once it ran 10 seconds, on one ticking clock', () => {
    // The panel's clock ticks by its interval.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW * 1000 });
    ingest(
      'run',
      meta('running', { startedAt: NOW - 300 }),
      docs('Working.\n\n🔧 `bash` [1] ⏳\n\n🔧 `grep` [2] ⏳\n\n🔧 `read_file` [3]\n\n', [
        { type: 'tool_call_started', tool_name: 'bash', started_at: NOW - 125 },
        { type: 'tool_call_started', tool_name: 'grep', started_at: NOW - 4 },
        {
          type: 'tool_call_completed',
          tool_name: 'read_file',
          result_preview: 'ok',
          started_at: NOW - 200,
        },
      ])
    );
    render();
    open('run');
    const elapsed = (scope: Element | null | undefined) =>
      scope?.querySelector('[data-tool-elapsed]')?.textContent ?? null;
    const row = (index: number) => transcript()?.querySelector(`[data-tool-index="${index}"]`);
    const line = transcript()?.querySelector<HTMLButtonElement>(
      '[data-message-disclosure] > button'
    );

    // Folded, the line shows the call that has run longest.
    expect(elapsed(line)).toBe('2m 5s');
    act(() => line?.click());
    expect(elapsed(row(1))).toBe('2m 5s');
    expect(row(1)?.querySelector('[data-tool-elapsed]')?.getAttribute('title')).toBe(
      'Running for 2m 5s'
    );
    expect(elapsed(row(2))).toBeNull();
    // A finished call shows nothing new.
    expect(elapsed(row(3))).toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(elapsed(row(1))).toBe('2m 15s');
    expect(elapsed(row(2))).toBe('14s');
    expect(elapsed(line)).toBe('2m 15s');
  });

  const BASH_MD = 'Working.\n\n🔧 `bash` [1] ⏳\n\n';
  const bash = (type: string, startedAt: number): ToolTraceEvent => ({
    type,
    tool_name: 'bash',
    started_at: startedAt,
  });
  /** The times the open run shows, on its line and its row, with its calls unfolded. */
  const shownTimes = () => {
    const line = transcript()?.querySelector<HTMLButtonElement>(
      '[data-message-disclosure] > button'
    );
    if (line?.getAttribute('aria-expanded') === 'false') act(() => line.click());
    expect(transcript()?.querySelector('[data-tool-index="1"]')).not.toBeNull();
    return [...(transcript()?.querySelectorAll('[data-tool-elapsed]') ?? [])].map(
      (element) => element.textContent
    );
  };

  it.each([
    ['9.9 seconds ago, no time', NOW - 9.9, []],
    ['10 seconds ago, its time', NOW - 10, ['10s', '10s']],
    // A server clock ahead of the viewer's: no time, and never a negative one.
    ['30 seconds from now, no time', NOW + 30, []],
  ])('shows for a running call that started %s', (_name, startedAt, times) => {
    ingest('run', meta('running'), docs(BASH_MD, [bash('tool_call_started', startedAt)]));
    render();
    open('run');

    expect(shownTimes()).toEqual(times);
  });

  it.each([
    ['the call completes', meta('running'), docs(BASH_MD, [bash('tool_call_completed', NOW - 60)])],
    [
      'the run ends with the call unfinished',
      meta('completed'),
      docs(BASH_MD, [bash('tool_call_started', NOW - 60)], false),
    ],
    [
      'the run pauses with the call unfinished',
      meta('paused'),
      docs(BASH_MD, [bash('tool_call_started', NOW - 60)], false),
    ],
  ])('drops the time of a running call once %s', (_name, nextMeta, nextDocs) => {
    ingest('run', meta('running'), docs(BASH_MD, [bash('tool_call_started', NOW - 60)]));
    render();
    open('run');
    expect(shownTimes()).toEqual(['1m 0s', '1m 0s']);

    ingest('run', nextMeta, nextDocs);
    expect(shownTimes()).toEqual([]);
  });

  it('shows no tool time without a start from MindRoom, nor once the run has ended', () => {
    ingest(
      'older',
      meta('running'),
      docs('Working.\n\n🔧 `bash` [1] ⏳\n\n', [{ type: 'tool_call_started', tool_name: 'bash' }])
    );
    ingest(
      'ended',
      meta('completed', { startedAt: NOW - 30 }),
      docs(
        'Stopped.\n\n🔧 `bash` [1] ⏳\n\n',
        [{ type: 'tool_call_started', tool_name: 'bash', started_at: NOW - 600 }],
        false
      )
    );
    render();

    ['older', 'ended'].forEach((run) => {
      open(run);
      const line = transcript()?.querySelector<HTMLButtonElement>(
        '[data-message-disclosure] > button'
      );
      act(() => line?.click());
      expect(transcript()?.querySelector('[data-tool-index="1"]')).not.toBeNull();
      expect(transcript()?.querySelector('[data-tool-elapsed]')).toBeNull();
      act(() => button(container, 'Back').click());
    });
  });

  it.each<[string, RunMeta]>([
    ['interrupted by a restart', meta('failed', { interruptedByRestart: true })],
    ['failed', meta('failed')],
    ['cancelled', meta('cancelled')],
    ['denied', meta('denied')],
  ])("marks unfinished tool calls as didn't complete once a turn is %s", (_label, runMeta) => {
    const md = 'Working.\n\n🔧 `read_file` [1]\n\n🔧 `bash` [2] ⏳\n\n';
    const tools: ToolTraceEvent[] = [
      { type: 'tool_call_completed', tool_name: 'read_file' },
      bash('tool_call_started', NOW - 60),
    ];
    ingest('run', runMeta, docs(md, tools, false));
    render();
    open('run');

    const line = transcript()?.querySelector<HTMLButtonElement>(
      '[data-message-disclosure] > button'
    );
    expect(line?.textContent).toContain("Ran 2 tool calls · 1 didn't complete");
    expect(line?.textContent).not.toContain('Running');
    act(() => line?.click());
    expect(transcript()?.querySelector('[data-tool-index="1"]')?.textContent).not.toContain(
      "Didn't complete"
    );
    expect(transcript()?.querySelector('[data-tool-index="2"]')?.textContent).toContain(
      "Didn't complete"
    );

    act(() => getDefaultStore().set(settingsAtom, { ...getSettings(), showToolCalls: false }));
    const cog = transcript()?.querySelector<HTMLElement>('[data-tool-calls-fold]');
    expect(cog?.dataset.state).toBe('failed');
    expect(cog?.querySelector('button')?.getAttribute('aria-label')).toBe(
      "Ran 2 tool calls · 1 didn't complete"
    );
  });

  it('settles unfinished calls on completed and older turns, while a running newest turn stays running', () => {
    const started = (at: number, working = true) =>
      docs(BASH_MD, [bash('tool_call_started', at)], working);
    ingest('done', meta('completed'), started(NOW - 60, false));
    ingest('first', meta('running', { subagent: 'sub', startedAt: NOW - 30 }), started(NOW - 30));
    ingest('second', meta('running', { subagent: 'sub', startedAt: NOW - 10 }), started(NOW - 10));
    render();

    open('done');
    const doneText = transcript()?.textContent;
    act(() => button(container, 'Back').click());
    open('sub');
    const answers = [...(view()?.querySelectorAll('[data-subagent-transcript]') ?? [])];
    [doneText, answers[0]?.textContent].forEach((text) => {
      expect(text).toContain('Ran 1 tool call');
      expect(text).not.toContain('Running');
      expect(text).not.toContain("didn't complete");
    });
    expect(answers[1]?.textContent).toContain('Running 1 tool call');
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

  it('shows a turn a restart cut short as interrupted, with its reason, not as failed', () => {
    const reason = 'Interrupted by a restart; MindRoom continues it when it can.';
    ingest(
      'cut',
      meta('failed', { result: reason, interruptedByRestart: true }),
      docs('Trying.', [], false)
    );
    render();

    expect(card('cut').textContent).toContain('Interrupted');
    expect(card('cut').textContent).not.toContain('Failed');
    expect(card('cut').textContent).toContain(reason);
    open('cut');
    expect(view()?.querySelector('[data-subagent-failure]')).toBeNull();
    expect(view()?.querySelector('[data-subagent-interruption]')?.textContent).toBe(reason);
    expect(view()?.textContent).not.toContain('Failed');
  });

  it('reads only a failed turn as interrupted, whatever else carries the restart mark', () => {
    ingest('working', meta('running', { interruptedByRestart: true }), docs('Going.'));
    ingest(
      'done',
      meta('completed', { result: 'All done.', interruptedByRestart: true }),
      docs('All done.', [], false)
    );
    render();

    expect(card('working').textContent).toContain('Running');
    expect(card('done').textContent).toContain('Done');
    expect(cards().some((element) => element.textContent?.includes('Interrupted'))).toBe(false);
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
    expect(heading()).toBe('Write it.');
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

  it('on a phone, a back swipe goes back as Back does, and from the list closes the panel', () => {
    ingest('parent', meta('completed'), docs('Asked a writer.', [], false));
    ingest(
      'child',
      meta('completed', { agent: 'writer', parent: 'parent', task: 'Write it.' }),
      docs('Written.', [], false)
    );
    render(ScreenSize.Mobile);

    expect(edgeSwipe.enabled).toBe(true);
    open('parent');
    open('child');
    act(() => edgeSwipe.onBack());
    expect(heading()).toBe('Research Desk');
    act(() => edgeSwipe.onBack());
    expect(view()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    act(() => edgeSwipe.onBack());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('beside the conversation leaves the back swipe to the thread', () => {
    render(ScreenSize.Desktop);
    expect(edgeSwipe.enabled).toBe(false);
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

  it('opens the sub-agent it was opened for, a nested one too, and again after Back', () => {
    ingest('p', meta('running', { task: 'Plan it.' }), docs('Planning.'));
    ingest(
      'c',
      meta('running', { agent: 'writer', parent: 'p', startedAt: NOW - 10 }),
      docs('Writing.')
    );
    const store = getDefaultStore();
    act(() => openSubagentsPanel(store, ROOM_ID, '$thread:example.org', 'c'));
    render();
    expect(view()?.dataset.subagentView).toBe('c');

    act(() => button(container, 'Back').click());
    act(() => button(container, 'Back').click());
    expect(view()).toBeNull();
    act(() => openSubagentsPanel(store, ROOM_ID, '$thread:example.org', 'c'));
    expect(view()?.dataset.subagentView).toBe('c');
  });

  it('opens a sub-agent at the turn it was opened for, not at its newest', () => {
    ingest('a', meta('completed', { subagent: 'p', task: 'Plan it.' }), docs('Planned.'));
    ingest(
      'b',
      meta('running', { subagent: 'p', task: 'Do it.', startedAt: NOW - 5 }),
      docs('Doing.')
    );
    const scrolled: Element[] = [];
    HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    };
    act(() => openSubagentsPanel(getDefaultStore(), ROOM_ID, '$thread:example.org', 'a'));
    render();
    expect(view()?.dataset.subagentView).toBe('p');
    expect(scrolled.map((element) => element.textContent?.trim())).toEqual(['Plan it.']);
  });

  it('scrolls an open sub-agent to the turn each Open asks for, and not again on frames', () => {
    ingest('a', meta('completed', { subagent: 'p', task: 'Plan it.' }), docs('Planned.'));
    ingest(
      'b',
      meta('running', { subagent: 'p', task: 'Do it.', startedAt: NOW - 5 }),
      docs('Doing.')
    );
    const scrolled: string[] = [];
    HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.textContent?.trim() ?? '');
    };
    act(() => openSubagentsPanel(getDefaultStore(), ROOM_ID, '$thread:example.org', 'a'));
    render();
    act(() => openSubagentsPanel(getDefaultStore(), ROOM_ID, '$thread:example.org', 'b'));
    ingest(
      'b',
      meta('running', { subagent: 'p', task: 'Do it.', startedAt: NOW - 5 }),
      docs('Doing more.')
    );
    expect(view()?.dataset.subagentView).toBe('p');
    expect(scrolled).toEqual(['Plan it.', 'Do it.']);
  });

  it('shows the list when opened for a sub-agent it does not have, or for another room', () => {
    ingest('p', meta('running'), docs('Planning.'));
    const store = getDefaultStore();
    act(() => openSubagentsPanel(store, ROOM_ID, '$thread:example.org', 'gone'));
    render();
    expect(view()).toBeNull();
    act(() => openSubagentsPanel(store, '!other:example.org', null, 'p'));
    expect(view()).toBeNull();
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
  describe('what each run does and used', () => {
    const usage = (
      toolCalls: number,
      inputTokens: number,
      outputTokens: number,
      costUsd?: number
    ) => ({
      toolCalls,
      inputTokens,
      outputTokens,
      ...(costUsd === undefined ? {} : { costUsd }),
    });
    const fable = { modelConfig: 'fable', modelProvider: 'anthropic', modelId: 'claude-fable-5.2' };

    it('totals the conversation in the header: active, calls, tokens and cost', () => {
      ingest(
        'retry',
        meta('running', {
          task: 'Rework the export queue retry policy',
          usage: usage(34, 1_300_000, 124_000, 1.3),
        }),
        docs('Working.')
      );
      ingest(
        'audit',
        meta('completed', {
          task: 'Add pagination to the audit log',
          usage: usage(22, 800_000, 20_000, 0.62),
        }),
        docs('Paged.', [], false)
      );
      render();

      expect(container.querySelector('[data-subagents-totals]')?.textContent).toBe(
        '1 active · 56 calls · 2.2M tokens · $1.92'
      );
    });

    it('leaves the total cost out while a run that used tokens sent no cost', () => {
      ingest('priced', meta('running', { usage: usage(3, 1_000, 200, 0.5) }), docs('Working.'));
      ingest('unpriced', meta('running', { usage: usage(2, 300, 0) }), docs('Working.'));
      render();

      expect(container.querySelector('[data-subagents-totals]')?.textContent).toBe(
        '2 active · 5 calls · 1.5K tokens'
      );
    });

    it("counts every turn in a sub-agent's card and its open run, and what the runs below cost", () => {
      ingest(
        'turn-1',
        meta('completed', {
          subagent: 'lead',
          task: 'Rework the export queue retry policy',
          usage: usage(30, 1_000_000, 100_000, 1),
          startedAt: NOW - 120,
          endedAt: NOW - 90,
        }),
        docs('Done.', [], false)
      );
      ingest(
        'turn-2',
        meta('running', {
          subagent: 'lead',
          task: 'Now the retry backoff',
          usage: usage(4, 300_000, 24_000, 0.3),
          startedAt: NOW - 60,
        }),
        docs('Working.')
      );
      ingest(
        'kid',
        meta('completed', {
          agent: 'writer',
          parent: 'turn-1',
          usage: usage(7, 300_000, 14_000, 0.04),
        }),
        docs('Written.', [], false)
      );
      render();

      const stats = [...card('lead').querySelectorAll('[data-subagent-stat]')].map(
        (stat) => stat.textContent
      );
      expect(stats).toEqual(['34 calls', '1.4M tokens', '$1.30']);
      open('lead');
      const cell = (name: string) =>
        container.querySelector(`[data-subagent-cell="${name}"]`)?.textContent;
      expect(cell('calls')).toBe('Calls342 turns');
      expect(cell('tokens')).toBe('Tokens1.4M1.3M in · 124K out');
      expect(cell('cost')).toBe('Cost$1.30+$0.04 nested');
    });

    it('leaves the total cost out while a run sent nothing of what it used', () => {
      ingest('priced', meta('running', { usage: usage(3, 1_000, 200, 0.5) }), docs('Working.'));
      ingest('old', meta('running'), docs('Working.'));
      render();

      expect(container.querySelector('[data-subagents-totals]')?.textContent).toBe(
        '2 active · 3 calls · 1.2K tokens'
      );
    });

    it('keeps the header to the active count while no run says what it used', () => {
      ingest('old', meta('running'), docs('Working.'));
      render();

      expect(container.querySelector('[data-subagents-totals]')?.textContent).toBe('1 active');
    });

    it("labels each card's third line by how its run stands", () => {
      ingest(
        'now',
        meta('running', { task: 'Rework the export queue retry policy', startedAt: NOW - 50 }),
        docs('Running the tests.', [
          {
            type: 'tool_call_started',
            tool_name: 'run_shell_command',
            args_preview: 'uv run pytest -x',
          },
        ])
      );
      ingest(
        'wait',
        meta('awaiting_approval', { task: 'List every caller', startedAt: NOW - 40 }),
        docs('', [
          { type: 'tool_call_started', tool_name: 'search_files', args_preview: 'schedule_retry' },
        ])
      );
      ingest(
        'done',
        meta('completed', { task: 'Add pagination to the audit log', endedAt: NOW - 5 }),
        docs('The audit log now loads 50 entries a page.', [], false)
      );
      ingest(
        'stopped',
        meta('cancelled', {
          task: 'Compare three retry libraries',
          result: 'Stopped by you.',
          endedAt: NOW - 9,
        }),
        docs('Half way.', [], false)
      );
      ingest(
        'bare',
        meta('cancelled', { task: 'Draft the release note', endedAt: NOW - 20 }),
        docs('', [], false)
      );
      render();

      const line = (run: string) => card(run).querySelector('[data-subagent-line]');
      expect(line('now')?.getAttribute('data-subagent-line')).toBe('now');
      expect(line('now')?.textContent).toBe('Nowrun_shell_command uv run pytest -x');
      expect(line('wait')?.textContent).toBe('!Needs approvalsearch_files schedule_retry');
      expect(line('done')?.textContent).toBe('✓ResultThe audit log now loads 50 entries a page.');
      expect(line('stopped')?.textContent).toBe('✕StoppedStopped by you.');
      expect(line('bare')?.textContent).toBe('✕Stopped');
      // A run waiting for approval says so on its second line, in words.
      expect(card('wait').textContent).toContain('Waiting for approval');
    });

    it("shows a card's model logo, and what it used under a line, leaving out what is unknown", () => {
      ingest(
        'full',
        meta('running', { model: fable, usage: usage(34, 1_300_000, 124_000, 1.3) }),
        docs('Working.')
      );
      ingest('none', meta('running', { startedAt: NOW - 30 }), docs('Working.'));
      ingest(
        'free',
        meta('running', { startedAt: NOW - 20, usage: usage(3, 1_000, 0) }),
        docs('Working.')
      );
      render();

      const stats = (run: string) =>
        [...card(run).querySelectorAll('[data-subagent-stat]')].map((cell) => cell.textContent);
      expect(
        card('full').querySelector('[data-job-logo]')?.getAttribute('data-model-provider')
      ).toBe('anthropic');
      expect(stats('full')).toEqual(['34 calls', '1.4M tokens', '$1.30']);
      expect(stats('none')).toEqual([]);
      expect(stats('free')).toEqual(['3 calls', '1K tokens']);
      expect(card('none').querySelector('[data-subagent-time]')?.textContent).toBe('30s');
    });

    it('heads an open run with its task, then its status, calls, tokens and cost, and its call', () => {
      ingest(
        'lead',
        meta('running', {
          subagent: 'lead',
          task: 'Rework the export queue retry policy\nKeep the queue order.',
          model: fable,
          usage: usage(34, 1_300_000, 124_000, 1.3),
          startedAt: NOW - 60,
        }),
        docs('Working.', [
          {
            type: 'tool_call_started',
            tool_name: 'run_shell_command',
            args_preview: 'uv run pytest tests/export',
            started_at: NOW - 12,
          },
        ])
      );
      ingest(
        'kid',
        meta('awaiting_approval', {
          agent: 'writer',
          parent: 'lead',
          usage: usage(7, 300_000, 14_000, 0.04),
        }),
        docs('')
      );
      render(ScreenSize.Desktop, '$thread:example.org');
      open('lead');

      expect(heading()).toBe('Rework the export queue retry policy');
      expect(container.querySelector('header h2')?.getAttribute('title')).toBe(
        'Rework the export queue retry policy\nKeep the queue order.'
      );
      const cell = (name: string) =>
        container.querySelector(`[data-subagent-cell="${name}"]`)?.textContent;
      expect(cell('status')).toBe('StatusRunning1m 0s');
      expect(cell('calls')).toBe('Calls34tool calls');
      expect(cell('tokens')).toBe('Tokens1.4M1.3M in · 124K out');
      expect(cell('cost')).toBe('Cost$1.30+$0.04 nested');
      expect(container.querySelector('[data-subagent-now]')?.textContent).toBe(
        // Its label is for screen readers; the tick says it on screen.
        'Nowrun_shell_command uv run pytest tests/export12s'
      );
      // The run is in the thread on screen, so it has no button to that thread.
      expect(container.querySelector('header [aria-label="Open thread"]')).toBeNull();
    });

    it("names the newest turn's Stop for that turn, cancels its job, and gives focus to the title", async () => {
      ingest(
        'turn-1',
        meta('completed', {
          subagent: 'lead',
          task: 'Rework the export queue retry policy',
          startedAt: NOW - 120,
          endedAt: NOW - 90,
        }),
        docs('Done.', [], false)
      );
      ingest(
        'turn-2',
        meta('running', { subagent: 'lead', task: 'Now the retry backoff', startedAt: NOW - 60 }),
        docs('Working.')
      );
      jobsState.jobs = [
        {
          jobId: 'job_turn_2',
          agentId: SENDER,
          threadId: '$thread:example.org',
          kind: 'subagent',
          tool: 'run_subagent',
          status: 'running',
          startedAt: new Date((NOW - 60) * 1000).toISOString(),
          subagent: 'lead',
          run: 'turn-2',
        },
      ];
      sendEvent.mockRejectedValueOnce(new Error('offline'));
      render();
      open('lead');

      // The sub-agent keeps its first turn's title; its Stop is the turn it cancels.
      expect(heading()).toBe('Rework the export queue retry policy');
      const stopLabel = 'Stop task: Now the retry backoff';
      expect(button(container, stopLabel).getAttribute('title')).toBe(stopLabel);
      await act(async () => button(container, stopLabel).click());
      expect(sendEvent).toHaveBeenCalledWith(
        ROOM_ID,
        'io.mindroom.background_job_cancel',
        expect.objectContaining({ job_id: 'job_turn_2' }),
        'txn'
      );
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'Could not stop Now the retry backoff. Try again.'
      );
      expect(document.activeElement).toBe(container.querySelector('header h2'));

      sendEvent.mockReturnValueOnce(new Promise<never>(() => {}));
      await act(async () => button(container, stopLabel).click());
      // Stop turned into Stopping…; focus stays on the title, not the page.
      expect(container.querySelector('[data-subagent-stop]')).toBeNull();
      expect(document.activeElement).toBe(container.querySelector('header h2'));
    });

    it('offers no Stop in a fork draft, whose thread is read-only there', () => {
      ingest(
        'lead',
        meta('running', { subagent: 'lead', task: 'Rework the export queue retry policy' }),
        docs('Working.')
      );
      jobsState.jobs = [
        {
          jobId: 'job_lead',
          agentId: SENDER,
          threadId: '$thread:example.org',
          kind: 'subagent',
          tool: 'run_subagent',
          status: 'running',
          startedAt: new Date((NOW - 60) * 1000).toISOString(),
          subagent: 'lead',
          run: 'lead',
        },
      ];
      render(ScreenSize.Desktop, '$thread:example.org', true);
      open('lead');
      expect(container.querySelector('[data-subagent-stop]')).toBeNull();

      render(ScreenSize.Desktop, '$thread:example.org');
      expect(container.querySelector('[data-subagent-stop]')).not.toBeNull();
    });

    it("stops an open run's job, says Stopping until it leaves, and says so when it fails", async () => {
      ingest(
        'lead',
        meta('running', { subagent: 'lead', task: 'Rework the export queue retry policy' }),
        docs('Working.')
      );
      const job = {
        jobId: 'job_lead',
        agentId: SENDER,
        threadId: '$thread:example.org',
        kind: 'subagent' as const,
        tool: 'run_subagent',
        status: 'running',
        startedAt: new Date((NOW - 60) * 1000).toISOString(),
        subagent: 'lead',
        run: 'lead',
      };
      // No job, no Stop; nor without leave to cancel.
      render();
      open('lead');
      const stopLabel = 'Stop task: Rework the export queue retry policy';
      expect(container.querySelector('[data-subagent-stop]')).toBeNull();
      jobsState.jobs = [job];
      jobsState.canCancel = false;
      render();
      expect(container.querySelector('[data-subagent-stop]')).toBeNull();

      jobsState.canCancel = true;
      sendEvent.mockRejectedValueOnce(new Error('offline'));
      render();
      await act(async () => button(container, stopLabel).click());
      expect(sendEvent).toHaveBeenCalledWith(
        ROOM_ID,
        'io.mindroom.background_job_cancel',
        {
          job_id: 'job_lead',
          'm.relates_to': { rel_type: 'm.thread', event_id: '$thread:example.org' },
        },
        'txn'
      );
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'Could not stop Rework the export queue retry policy. Try again.'
      );

      sendEvent.mockReturnValueOnce(new Promise<never>(() => {}));
      await act(async () => button(container, stopLabel).click());
      expect(container.querySelector('[data-subagent-stop]')).toBeNull();
      expect(container.querySelector('header [title="Stopping…"]')).not.toBeNull();
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    describe('without the usage details, as they start', () => {
      beforeEach(() => showUsageDetails(false));

      it('keeps the models but leaves out usage and what a run at work does now', () => {
        ingest(
          'notes',
          meta('running', {
            task: "Summarize this week's meeting notes",
            model: fable,
            usage: usage(12, 300_000, 20_000, 0.4),
            startedAt: NOW - 50,
          }),
          docs('', [
            {
              type: 'tool_call_started',
              tool_name: 'read_file',
              args_preview: 'path=notes/2026-11-16.md',
            },
          ])
        );
        ingest(
          'wait',
          meta('awaiting_approval', { task: 'Find the open action items', startedAt: NOW - 40 }),
          docs('', [
            {
              type: 'tool_call_started',
              tool_name: 'grep',
              args_preview: 'pattern=TODO, path=notes',
            },
          ])
        );
        ingest(
          'between',
          meta('running', { task: 'Draft the agenda', startedAt: NOW - 30 }),
          docs('Read the notes.\n\nNow the **decisions**.')
        );
        ingest(
          'child',
          meta('running', { agent: 'writer', parent: 'between', startedAt: NOW - 10 }),
          docs('Writing.')
        );
        ingest(
          'done',
          meta('completed', { result: 'Version 2 shipped in **March**.', endedAt: NOW - 5 }),
          docs('', [], false)
        );
        ingest(
          'broke',
          meta('failed', { result: 'Tool crashed.', endedAt: NOW - 5 }),
          docs('Trying.', [], false)
        );
        render();

        expect(container.querySelector('[data-subagents-totals]')?.textContent).toBe('4 active');
        // Its model stays at a glance; what it used does not show.
        expect(card('notes').querySelector('[data-subagent-model]')?.textContent).toBe('Fable');
        expect(card('notes').querySelector('[data-subagent-stat]')).toBeNull();
        expect(card('notes').querySelector('[data-subagent-time]')?.textContent).toBe('50s');
        // A run at work, nested or not, has no line under its status, which says how it stands.
        const line = (run: string) => card(run).querySelector('[data-subagent-line]');
        expect(line('notes')).toBeNull();
        expect(line('wait')).toBeNull();
        expect(card('wait').textContent).toContain('Waiting for approval');
        expect(line('between')).toBeNull();
        // A nested run has no status chip of its own, so it says beside its time that it runs.
        const nestedTime = () => card('between').querySelector('[data-subagent-nested-time]');
        expect(nestedTime()?.textContent).toBe('Running 10s');
        // How a run ended stays: its result, or why it failed.
        expect(line('done')?.textContent).toContain('Version 2 shipped in March.');
        expect(line('broke')?.textContent).toContain('Tool crashed.');

        // Shown, the cards are as they were.
        act(() => showUsageDetails());
        expect(container.querySelector('[data-subagents-totals]')?.textContent).toBe(
          '4 active · 12 calls · 320K tokens'
        );
        expect(card('notes').querySelector('[data-subagent-model]')?.textContent).toBe('Fable');
        expect(line('notes')?.textContent).toBe('Nowread_file path=notes/2026-11-16.md');
        expect(line('between')?.getAttribute('data-subagent-line')).toBe('plain');
        expect(nestedTime()?.textContent).toBe('10s');
      });

      it('keeps the model in the header and folds usage, without a Now line', () => {
        ingest(
          'lead',
          meta('running', {
            subagent: 'lead',
            task: "Summarize this week's meeting notes",
            model: fable,
            usage: usage(12, 300_000, 20_000, 0.4),
            startedAt: NOW - 60,
          }),
          docs('Reading the notes.', [
            {
              type: 'tool_call_started',
              tool_name: 'read_file',
              args_preview: 'path=notes/2026-11-16.md',
              started_at: NOW - 12,
            },
          ])
        );
        render(ScreenSize.Desktop, '$thread:example.org');
        open('lead');

        // How it stands and its model stay in the header.
        const header = container.querySelector('header');
        const standingModel = header?.querySelector('[data-subagent-model]');
        expect(standingModel?.textContent).toBe('Fable');
        expect(standingModel?.getAttribute('title')).toBe('fable (anthropic / claude-fable-5.2)');
        expect(header?.textContent).toContain('Running');
        expect(header?.textContent).toContain('1m 0s');
        const usageDetails = container.querySelector<HTMLDetailsElement>('[data-subagent-usage]');
        expect(usageDetails?.open).toBe(false);
        expect(usageDetails?.querySelector('summary')?.textContent).toBe('Usage');
        const cell = (name: string) =>
          usageDetails?.querySelector(`[data-subagent-cell="${name}"]`)?.textContent;
        expect(cell('calls')).toBe('Calls12tool calls');
        expect(cell('tokens')).toBe('Tokens320K300K in · 20K out');
        expect(cell('cost')).toBe('Cost$0.40this run');
        expect(container.querySelector('[data-subagent-cell="status"]')).toBeNull();
        const now = () => container.querySelector('[data-subagent-now]');
        expect(now()).toBeNull();

        // Shown, the strip is open under the header again, with how the run stands, and the call
        // it makes now.
        act(() => showUsageDetails());
        expect(container.querySelector('[data-subagent-usage]')).toBeNull();
        expect(container.querySelector('[data-subagent-cell="status"]')?.textContent).toBe(
          'StatusRunning1m 0s'
        );
        expect(header?.querySelector('[data-subagent-model]')?.textContent).toBe('Fable');
        expect(now()?.textContent).toBe('Nowread_file path=notes/2026-11-16.md12s');
        act(() => showUsageDetails(false));

        for (const model of [fable, undefined]) {
          ingest(
            'lead',
            meta('running', {
              subagent: 'lead',
              task: "Summarize this week's meeting notes",
              startedAt: NOW - 60,
              model,
            }),
            docs('Reading the notes.')
          );
          expect(container.querySelector('[data-subagent-usage]')).toBeNull();
          expect(container.querySelector('header [data-subagent-model]')?.textContent).toBe(
            model ? 'Fable' : undefined
          );
        }
      });
    });
  });
});
