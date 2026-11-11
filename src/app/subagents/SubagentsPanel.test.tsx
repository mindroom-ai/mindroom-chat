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
import * as css from './subagentsPanel.css';

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

const meta = (status: SubagentStatus, extra: Partial<SubagentMeta> = {}): SubagentMeta => ({
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
const ingest = (run: string, runMeta: SubagentMeta, runDocs: LiveDocs) => {
  const seq = (seqs.get(run) ?? -1) + 1;
  seqs.set(run, seq);
  const frame: SubagentFrame = { run, sid: SID, seq, meta: runMeta, snapshot: runDocs };
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

const cards = () => [...container.querySelectorAll<HTMLElement>('[data-subagent-run]')];
const card = (run: string) => {
  const found = container.querySelector<HTMLElement>(`[data-subagent-run="${run}"]`);
  if (!found) throw new Error(`no card for ${run}`);
  return found;
};
/** The card's own part, without the cards nested in it. */
const ownText = (element: HTMLElement) => {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[data-subagent-run]').forEach((nested) => nested.remove());
  return copy.textContent ?? '';
};
const button = (scope: HTMLElement, name: string) => {
  const found = [...scope.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === name || candidate.getAttribute('aria-label') === name
  );
  if (!found) throw new Error(`no button ${name}`);
  return found;
};
/** The card's own transcript, not one of a card nested in it. */
const transcript = (run: string) =>
  [...card(run).querySelectorAll<HTMLElement>('[data-subagent-transcript]')].find(
    (element) => element.closest('[data-subagent-run]') === card(run)
  ) ?? null;

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

  it('shows two running runs as two cards, the one that started first on top', () => {
    ingest('late', meta('running', { agent: 'writer', startedAt: NOW - 10 }), docs('Drafting.'));
    ingest('early', meta('running', { startedAt: NOW - 45 }), docs('Looking it up.'));
    render();

    expect(cards().map((element) => element.dataset.subagentRun)).toEqual(['early', 'late']);
    expect(container.querySelector('header')?.textContent).toContain('2 active');
    // A member shows by the room's name for them, an agent outside the room by its own name.
    expect(card('early').textContent).toContain('Research Desk');
    expect(card('late').textContent).toContain('writer');
    expect(card('early').textContent).toContain('Running');
    expect(card('early').textContent).toContain('45 sec');
  });

  it("names a namespaced MindRoom's agent and caller by their accounts, with the agent's picture", () => {
    ingest('run', meta('running', { agent: 'helper', caller: 'coordinator' }), docs('Looking.'));
    render();

    expect(card('run').querySelector('h3')?.textContent).toBe('Helper Desk');
    expect(card('run').querySelector('img')?.getAttribute('src')).toBe(
      'https://media.example.org/example.org/helper'
    );
    expect(ownText(card('run'))).toContain('from Coordinator');
  });

  it('lists finished runs after the running ones, the one that ended last first', () => {
    ingest('old', meta('completed', { endedAt: NOW - 300 }), docs('A', [], false));
    ingest('busy', meta('running'), docs('B'));
    ingest('new', meta('failed', { endedAt: NOW - 20 }), docs('C', [], false));
    render();

    expect(cards().map((element) => element.dataset.subagentRun)).toEqual(['busy', 'new', 'old']);
    expect(container.querySelector('header')?.textContent).toContain('1 active');
  });

  it('counts paused runs and runs waiting for approval as active, as the header badge does', () => {
    ingest('waiting', meta('awaiting_approval'), docs('May I?'));
    ingest('paused', meta('paused', { startedAt: NOW - 30 }), docs('Later.', [], false));
    ingest('done', meta('completed'), docs('Done.', [], false));
    render();

    expect(container.querySelector('header')?.textContent).toContain('2 active');
  });

  it('names the caller only when it is another agent and the run is not inside its card', () => {
    ingest('copy', meta('running', { agent: 'lead' }), docs('Working.'));
    ingest('other', meta('running', { startedAt: NOW - 30 }), docs('Working.'));
    ingest('child', meta('running', { agent: 'writer', parent: 'other' }), docs('Writing.'));
    render();

    // An agent that started a copy of itself does not read "Lead, from Lead".
    expect(ownText(card('copy'))).not.toContain('from');
    expect(ownText(card('other'))).toContain('from Lead');
    // The card it sits in says where a nested run came from; its thread is that card's too.
    expect(ownText(card('child'))).not.toContain('from');
    expect(() => button(card('child'), 'Open thread')).toThrow();
  });

  it('folds a nested run that finished well into Show output, and keeps a failed one open', () => {
    ingest(
      'parent',
      meta('completed', { result: 'They answered **42**.' }),
      docs('Asked.', [], false)
    );
    ingest(
      'done',
      meta('completed', { agent: 'writer', parent: 'parent', result: 'The answer is **42**.' }),
      docs('Counting.', [], false)
    );
    ingest(
      'broke',
      meta('failed', {
        agent: 'writer',
        parent: 'parent',
        result: 'Tool **crashed**.',
        endedAt: NOW - 5,
      }),
      docs('Trying.', [], false)
    );
    render();

    const ownResult = (run: string) =>
      [...card(run).querySelectorAll('[data-subagent-result]')].find(
        (element) => element.closest('[data-subagent-run]') === card(run)
      );
    expect(ownResult('parent')?.textContent).toContain('They answered 42.');
    expect(ownResult('broke')?.textContent).toContain('Tool crashed.');
    // The run that started it passes the answer on, so the nested one keeps it under Show output.
    expect(ownResult('done')).toBeUndefined();
    act(() => button(card('done'), 'Show output').click());
    expect(ownResult('done')?.querySelector('strong')?.textContent).toBe('42');
    expect(transcript('done')?.textContent).toContain('Counting.');
  });

  it('shows a run inside the card of the run that started it, and an orphan on its own', () => {
    ingest('parent', meta('running'), docs('Splitting the work.'));
    ingest('child', meta('running', { agent: 'writer', parent: 'parent' }), docs('Writing.'));
    ingest('orphan', meta('running', { parent: 'gone', startedAt: NOW - 5 }), docs('Alone.'));
    render();

    const nested = card('parent').querySelectorAll<HTMLElement>('[data-subagent-run]');
    expect([...nested].map((element) => element.dataset.subagentRun)).toEqual(['child']);
    const topLevel = cards().filter(
      (element) => !element.parentElement?.closest('[data-subagent-run]')
    );
    expect(topLevel.map((element) => element.dataset.subagentRun)).toEqual(['parent', 'orphan']);
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

    statuses.forEach(([status, label]) => expect(ownText(card(status))).toContain(label));
  });

  it("renders the run's Markdown and its tool rows as a reply shows them", () => {
    ingest(
      'run',
      meta('running'),
      docs('Checking **the tags**.\n\n🔧 `run_shell_command` [1] ⏳\n\n', [
        {
          type: 'tool_call_started',
          tool_name: 'run_shell_command',
          args_preview: 'command=git tag',
        },
      ])
    );
    render();

    const body = transcript('run');
    expect(body?.querySelector('strong')?.textContent).toBe('the tags');
    const calls = body?.querySelector<HTMLButtonElement>('[data-message-disclosure] > button');
    expect(calls?.textContent).toContain('Running 1 tool call');
    expect(calls?.textContent).toContain('run_shell_command');
    act(() => calls?.click());
    expect(body?.querySelector('[data-tool-index="1"]')?.textContent).toContain('git tag');
  });

  it('shows the typing dots while a run is running, not while it waits for approval', () => {
    ingest('waiting', meta('awaiting_approval'), docs('May I run it?'));
    ingest('busy', meta('running', { startedAt: NOW - 30 }), docs('Working.'));
    render();

    const dots = (run: string) =>
      transcript(run)?.querySelector('[aria-label="AI is responding"]') ?? null;
    expect(transcript('waiting')?.textContent).toContain('May I run it?');
    expect(dots('waiting')).toBeNull();
    expect(dots('busy')).not.toBeNull();
  });

  it('shows two lines of the task, and all of it on request when they cut it short', () => {
    ingest('short', meta('running', { task: 'Find when version 2 shipped.' }), docs('Looking.'));
    render();
    const task = (run: string) => card(run).querySelector<HTMLElement>('[data-subagent-task]');
    // `TaskExcerpt` composes `Task`, so it is more than one class.
    const clamped = (run: string) =>
      css.TaskExcerpt.split(' ').every((name) => task(run)?.classList.contains(name));

    expect(task('short')?.textContent).toBe('Find when version 2 shipped.');
    expect(clamped('short')).toBe(true);
    // Two lines hold it, so there is nothing more to show.
    expect(() => button(card('short'), 'Show task')).toThrow();

    // The task's paragraph is twice as tall as the two lines it shows.
    const tall = (height: number) =>
      function measured(this: Element) {
        return this.hasAttribute('data-subagent-task') ? height : 0;
      };
    const scroll = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(tall(80));
    const client = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(tall(40));
    try {
      ingest(
        'long',
        meta('running', { task: 'Read every changelog.', startedAt: NOW - 5 }),
        docs('')
      );
      render();
      const toggle = button(card('long'), 'Show task');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      act(() => toggle.click());
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(clamped('long')).toBe(false);
      act(() => toggle.click());
      expect(clamped('long')).toBe(true);
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
  });

  it('measures the task again once the web fonts have loaded', async () => {
    let fontsLoaded = () => {};
    const ready = new Promise<void>((resolve) => {
      fontsLoaded = resolve;
    });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } });
    let scrollHeight = 40;
    const scroll = vi
      .spyOn(Element.prototype, 'scrollHeight', 'get')
      .mockImplementation(function measured(this: Element) {
        return this.hasAttribute('data-subagent-task') ? scrollHeight : 0;
      });
    const client = vi
      .spyOn(Element.prototype, 'clientHeight', 'get')
      .mockImplementation(function measured(this: Element) {
        return this.hasAttribute('data-subagent-task') ? 40 : 0;
      });
    try {
      ingest('run', meta('running', { task: 'Read every changelog.' }), docs('Looking.'));
      render();
      expect(() => button(card('run'), 'Show task')).toThrow();

      // The font rewraps the task into a third line within the same two-line box.
      scrollHeight = 60;
      await act(async () => {
        fontsLoaded();
        await ready;
      });
      expect(button(card('run'), 'Show task').getAttribute('aria-expanded')).toBe('false');
    } finally {
      scroll.mockRestore();
      client.mockRestore();
      delete (document as { fonts?: unknown }).fonts;
    }
  });

  it('shows a finished run by its result, with its transcript on request', () => {
    ingest(
      'run',
      meta('completed', { result: 'Version 2 shipped in **March**.' }),
      docs('Reading the **changelog**.', [], false)
    );
    render();

    // The result is Markdown, as agents write it, and shows formatted like the transcript.
    const result = card('run').querySelector('[data-subagent-result]');
    expect(result?.textContent).toContain('Version 2 shipped in March.');
    expect(result?.querySelector('strong')?.textContent).toBe('March');
    expect(card('run').textContent).toContain('Done');
    expect(transcript('run')).toBeNull();
    act(() => button(card('run'), 'Show output').click());
    expect(transcript('run')?.querySelector('strong')?.textContent).toBe('changelog');
  });

  it('opens the thread the run was started from', () => {
    ingest('run', meta('running', { threadId: '$thread:example.org' }), docs('Looking.'));
    ingest('loose', meta('running', { threadId: null, startedAt: NOW - 5 }), docs('Looking.'));
    render();

    act(() => button(card('run'), 'Open thread').click());
    expect(navigation.navigateRoomThread).toHaveBeenCalledWith(ROOM_ID, '$thread:example.org');
    // Without a thread, the caller is only named.
    expect(ownText(card('loose'))).toContain('from Lead');
    expect(() => button(card('loose'), 'Open thread')).toThrow();
  });

  it('follows new text at the end of a transcript until the reader scrolls up more than 24 px', () => {
    ingest('run', meta('running'), docs('First line.'));
    render();
    const box = transcript('run');
    if (!box) throw new Error('no transcript');
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
