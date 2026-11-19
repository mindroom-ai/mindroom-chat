// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { subagentsPanelAtom } from '../navigation/subagentsPanel';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import type { SubagentMeta } from '../matrix/protocol/subagentFrame';
import type { ToolTraceEvent } from '../matrix/protocol/toolTrace';
import { getSubagentRunStore } from '../messages/live/subagentRunStore';
import { BackgroundJobsBar } from './BackgroundJobsBar';
import { keepCancelsOf } from './sentCancels';

const state = vi.hoisted(() => ({
  jobs: [] as BackgroundJob[],
  total: undefined as number | undefined,
  send: vi.fn(),
}));
// One client, whose sends go to the test's current `send`, so the stores it keys stay.
const mx = vi.hoisted(() => ({
  sendEvent: (...args: unknown[]) => state.send(...args),
  makeTxnId: () => 'txn',
}));
vi.mock('../matrix/hooks/useRoomBackgroundJobs', () => ({
  useRoomBackgroundJobs: () => ({ jobs: state.jobs, total: state.total ?? state.jobs.length }),
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => mx,
}));
const navigation = vi.hoisted(() => ({ navigateRoomThread: vi.fn() }));
vi.mock('../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => navigation }));
vi.mock('../threads/cross-room/threadSignalsReader', () => ({
  subscribeRoomSignals: () => () => undefined,
}));
vi.mock('../threads/fork/ThreadForkDivider', () => ({
  useThreadTitle: (_room: unknown, threadId: string) => `Title of ${threadId}`,
}));
vi.mock('./BackgroundJobsBar.css', () => ({
  Anchor: 'Anchor',
  Listed: 'Listed',
  Bar: 'Bar',
  Status: 'Status',
  Action: 'Action',
  Toggle: 'Toggle',
  TitleIcon: 'TitleIcon',
  Title: 'Title',
  Chevron: 'Chevron',
  Jobs: 'Jobs',
  JobList: 'JobList',
  GroupHeading: 'GroupHeading',
  GroupName: 'GroupName',
  ColumnName: 'ColumnName',
  StatColumn: 'StatColumn',
  Job: 'Job',
  Nested: 'Nested',
  Logo: 'Logo',
  Stack: 'Stack',
  StackedLogo: 'StackedLogo',
  TitleLogo: 'TitleLogo',
  Dot: { running: 'Dot', waiting: 'Dot', stopping: 'Dot', finished: 'Dot' },
  JobText: 'JobText',
  Headline: 'Headline',
  Detail: 'Detail',
  Task: 'Task',
  Name: 'Name',
  Model: 'Model',
  Activity: 'Activity',
  Preview: 'Preview',
  Pill: { waiting: 'Pill', stopping: 'Pill', done: 'Pill' },
  PillText: 'PillText',
  PillIcon: 'PillIcon',
  ThreadChip: 'ThreadChip',
  ThreadTitle: 'ThreadTitle',
  Num: 'Num',
  Stat: 'Stat',
  Actions: 'Actions',
  IconButton: 'IconButton',
  StopButton: 'StopButton',
  StopAll: 'StopAll',
  StopLabel: 'StopLabel',
  Stopping: 'Stopping',
  Summary: 'Summary',
  SummaryWaiting: 'SummaryWaiting',
  Elapsed: 'Elapsed',
  VisuallyHidden: 'VisuallyHidden',
  Alert: 'Alert',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}${values ? JSON.stringify(values) : ''}`,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

const job = (jobId: string, overrides: Partial<BackgroundJob> = {}): BackgroundJob => ({
  jobId,
  agentId: '@mindroom_code:example.org',
  threadId: '$thread',
  kind: 'tool',
  tool: `tool_${jobId}`,
  status: 'running',
  startedAt: '2026-10-11T00:00:00+00:00',
  ...overrides,
});

const room = {
  roomId: '!room:example.org',
  getEventForTxnId: () => undefined,
  // The agent's reply is not loaded, so it never reads as streaming.
  getThread: () => null,
  getLiveTimeline: () => ({ getEvents: () => [] }),
  getUnfilteredTimelineSet: () => undefined,
  getJoinedMembers: () => [],
  on: () => undefined,
  removeListener: () => undefined,
} as unknown as Room;
let container: HTMLDivElement;
let root: Root;

const render = (threadId: string | null = '$thread', canCancel = true) =>
  act(() => {
    root.render(<BackgroundJobsBar room={room} threadId={threadId} canCancel={canCancel} />);
  });
const cancelA = 'mindroomUi.backgroundJobs.stopTaskFor{"tool":"tool_a"}';
const cancelB = 'mindroomUi.backgroundJobs.stopTaskFor{"tool":"tool_b"}';
const stoppingA = 'mindroomUi.backgroundJobs.stoppingJob{"tool":"tool_a"}';
const title = () => container.querySelector('[role="region"]')?.getAttribute('aria-label');
const click = (label: string) =>
  act(async () => {
    button(label)?.click();
  });
const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (item) => item.getAttribute('aria-label') === label || item.textContent === label
  );
const toggle = () => container.querySelector<HTMLButtonElement>('button[aria-expanded]');
const expand = () =>
  act(() => {
    toggle()?.click();
  });
// jsdom has no PointerEvent; React reads the pointer type from the native event.
const pointer = (
  type: 'pointerover' | 'pointerout' | 'pointerdown',
  pointerType: string,
  target: Element | null = container.querySelector('[role="region"]'),
  relatedTarget: Element | null = null
) =>
  act(() => {
    const event = new MouseEvent(type, { bubbles: true, relatedTarget });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    target?.dispatchEvent(event);
  });

beforeEach(() => {
  keepCancelsOf(room.roomId, new Set());
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.jobs = [];
  state.total = undefined;
  state.send = vi.fn().mockResolvedValue({ event_id: '$sent' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  getDefaultStore().set(subagentsPanelAtom, undefined);
  getSubagentRunStore(mx as never).clear();
  vi.unstubAllGlobals();
});

it('renders nothing without jobs', () => {
  render();
  expect(container.innerHTML).toBe('');
});

it('names one job in the title, with Stop and no list', () => {
  state.jobs = [job('a')];
  render();
  expect(title()).toBe('mindroomUi.backgroundJobs.running{"tool":"tool_a"}');
  expect(container.querySelector('.Jobs')).toBeNull();
  // Its logo takes the title line's small tile, so the logo and its dot stay inside the bar.
  expect(container.querySelector('.Status .Logo')?.classList).toContain('TitleLogo');
  // One job's Stop says it stops the task, which runs apart from the reply, and names it.
  expect(button(cancelA)?.getAttribute('title')).toBe(cancelA);
  expect(button(cancelA)?.textContent).toBe('mindroomUi.backgroundJobs.stopTask');
});

it("names each listed job's Stop the task it stops, with its icon only", () => {
  state.jobs = [job('a'), job('b')];
  render();
  expand();
  expect(button(cancelA)?.getAttribute('title')).toBe(cancelA);
  expect(button(cancelB)?.getAttribute('title')).toBe(cancelB);
  expect(button(cancelA)?.textContent).toBe('');
});

it('keeps the jobs it showed for a moment after they end, as finished and without Stop', async () => {
  vi.useFakeTimers();
  try {
    state.jobs = [job('a')];
    render();
    state.jobs = [];
    render();
    expect(title()).toBe('mindroomUi.backgroundJobs.finished{"tool":"tool_a"}');
    expect(button(cancelA)).toBeUndefined();
    state.jobs = [job('a'), job('b')];
    render();
    state.jobs = [];
    render();
    expect(title()).toBe('mindroomUi.backgroundJobs.jobCountFinished{"count":2}');
    expect(button('mindroomUi.backgroundJobs.stopAll')).toBeUndefined();
    await act(() => vi.advanceTimersByTime(2_000));
    expect(container.innerHTML).toBe('');
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a held job's time where it ended as its list folds and opens again", () => {
  vi.useFakeTimers({ now: Date.parse('2026-10-11T00:00:10+00:00') });
  try {
    state.jobs = [job('a'), job('b')];
    render();
    state.jobs = [];
    render();
    expand();
    const elapsed = () => container.querySelector('[data-job-elapsed]')?.textContent;
    const ended = elapsed();
    expect(ended).toBeTruthy();
    // Its time has stopped and it has no Stop: each held row says it is done, in words.
    const done = [...container.querySelectorAll('.Job')].map(
      (row) => row.querySelector('[data-job-done]')?.textContent
    );
    expect(done).toEqual(['mindroomUi.subagents.completed', 'mindroomUi.subagents.completed']);
    expand();
    expect(elapsed()).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expand();
    expect(elapsed()).toBe(ended);
  } finally {
    vi.useRealTimers();
  }
});

it('shows several jobs on one line, and lists them while the title is pressed', async () => {
  state.jobs = [job('a'), job('b')];
  render();
  expect(container.querySelector('ul')).toBeNull();
  expect(button('mindroomUi.backgroundJobs.stopAll')).toBeDefined();
  expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
  expand();
  expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelectorAll('li')).toHaveLength(2);
  // Listed, the bar spans the dock's line, whatever shares it.
  expect(container.querySelector('.Anchor')?.classList).toContain('Listed');
  // A mouse leaving does not close a list the title opened.
  pointer('pointerout', 'mouse');
  expect(container.querySelector('ul')).not.toBeNull();
  expand();
  expect(container.querySelector('ul')).toBeNull();
});

it('counts the live jobs the agents did not list in the main timeline only', () => {
  state.jobs = [job('a'), job('b', { threadId: '$other' })];
  state.total = 90;
  render(null);
  expect(title()).toBe('mindroomUi.backgroundJobs.jobCountShowing{"count":90,"shown":2}');
  expand();
  expect(container.querySelectorAll('li')).toHaveLength(2);
  // A thread cannot tell which of the room's unlisted jobs are its own.
  state.jobs = [job('a'), job('b')];
  render('$thread');
  expect(title()).toBe('mindroomUi.backgroundJobs.jobCount{"count":2}');
});

it('closes the list on Escape, back on the title, and on a press outside', async () => {
  state.jobs = [job('a'), job('b')];
  render();
  expand();
  button(cancelA)?.focus();
  const roomEscape = vi.fn();
  window.addEventListener('keydown', roomEscape);
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
  });
  window.removeEventListener('keydown', roomEscape);
  expect(container.querySelector('ul')).toBeNull();
  expect(document.activeElement).toBe(toggle());
  // The room's own Escape (to the composer) does not take focus from the title.
  expect(roomEscape).not.toHaveBeenCalled();
  // Escape with focus elsewhere closes the list too.
  expand();
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(container.querySelector('ul')).toBeNull();
  expand();
  act(() => {
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  });
  expect(container.querySelector('ul')).toBeNull();
});

it('lists several jobs while a mouse rests on the title, not for a passing pointer or a touch', async () => {
  vi.useFakeTimers();
  try {
    state.jobs = [job('a'), job('b')];
    render();
    const listed = () => container.querySelector('ul') !== null;
    // Not from the rest of the bar, such as Stop all.
    pointer('pointerover', 'mouse', button('mindroomUi.backgroundJobs.stopAll') ?? null);
    await act(() => vi.advanceTimersByTime(500));
    expect(listed()).toBe(false);
    pointer('pointerout', 'mouse');
    pointer('pointerover', 'mouse', toggle());
    pointer('pointerout', 'mouse');
    await act(() => vi.advanceTimersByTime(500));
    expect(listed()).toBe(false);
    // Nor for one passing over the title to Stop all.
    const stopAll = button('mindroomUi.backgroundJobs.stopAll') ?? null;
    pointer('pointerover', 'mouse', toggle());
    pointer('pointerout', 'mouse', toggle(), stopAll);
    pointer('pointerover', 'mouse', stopAll, toggle());
    await act(() => vi.advanceTimersByTime(500));
    expect(listed()).toBe(false);
    pointer('pointerout', 'mouse');
    pointer('pointerover', 'touch', toggle());
    await act(() => vi.advanceTimersByTime(500));
    expect(listed()).toBe(false);
    pointer('pointerover', 'mouse', toggle());
    await act(() => vi.advanceTimersByTime(100));
    expect(listed()).toBe(false);
    await act(() => vi.advanceTimersByTime(60));
    expect(listed()).toBe(true);
    // A press inside the bar keeps the list.
    pointer('pointerdown', 'mouse', container.querySelector('li'));
    expect(listed()).toBe(true);
    pointer('pointerout', 'mouse');
    expect(listed()).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it('keeps the jobs listed once focus is in the list, and closes them when focus leaves the bar', async () => {
  vi.useFakeTimers();
  const outside = document.createElement('button');
  document.body.appendChild(outside);
  try {
    state.jobs = [job('a'), job('b')];
    render();
    pointer('pointerover', 'mouse', toggle());
    await act(() => vi.advanceTimersByTime(200));
    act(() => button(cancelA)?.focus());
    pointer('pointerout', 'mouse');
    expect(container.querySelector('ul')).not.toBeNull();
    act(() => outside.focus());
    expect(container.querySelector('ul')).toBeNull();
  } finally {
    outside.remove();
    vi.useRealTimers();
  }
});

it('shows Stopping until the job leaves the state', async () => {
  state.jobs = [job('a')];
  render();
  await click(cancelA);
  state.jobs = [job('a')];
  render();
  expect(button(cancelA)).toBeUndefined();
  // The bar's title and region name say so, not that the job is running.
  expect(title()).toBe(stoppingA);
  state.jobs = [];
  render();
  expect(container.innerHTML).toBe('');
});

it('keeps a sent cancel stopping when a later Stop all fails', async () => {
  state.jobs = [job('a'), job('b')];
  render();
  expand();
  await click(cancelA);
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await click('mindroomUi.backgroundJobs.stopAll');
  expect(button(cancelA)).toBeUndefined();
  expect(button(cancelB)).toBeDefined();
});

it('keeps a job stopping when Stop all reached it, though its own earlier cancel then fails', async () => {
  state.jobs = [job('a'), job('b')];
  let failSingle: (error: Error) => void = () => undefined;
  state.send = vi.fn().mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failSingle = reject;
      })
  );
  render();
  expand();
  await click(cancelA);
  state.send.mockResolvedValue({ event_id: '$all' });
  render();
  await click('mindroomUi.backgroundJobs.stopAll');
  await act(async () => failSingle(new Error('offline')));
  expect(button(cancelA)).toBeUndefined();
  expect(button(cancelB)).toBeUndefined();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('lists jobs without cancel controls for a viewer who may not cancel', () => {
  state.jobs = [job('a'), job('b')];
  render('$thread', false);
  expand();
  expect(container.textContent).toContain('tool_a');
  // Only the title, which lists the jobs, is a button.
  expect([...container.querySelectorAll('button')]).toEqual([toggle()]);
});

it('keeps a cancel stopping across a switch to another thread and back', async () => {
  state.jobs = [job('a'), job('b', { threadId: '$other' })];
  render('$thread');
  await click(cancelA);
  render('$other');
  render('$thread');
  expect(title()).toBe(stoppingA);
  expect(button(cancelA)).toBeUndefined();
});

it('drops the error of a failed cancel once the job is cancelled from elsewhere', async () => {
  state.jobs = [job('a')];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await click(cancelA);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  state.jobs = [job('a', { status: 'cancel_requested' })];
  render();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('keeps the error of a job still listed when a cancel of a job that ended fails later', async () => {
  state.jobs = [job('a'), job('b')];
  const fails: Array<(error: Error) => void> = [];
  state.send = vi.fn(
    () =>
      new Promise((_resolve, reject) => {
        fails.push(reject);
      })
  );
  render();
  expand();
  await click(cancelA);
  await click(cancelB);
  await act(async () => fails[1]!(new Error('offline')));
  state.jobs = [job('b')];
  render();
  await act(async () => fails[0]!(new Error('offline')));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('"tool":"tool_b"');
});

it('leaves a failed cancel behind when the view moves to another thread', async () => {
  state.jobs = [job('a'), job('b', { threadId: '$other' })];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render(null);
  await click('mindroomUi.backgroundJobs.stopAll');
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  render('$thread');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('keeps a late cancel failure out of the thread the view moved to', async () => {
  state.jobs = [job('a'), job('b', { threadId: '$other' })];
  let fail: (error: Error) => void = () => undefined;
  state.send = vi.fn(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      })
  );
  render(null);
  await click('mindroomUi.backgroundJobs.stopAll');
  render('$thread');
  await act(async () => fail(new Error('offline')));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(button(cancelA)).toBeDefined();
});

it('keeps a sent cancel stopping after the bar is unmounted and shown again', async () => {
  state.send = vi.fn(() => new Promise<never>(() => {}));
  state.jobs = [job('a')];
  render();
  await click(cancelA);
  act(() => root.unmount());
  root = createRoot(container);
  render();
  expect(title()).toBe(stoppingA);
  expect(button(cancelA)).toBeUndefined();
});

it('moves keyboard focus to the next cancel button, and to the bar after Stop all', async () => {
  state.send = vi.fn(() => new Promise<never>(() => {}));
  state.jobs = [job('a'), job('b'), job('c')];
  render();
  expand();
  button(cancelA)?.focus();
  await click(cancelA);
  expect(document.activeElement).toBe(button(cancelB));
  await click('mindroomUi.backgroundJobs.stopAll');
  expect(document.activeElement).toBe(container.querySelector('[role="region"]'));
});

it('keeps keyboard focus in the bar when two jobs become one, and one becomes two', async () => {
  state.send = vi.fn(() => new Promise<never>(() => {}));
  state.jobs = [job('a'), job('b')];
  render();
  expand();
  button(cancelA)?.focus();
  await click(cancelA);
  expect(document.activeElement).toBe(button(cancelB));
  state.jobs = [job('b')];
  render();
  const region = container.querySelector('[role="region"]');
  expect(document.activeElement).toBe(region);
  // One job's focused Stop does not turn into Stop all under the pointer or keyboard.
  button(cancelB)?.focus();
  state.jobs = [job('b'), job('c')];
  render();
  expect(document.activeElement).toBe(region);
});

it('keeps focus in the bar when its one job is replaced by another', async () => {
  state.send = vi.fn(() => new Promise<never>(() => {}));
  state.jobs = [job('a')];
  render();
  button(cancelA)?.focus();
  state.jobs = [job('b')];
  render();
  expect(document.activeElement).toBe(container.querySelector('[role="region"]'));
});

it('does not take focus for a new job after the bar went away with focus in it', () => {
  state.send = vi.fn(() => new Promise<never>(() => {}));
  state.jobs = [job('a')];
  render();
  act(() => button(cancelA)?.click());
  expect(document.activeElement).toBe(container.querySelector('[role="region"]'));
  state.jobs = [];
  render();
  state.jobs = [job('b')];
  render();
  expect(document.activeElement).toBe(document.body);
});

it('leaves focus where the person moved it when the jobs change later', async () => {
  state.jobs = [job('a')];
  render();
  await act(async () => {
    const stop = button(cancelA);
    stop?.focus();
    // A browser blurs with no related target when focus goes to the page; jsdom names the
    // document instead, so the browser's event comes first.
    stop?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    stop?.blur();
  });
  state.jobs = [job('a'), job('b')];
  render();
  expect(document.activeElement).toBe(document.body);
});

// The mocked t, for a sub-agent job's strings.
const subagentName = 'mindroomUi.backgroundJobs.subagent{"tool":"run_subagent"}';
const tr = (key: string, values: Record<string, unknown>) => `${key}${JSON.stringify(values)}`;

// A frame of sub-agent `subagent`'s run `run-<subagent>`, as the room's Sub-agents panel gets it.
const ingestRun = (
  subagent: string,
  extra: Partial<SubagentMeta> = {},
  tools: ToolTraceEvent[] = []
) =>
  act(() =>
    getSubagentRunStore(mx as never).ingest(
      room.roomId,
      '@mindroom_code:example.org',
      {
        run: `run-${subagent}`,
        sid: 'sid',
        seq: 0,
        meta: {
          agent: 'mindroom_dev',
          subagent,
          caller: 'code',
          root: 'code',
          parent: null,
          threadId: '$thread',
          source: 'delegate',
          status: 'running',
          startedAt: 1,
          endedAt: null,
          ...extra,
        },
        snapshot: { md: '', reasoning: '', tools, status: 'streaming', activity: '', segments: [] },
      },
      Date.now()
    )
  );
const subagentJob = (jobId: string, overrides: Partial<BackgroundJob> = {}) =>
  job(jobId, { kind: 'subagent', tool: 'run_subagent', ...overrides });

it("opens the Sub-agents panel on a sub-agent job's run from its row's Open, and from no other", async () => {
  ingestRun('s1');
  // The room's bar lists every thread's jobs: the panel opens for the job's own thread.
  state.jobs = [
    subagentJob('a', { threadId: '$other', subagent: 's1', run: 'run-s1' }),
    // An older backend names no sub-agent, and one whose run sent no frame yet has none to show.
    subagentJob('c'),
    subagentJob('d', { subagent: 's2' }),
    job('b'),
  ];
  render(null);
  expand();
  const opens = [...container.querySelectorAll('[data-job-open]')];
  expect(opens).toHaveLength(1);
  expect(opens[0]?.closest('li')?.textContent).toContain('mindroom_dev');
  expect(opens[0]?.getAttribute('aria-label')).toBe(
    tr('mindroomUi.backgroundJobs.openFor', { name: 'mindroom_dev' })
  );
  // The name is no button.
  expect(button('mindroom_dev')).toBeUndefined();
  await act(async () => (opens[0] as HTMLButtonElement).click());
  expect(getDefaultStore().get(subagentsPanelAtom)).toEqual({
    roomId: room.roomId,
    threadId: '$other',
    run: 'run-s1',
  });
  // The list stays as it was; the panel opens beside it.
  expect(container.querySelectorAll('li')).toHaveLength(4);
});

it("opens one sub-agent job's run from beside its title, whose title stays the status", async () => {
  ingestRun('s1');
  state.jobs = [subagentJob('a', { subagent: 's1', run: 'run-s1' })];
  render('$thread');
  const open = container.querySelector<HTMLButtonElement>('[data-job-open]');
  expect(open?.getAttribute('aria-label')).toBe(
    tr('mindroomUi.backgroundJobs.openFor', { name: subagentName })
  );
  // The title's live text is not inside the button, so its changes are still announced.
  expect(open?.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    tr('mindroomUi.backgroundJobs.running', { tool: subagentName })
  );
  // The one job's row: its logo with its dot, its title, how long it has run, Open, then Stop.
  expect(container.querySelector('[data-job-logo]')?.getAttribute('data-job-logo')).toBe('agent');
  expect(container.querySelector('[data-job-state]')?.getAttribute('data-job-state')).toBe(
    'running'
  );
  expect(container.querySelector('[data-job-elapsed]')).not.toBeNull();
  expect(button(tr('mindroomUi.backgroundJobs.stopTaskFor', { tool: subagentName }))).toBeDefined();
  await act(async () => open?.click());
  expect(getDefaultStore().get(subagentsPanelAtom)).toEqual({
    roomId: room.roomId,
    threadId: '$thread',
    run: 'run-s1',
  });

  // One tool job has no Open, and shows a terminal for a logo.
  state.jobs = [job('a')];
  render();
  expect(container.querySelector('[data-job-open]')).toBeNull();
  expect(container.querySelector('[data-job-logo]')?.getAttribute('data-job-logo')).toBe('tool');
});

it("shows a sub-agent's agent, model, task, what it does now and what it used", () => {
  ingestRun(
    's1',
    {
      model: { modelConfig: 'opus', modelProvider: 'anthropic', modelId: 'claude-opus-5.5' },
      task: 'Port the fix\nwith tests',
      usage: { inputTokens: 1_850_000, outputTokens: 50_000, toolCalls: 31, costUsd: 1.3 },
    },
    [
      { type: 'tool_call_completed', tool_name: 'read_file', args_preview: 'a.ts' },
      { type: 'tool_call_started', tool_name: 'run_shell_command', args_preview: 'just test' },
    ]
  );
  state.jobs = [subagentJob('a', { subagent: 's1', run: 'run-s1' }), job('b')];
  render();
  expand();
  const row = container.querySelector('li[data-job-kind="subagent"]')!;
  expect(row.querySelector('[data-job-logo]')?.getAttribute('data-model-provider')).toBe(
    'anthropic'
  );
  expect(row.querySelector('[data-job-model]')?.textContent).toBe('Opus');
  expect(row.querySelector('.Task')?.textContent).toBe('Port the fix');
  expect(row.querySelector('[data-job-activity]')?.textContent).toBe('run_shell_command just test');
  // Each number in its column, bare, with its words as its title.
  const cells = [...row.querySelectorAll('[data-job-stat]')];
  expect(cells.map((cell) => cell.textContent)).toEqual(['31', '1.9M', '$1.30']);
  expect(cells.map((cell) => cell.getAttribute('title'))).toEqual([
    tr('mindroomUi.backgroundJobs.toolCalls', { count: 31 }),
    tr('mindroomUi.backgroundJobs.tokens', { count: 1_900_000, tokens: '1.9M' }),
    '$1.30',
  ]);
  // The job runs in the view's thread, so it names no thread.
  expect(row.querySelector('[data-job-thread]')).toBeNull();
});

it('shows no cost before any token, and counts one token as one', () => {
  const stats = (usage: SubagentMeta['usage']) => {
    getSubagentRunStore(mx as never).clear();
    ingestRun('s1', { usage });
    state.jobs = [subagentJob('a', { subagent: 's1', run: 'run-s1' }), job('b')];
    render();
    if (!toggle()?.getAttribute('aria-expanded')?.includes('true')) expand();
    return [...container.querySelectorAll('li [data-job-stat]')]
      .slice(0, 3)
      .map((cell) => cell.getAttribute('title') ?? '');
  };
  expect(stats({ inputTokens: 0, outputTokens: 0, toolCalls: 2, costUsd: 0 })).toEqual([
    tr('mindroomUi.backgroundJobs.toolCalls', { count: 2 }),
    '',
    '',
  ]);
  expect(stats({ inputTokens: 1, outputTokens: 0, toolCalls: 0 })).toEqual([
    '',
    tr('mindroomUi.backgroundJobs.tokens', { count: 1, tokens: '1' }),
    '',
  ]);
});

it("names the thread of a job that runs outside the view's, and shows it when pressed", async () => {
  state.jobs = [job('a', { threadId: '$other' }), job('b')];
  render(null);
  expand();
  const chips = [...container.querySelectorAll<HTMLButtonElement>('[data-job-thread]')];
  expect(chips.map((chip) => chip.textContent)).toEqual(['Title of $other', 'Title of $thread']);
  await act(async () => chips[0]?.click());
  expect(navigation.navigateRoomThread).toHaveBeenCalledWith(room.roomId, '$other');

  render('$thread');
  expect(container.querySelectorAll('[data-job-thread]')).toHaveLength(0);
});

it('heads the sub-agents and the tools only when both are listed, and sums them up in the title', () => {
  state.jobs = [job('a'), subagentJob('b'), job('c', { status: 'awaiting_approval' })];
  render();
  expand();
  expect([...container.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual([
    tr('mindroomUi.backgroundJobs.groupSubagents', { number: 1 }),
    tr('mindroomUi.backgroundJobs.groupTools', { number: 2 }),
  ]);
  expect(container.querySelector('.Summary')?.textContent).toBe(
    [
      tr('mindroomUi.subagents.nested', { count: 1 }),
      tr('mindroomUi.backgroundJobs.tools', { count: 2 }),
    ].join(' · ')
  );
  // Its leading "· " comes from the style, which a phone leaves out.
  expect(container.querySelector('.SummaryWaiting')?.textContent).toBe(
    tr('mindroomUi.backgroundJobs.needApproval', { count: 1 })
  );

  state.jobs = [job('a'), job('c')];
  render();
  expect(container.querySelectorAll('h3')).toHaveLength(0);
  expect(container.querySelector('.Summary')?.textContent).toBe(
    tr('mindroomUi.backgroundJobs.tools', { count: 2 })
  );
});

it('ticks the time each job has run out of the screen reader, which hears when it started', () => {
  vi.useFakeTimers({ now: Date.parse('2026-10-11T00:00:10+00:00') });
  try {
    state.jobs = [job('a')];
    render();
    const elapsed = container.querySelector('[data-job-elapsed]');
    expect(elapsed?.getAttribute('aria-hidden')).toBe('true');
    const before = elapsed?.textContent;
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(container.querySelector('[data-job-elapsed]')?.textContent).not.toBe(before);
    expect(container.querySelector('.VisuallyHidden')?.textContent).toContain(
      'mindroomUi.backgroundJobs.started'
    );
  } finally {
    vi.useRealTimers();
  }
});

it('says in its row that a job waits for approval, until it is stopping', () => {
  state.jobs = [job('a'), job('b', { status: 'awaiting_approval' })];
  render();
  expand();
  const rows = [...container.querySelectorAll('li')];
  expect(rows.map((row) => row.textContent?.includes('backgroundJobs.waiting'))).toEqual([
    false,
    true,
  ]);
  state.jobs = [job('a'), job('b', { status: 'cancel_requested' })];
  render();
  expect(container.textContent).not.toContain('backgroundJobs.waiting');
});

it('shows a failed cancel again in the view it was sent from', async () => {
  state.jobs = [job('a'), job('b', { threadId: '$other' })];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render(null);
  await click('mindroomUi.backgroundJobs.stopAll');
  render('$thread');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  render(null);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    'mindroomUi.backgroundJobs.stopAllFailed'
  );
});

it('shows a failed cancel only while its job is listed', async () => {
  state.jobs = [job('a')];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await click(cancelA);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  state.jobs = [job('b')];
  render();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('shows Stopping without a cancel button for a job cancelled elsewhere', () => {
  state.jobs = [job('a', { status: 'cancel_requested' }), job('b', { status: 'cancel_requested' })];
  render();
  expand();
  expect(container.textContent).toContain('mindroomUi.backgroundJobs.stopping');
  expect([...container.querySelectorAll('button')]).toEqual([toggle()]);
});

it('restores the button and shows an error when the send fails', async () => {
  state.jobs = [job('a')];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await act(async () => {
    button('mindroomUi.backgroundJobs.stopTaskFor{"tool":"tool_a"}')?.click();
  });
  expect(container.textContent).not.toContain('mindroomUi.backgroundJobs.stopping');
  expect(button('mindroomUi.backgroundJobs.stopTaskFor{"tool":"tool_a"}')).toBeDefined();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('stopFailed');
});

it('says the jobs could not be stopped when Stop all fails', async () => {
  state.jobs = [job('a'), job('b')];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await click('mindroomUi.backgroundJobs.stopAll');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    'mindroomUi.backgroundJobs.stopAllFailed'
  );
});

it('stop all sends one event for the view and marks every job stopping', async () => {
  state.jobs = [job('a'), job('b')];
  render();
  await act(async () => {
    button('mindroomUi.backgroundJobs.stopAll')?.click();
  });
  expect(state.send).toHaveBeenCalledTimes(1);
  expect(
    container.querySelectorAll('button[aria-label^="mindroomUi.backgroundJobs.stopTaskFor"]')
  ).toHaveLength(0);
});
