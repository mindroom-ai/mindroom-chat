import { createInstance, type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../i18n/englishResources';
import type { ThreadConversationCost } from '../event-store/threads/threadConversationCost';
import { threadLiveStatusRows, type ThreadLiveStatus } from './threadLiveStatus';

let t: TFunction;

beforeAll(async () => {
  const language = createInstance();
  await language.init({ lng: 'en', resources: { en: { translation: en } } });
  t = language.t;
});

const idle: ThreadLiveStatus = {
  streaming: false,
  pendingApproval: false,
  pendingQuestion: false,
  runningTools: { count: 0, names: [] },
  activeSubagents: 0,
  jobs: [],
};

const cost = (usd: number[], complete: boolean): ThreadConversationCost => {
  let sum = 0;
  const replies = usd.map((value, index) => ({ eventId: `$r${index}`, usd: value }));
  return {
    complete,
    replies,
    byEventId: new Map(
      replies.map(({ eventId, usd: value }, index) => {
        sum += value;
        return [eventId, { usd: sum, replyCount: index + 1 }];
      })
    ),
  };
};

const rows = (status: Partial<ThreadLiveStatus>) =>
  threadLiveStatusRows({ ...idle, ...status }, t, 'en').map(({ label, value }) => [label, value]);

describe('threadLiveStatusRows', () => {
  it('has no row for an idle thread with no priced reply', () => {
    expect(rows({})).toEqual([]);
  });

  it('says the thread streams, or that it waits for the person first', () => {
    expect(rows({ streaming: true })).toEqual([['Status', 'Streaming']]);
    expect(rows({ streaming: true, pendingQuestion: true })).toEqual([
      ['Status', 'Waiting for an answer'],
    ]);
    expect(rows({ streaming: true, pendingQuestion: true, pendingApproval: true })).toEqual([
      ['Status', 'Waiting for approval'],
    ]);
  });

  it('counts the running tools with up to two of their names', () => {
    expect(rows({ runningTools: { count: 1, names: ['shell'] } })).toEqual([
      ['Tools', '1 running: shell'],
    ]);
    expect(rows({ runningTools: { count: 3, names: ['shell', 'grep'] } })).toEqual([
      ['Tools', '3 running: shell, grep'],
    ]);
    expect(rows({ runningTools: { count: 4, names: ['shell', 'grep', 'read_file'] } })).toEqual([
      ['Tools', '4 running: shell, grep, …'],
    ]);
    expect(rows({ runningTools: { count: 2, names: [] } })).toEqual([['Tools', '2 running']]);
  });

  it('counts the active sub-agents', () => {
    expect(rows({ activeSubagents: 2 })).toEqual([['Sub-agents', '2 active']]);
  });

  it('counts the background jobs and those that wait for approval', () => {
    expect(rows({ jobs: [{ status: 'running' }] })).toEqual([['Background', '1 job']]);
    expect(
      rows({
        jobs: [{ status: 'running' }, { status: 'awaiting_approval' }, { status: 'running' }],
      })
    ).toEqual([['Background', '3 jobs, 1 waiting for approval']]);
  });

  it('gives the jobs as a lower bound when the room has jobs no agent lists', () => {
    expect(rows({ jobs: [{ status: 'running' }], jobsUnlisted: true })).toEqual([
      ['Background', '≥ 1 job'],
    ]);
    // With no listed job here, nothing is known about the others.
    expect(rows({ jobsUnlisted: true })).toEqual([]);
  });

  it('gives the total cost, as a lower bound while older replies are not loaded', () => {
    expect(rows({ cost: cost([0.25, 1], true) })).toEqual([['Cost', '$1.25']]);
    expect(rows({ cost: cost([0.25, 1], false) })).toEqual([['Cost', '≥ $1.25']]);
  });

  it('keeps one order with every row', () => {
    const all = threadLiveStatusRows(
      {
        streaming: true,
        pendingApproval: false,
        pendingQuestion: false,
        runningTools: { count: 1, names: ['shell'] },
        activeSubagents: 1,
        jobs: [{ status: 'running' }],
        cost: cost([0.5], true),
      },
      t,
      'en'
    );
    expect(all.map(({ key }) => key)).toEqual([
      'status',
      'tools',
      'subagents',
      'background',
      'cost',
    ]);
  });
});
