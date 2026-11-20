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
import { BackgroundJobRow } from './BackgroundJobRow';
import type { BackgroundJobsBarItem } from './backgroundJobsPresentation';
import { keepCancelsOf } from '../matrix/state/sentCancels';
import { showUsageDetails } from '../../test/utils/showUsageDetails';

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
  Stack: 'Stack',
  StackedLogo: 'StackedLogo',
  JobText: 'JobText',
  Headline: 'Headline',
  Detail: 'Detail',
  Task: 'Task',
  RowOpen: 'RowOpen',
  Name: 'Name',
  Model: 'Model',
  Activity: 'Activity',
  Preview: 'Preview',
  Pill: { waiting: 'Pill', stopping: 'Pill', done: 'Pill' },
  PillText: 'PillText',
  PillIcon: 'PillIcon',
  WithThreads: 'WithThreads',
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
  ToolName: 'ToolName',
  Folded: 'Folded',
  FoldedText: 'FoldedText',
  FoldedToggle: 'FoldedToggle',
  FoldedActions: 'FoldedActions',
  Quiet: 'Quiet',
}));
vi.mock('../subagents/RunLogo.css', () => ({
  Logo: 'Logo',
  Dot: { running: 'Dot', waiting: 'Dot', stopping: 'Dot', stopped: 'Dot', finished: 'Dot' },
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
const tr = (key: string, values: Record<string, unknown>) => `${key}${JSON.stringify(values)}`;
// Without the usage details, a tool job's Stop names it as its row does: what it does, in words.
const using = (tool: string) => tr('mindroomUi.backgroundJobs.toolNames.using', { tool });
const cancelA = tr('mindroomUi.backgroundJobs.stopTaskFor', { tool: using('tool a') });
const cancelB = tr('mindroomUi.backgroundJobs.stopTaskFor', { tool: using('tool b') });
const stoppingA = tr('mindroomUi.backgroundJobs.stoppingJob', { tool: using('tool a') });
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
  showUsageDetails(false);
});

it('renders nothing without jobs', () => {
  render();
  expect(container.innerHTML).toBe('');
});

it('shows one job folded as its row on the title line, which lists it as several do', () => {
  state.jobs = [job('a')];
  render();
  // Without the usage details, the bar's title is what it does, in words, as its row's headline.
  expect(title()).toBe(using('tool a'));
  // How it stands is said apart, since its row's title is the job itself.
  expect(container.querySelector('[role="status"]')?.textContent).toBe(title());
  // With them, by its tool.
  act(() => showUsageDetails());
  expect(title()).toBe('mindroomUi.backgroundJobs.running{"tool":"tool_a"}');
  act(() => showUsageDetails(false));
  expect(container.querySelector('.Jobs')).toBeNull();
  const folded = container.querySelector('[data-job-folded]');
  expect(folded?.querySelector('.Logo')).not.toBeNull();
  // Without the usage details, its headline says what the tool does, in words.
  const usingA = tr('mindroomUi.backgroundJobs.toolNames.using', { tool: 'tool a' });
  expect(folded?.querySelector('.Task')?.textContent).toBe(usingA);
  // Its Stop names the task it stops, with its icon only, as a listed row's.
  expect(button(cancelA)?.getAttribute('title')).toBe(cancelA);
  expect(button(cancelA)?.textContent).toBe('');
  // Its title lists it: the same row in the table, the count on the title line, Stop task.
  expect(toggle()?.textContent).toBe(usingA);
  expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
  toggle()?.focus();
  expand();
  expect(container.querySelectorAll('.Jobs li')).toHaveLength(1);
  expect(container.querySelector('[data-job-folded]')).toBeNull();
  expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelector('.Title')?.textContent).toBe(
    tr('mindroomUi.backgroundJobs.jobTotal', { count: 1 })
  );
  expect(container.querySelector('.Summary')?.textContent).toBe(
    tr('mindroomUi.backgroundJobs.tools', { count: 1 })
  );
  // Focus follows the title to its new place.
  expect(document.activeElement).toBe(toggle());
  // One job has one Stop, the labelled one under the list, not its row's icon too.
  const stops = [...container.querySelectorAll('button[data-cancel-job]')];
  expect(stops.map((stop) => stop.textContent)).toEqual(['mindroomUi.backgroundJobs.stopTask']);
  expect(container.querySelector('.Jobs [data-cancel-job]')).toBeNull();
  // Escape folds it back, with focus on its title.
  act(() => {
    toggle()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(container.querySelector('[data-job-folded]')).not.toBeNull();
  expect(document.activeElement).toBe(toggle());
});

it('shows the next job folded after the list it was pinned open in emptied', async () => {
  vi.useFakeTimers();
  try {
    state.jobs = [job('a')];
    render();
    expand();
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    state.jobs = [];
    render();
    await act(() => vi.advanceTimersByTime(2_000));
    expect(container.innerHTML).toBe('');
    state.jobs = [job('b')];
    render();
    expect(container.querySelector('[data-job-folded]')).not.toBeNull();
    expect(container.querySelector('.Jobs')).toBeNull();
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
  } finally {
    vi.useRealTimers();
  }
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
    expect(title()).toBe(tr('mindroomUi.backgroundJobs.finished', { tool: using('tool a') }));
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
  expect(container.textContent).toContain(
    tr('mindroomUi.backgroundJobs.toolNames.using', { tool: 'tool a' })
  );
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
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    tr('mindroomUi.backgroundJobs.stopStepFailed', { step: using('tool b') })
  );
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
  // The one job left folds to its row; focus stays in the bar.
  state.jobs = [job('b')];
  render();
  expect(container.querySelector('[data-job-folded]')).not.toBeNull();
  expect(document.activeElement).toBe(container.querySelector('[role="region"]'));
  // One job's focused Stop does not turn into Stop all under the pointer or keyboard.
  button(cancelB)?.focus();
  state.jobs = [job('b'), job('c')];
  render();
  expect(document.activeElement).toBe(container.querySelector('[role="region"]'));
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

it("opens the Sub-agents panel on a sub-agent job's run from its row's title, and from no other", async () => {
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
  // The title is the button, its words its text; the row has no other Open.
  expect(opens[0]?.classList.contains('Task')).toBe(true);
  expect(opens[0]?.textContent).toBe('mindroom_dev');
  // Its other buttons: its thread's, then its Stop.
  const rowButtons = [...(opens[0]?.closest('li')?.querySelectorAll('button') ?? [])];
  expect(rowButtons.slice(1).map((item) => item.matches('[data-job-thread]'))).toEqual([
    true,
    false,
  ]);
  expect(rowButtons[2]?.matches('[data-cancel-job]')).toBe(true);
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
    tr('mindroomUi.backgroundJobs.openFor', { name: 'mindroom_dev' })
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

it('folds one sub-agent job into its row: title, agent, model, its call and numbers, Open', () => {
  showUsageDetails();
  ingestRun(
    's1',
    {
      title: 'Rework the export queue retry policy',
      model: { modelConfig: 'fable', modelProvider: 'anthropic', modelId: 'claude-fable-5.2' },
      usage: { inputTokens: 1_300_000, outputTokens: 100_000, toolCalls: 34, costUsd: 1.3 },
    },
    [{ type: 'tool_call_started', tool_name: 'run_shell_command', args_preview: 'uv run pytest' }]
  );
  state.jobs = [subagentJob('a', { subagent: 's1', run: 'run-s1' })];
  render('$thread');
  const row = container.querySelector('[data-job-folded]')!;
  expect(row.querySelector('.Task')?.textContent).toBe('Rework the export queue retry policy');
  // Its title lists it; Open beside it shows its run.
  expect(row.querySelector('.Task')?.getAttribute('aria-expanded')).toBe('false');
  expect(row.querySelector('[data-job-model]')?.textContent).toBe('Fable');
  expect(row.querySelector('[data-job-activity]')?.textContent).toBe(
    'run_shell_command uv run pytest'
  );
  const cells = [...row.querySelectorAll('[data-job-stat]')].map((cell) => cell.textContent);
  expect(cells).toEqual(['34', '1.4M', '$1.30']);
  expect(row.querySelector('[data-job-open]')?.getAttribute('aria-label')).toBe(
    tr('mindroomUi.backgroundJobs.openFor', { name: 'Rework the export queue retry policy' })
  );
  // Its run's thread is the view's, so it names none.
  expect(row.querySelector('[data-job-thread]')).toBeNull();
  // Listed, its row is the same, its title opening its run.
  expand();
  const listed = container.querySelector('li[data-job-kind="subagent"]')!;
  expect(listed.querySelector('[data-job-activity]')?.textContent).toBe(
    'run_shell_command uv run pytest'
  );
  expect(listed.querySelector('.RowOpen')?.textContent).toBe(
    'Rework the export queue retry policy'
  );
});

it("shows a sub-agent's title, with its task as the title's tooltip", () => {
  ingestRun('s1', { title: 'Refactor login form', task: 'Refactor the login form\nwith tests' }, [
    { type: 'tool_call_started', tool_name: 'run_shell_command', args_preview: 'just test' },
  ]);
  state.jobs = [subagentJob('a', { subagent: 's1', run: 'run-s1' }), job('b')];
  render();
  expand();
  const task = container.querySelector('li[data-job-kind="subagent"] .Task');
  expect(task?.textContent).toBe('Refactor login form');
  expect(task?.getAttribute('title')).toBe('Refactor the login form\nwith tests');
});

it("shows an untitled sub-agent's agent, model, task, the call it makes now and what it used", () => {
  showUsageDetails();
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
  // The call it makes now, never one it completed.
  expect(row.querySelector('[data-job-activity] .ToolName')?.textContent).toBe('run_shell_command');
  expect(row.querySelector('[data-job-activity] .Preview')?.textContent).toBe('just test');
  expect(row.textContent).not.toContain('read_file');
  // Each number in its column, bare, with its words as its title.
  const cells = [...row.querySelectorAll('[data-job-stat]')];
  expect(cells.map((cell) => cell.textContent)).toEqual(['31', '1.9M', '$1.30']);
  expect(cells.map((cell) => cell.getAttribute('title'))).toEqual([
    tr('mindroomUi.subagents.calls', { count: 31 }),
    tr('mindroomUi.backgroundJobs.tokens', { count: 1_900_000, tokens: '1.9M' }),
    '$1.30',
  ]);
  // The job runs in the view's thread, so it names no thread.
  expect(row.querySelector('[data-job-thread]')).toBeNull();
});

it('shows no cost before any token, and counts one token as one', () => {
  showUsageDetails();
  const stats = (usage: SubagentMeta['usage']) => {
    act(() => getSubagentRunStore(mx as never).clear());
    ingestRun('s1', { usage });
    state.jobs = [subagentJob('a', { subagent: 's1', run: 'run-s1' }), job('b')];
    render();
    if (!toggle()?.getAttribute('aria-expanded')?.includes('true')) expand();
    return [...container.querySelectorAll('li [data-job-stat]')]
      .slice(0, 3)
      .map((cell) => cell.getAttribute('title') ?? '');
  };
  expect(stats({ inputTokens: 0, outputTokens: 0, toolCalls: 2, costUsd: 0 })).toEqual([
    tr('mindroomUi.subagents.calls', { count: 2 }),
    '',
    '',
  ]);
  expect(stats({ inputTokens: 1, outputTokens: 0, toolCalls: 0 })).toEqual([
    '',
    tr('mindroomUi.backgroundJobs.tokens', { count: 1, tokens: '1' }),
    '',
  ]);
});

it('shows a sub-agent job without what it does now, its numbers, agent or model, until the usage details are shown', () => {
  ingestRun(
    's1',
    {
      title: "Summarize this week's meeting notes",
      task: 'Summarize the notes of this week\nKeep it short.',
      model: { modelConfig: 'fable', modelProvider: 'anthropic', modelId: 'claude-fable-5.2' },
      usage: { inputTokens: 1_300_000, outputTokens: 100_000, toolCalls: 34, costUsd: 1.3 },
    },
    [
      {
        type: 'tool_call_started',
        tool_name: 'read_file',
        args_preview: 'path=notes/2026-11-16.md',
      },
    ]
  );
  const task = 'Summarize the notes of this week\nKeep it short.';
  state.jobs = [subagentJob('a', { subagent: 's1', run: 'run-s1' })];
  render('$thread');
  const folded = container.querySelector('[data-job-folded]')!;
  expect(folded.querySelector('.Task')?.textContent).toBe("Summarize this week's meeting notes");
  expect(folded.querySelector('.Task')?.getAttribute('title')).toBe(task);
  // No line under the title: not who, nor on what model, nor what it does now.
  expect(folded.querySelector('.Detail')).toBeNull();
  expect(folded.querySelector('[data-job-activity]')).toBeNull();
  expect(folded.querySelector('[data-job-model]')).toBeNull();
  expect(folded.querySelector('[data-job-stat]')).toBeNull();
  // The time and the buttons stay; the grid has no number columns.
  expect(folded.querySelector('[data-job-elapsed]')).not.toBeNull();
  expect(folded.querySelector('[data-job-open]')).not.toBeNull();
  expect(container.querySelector('.Bar')?.classList.contains('Quiet')).toBe(true);
  // Listed, its row and its group's heading have none either.
  expand();
  const listed = container.querySelector('li[data-job-kind="subagent"]')!;
  expect(listed.querySelector('.Detail')).toBeNull();
  expect(listed.querySelector('.RowOpen')?.getAttribute('title')).toBe(task);
  expect(listed.querySelector('[data-job-stat]')).toBeNull();
  expect(container.querySelector('.StatColumn')).toBeNull();
  expect(container.querySelector('.ColumnName')?.textContent).toBe(
    'mindroomUi.backgroundJobs.column.time'
  );

  // Shown, the row is the one with every number.
  act(() => showUsageDetails());
  render('$thread');
  expect(container.querySelector('.Bar')?.classList.contains('Quiet')).toBe(false);
  expect(listed.querySelector('.RowOpen')?.getAttribute('title')).toBe(task);
  expect(listed.querySelector('[data-job-model]')?.textContent).toBe('Fable');
  expect(listed.querySelector('[data-job-activity]')?.textContent).toBe(
    'read_file path=notes/2026-11-16.md'
  );
  expect([...listed.querySelectorAll('[data-job-stat]')].map((cell) => cell.textContent)).toEqual([
    '34',
    '1.4M',
    '$1.30',
  ]);
  expect(container.querySelectorAll('.StatColumn')).toHaveLength(3);
});

it('heads a tool job with its tool in plain words, without its call, until the usage details are shown', () => {
  const item = (extra: Partial<BackgroundJobsBarItem> = {}): BackgroundJobsBarItem => ({
    jobId: 'a',
    name: 'read_file',
    waiting: false,
    stopping: false,
    finished: false,
    subagent: false,
    threadId: '$thread',
    state: 'running',
    startedAt: Date.parse('2026-10-11T00:00:00+00:00'),
    depth: 0,
    ...extra,
  });
  const row = (shown: BackgroundJobsBarItem) =>
    act(() => {
      root.render(
        <ul>
          <BackgroundJobRow room={room} item={shown} viewThreadId="$thread" stop={null} />
        </ul>
      );
    });
  const headline = () => container.querySelector('.Task')?.textContent;
  const tooltip = () => container.querySelector('.Task')?.getAttribute('title');
  const activity = () => container.querySelector('[data-job-activity]')?.textContent ?? null;
  const read = { tool: 'read_file', preview: 'path=notes/2026-11-16.md' };
  // Its name in words, from its tool alone, whether its call is loaded or not; its tool the tooltip.
  row(item());
  expect(headline()).toBe('mindroomUi.backgroundJobs.toolNames.readingFile');
  expect(tooltip()).toBe('read_file');
  row(item({ activity: read }));
  expect(headline()).toBe('mindroomUi.backgroundJobs.toolNames.readingFile');
  expect(tooltip()).toBe('read_file');
  expect(activity()).toBeNull();
  row(item({ finished: true, state: 'finished', activity: read }));
  expect(headline()).toBe('mindroomUi.backgroundJobs.toolNames.readingFile');
  // With the usage details, its headline is its tool, its call on the line under it.
  act(() => showUsageDetails());
  row(item({ activity: read }));
  expect(headline()).toBe('read_file');
  expect(activity()).toBe('path=notes/2026-11-16.md');
});

it("names the thread of a job that runs outside the view's, and shows it when pressed", async () => {
  state.jobs = [job('a', { threadId: '$other' }), job('b')];
  render(null);
  expand();
  const chips = [...container.querySelectorAll<HTMLButtonElement>('[data-job-thread]')];
  expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual([
    tr('thread.aria.openThread', { title: 'Title of $other' }),
    tr('thread.aria.openThread', { title: 'Title of $thread' }),
  ]);
  // Each one sits with its row's buttons, before its Stop.
  expect(chips[0]?.nextElementSibling?.matches('[data-cancel-job]')).toBe(true);
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
    expect(container.querySelector('.Elapsed .VisuallyHidden')?.textContent).toContain(
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
    button(cancelA)?.click();
  });
  expect(container.textContent).not.toContain('mindroomUi.backgroundJobs.stopping');
  expect(button(cancelA)).toBeDefined();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    tr('mindroomUi.backgroundJobs.stopStepFailed', { step: using('tool a') })
  );
  // With the usage details, it names its tool.
  act(() => showUsageDetails());
  await act(async () => {
    button('mindroomUi.backgroundJobs.stopTaskFor{"tool":"tool_a"}')?.click();
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    'mindroomUi.backgroundJobs.stopFailed{"tool":"tool_a"}'
  );
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
