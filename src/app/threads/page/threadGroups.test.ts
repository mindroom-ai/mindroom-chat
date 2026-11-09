import { describe, expect, it } from 'vitest';
import type { CrossRoomThreadIndexEntry } from '../cross-room/crossRoomThreadIndex';
import type { ThreadApprovalRecord } from '../../matrix/protocol/threadApprovalModel';
import type { ThreadSignals } from '../cross-room/threadSignals';
import { groupThreads, type ThreadListItem } from './threadGroups';

const ME = '@alice:x';
const quiet: ThreadSignals = {
  mentionedMe: false,
  newCount: 0,
  newSenderIds: [],
  automation: false,
};

const item = (
  key: string,
  entry: Partial<CrossRoomThreadIndexEntry> & { streaming?: boolean; replies?: number },
  signals: Partial<ThreadSignals> = {}
): ThreadListItem => ({
  entry: {
    key,
    roomId: `!${key}:x`,
    threadRootId: `$${key}`,
    roomName: 'Room',
    rootSenderId: ME,
    isInvolved: true,
    isUnread: false,
    isResolved: false,
    lastActivityTs: 1000,
    searchableText: key,
    threadRecord: {
      status: { replyCount: entry.replies ?? 1, isStreaming: entry.streaming ?? false },
    },
    ...entry,
  } as CrossRoomThreadIndexEntry,
  signals: { ...quiet, ...signals },
});

const approval = { eventId: '$ask' } as ThreadApprovalRecord;
const shape = (groups: ReturnType<typeof groupThreads>) =>
  groups.map((group) => [group.id, group.items.map((it) => it.entry.key)]);

describe('groupThreads', () => {
  it('puts each thread in the first group that fits, in group order', () => {
    const groups = groupThreads(
      [
        item('recent', { lastActivityTs: 500 }),
        item('working', { streaming: true }),
        item('waits', { streaming: true, lastActivityTs: 2000 }, { pendingApproval: approval }),
        item(
          'asks',
          {},
          { pendingQuestion: { eventId: '$q', senderId: 'a', text: 'q', options: [] } }
        ),
        item('unread', { isUnread: true }, { newCount: 2 }),
      ],
      'following',
      ME,
      ''
    );
    expect(shape(groups)).toEqual([
      ['needsYou', ['waits', 'asks']],
      ['unread', ['unread']],
      ['working', ['working']],
      ['recent', ['recent']],
    ]);
  });

  it('keeps Mine to threads the user started and Following to threads they take part in', () => {
    const items = [
      item('mine', {}),
      item('joined', { rootSenderId: '@bob:x' }),
      item('other', { rootSenderId: '@bob:x', isInvolved: false }),
    ];
    const keys = (scope: Parameters<typeof groupThreads>[1]) =>
      groupThreads(items, scope, ME, '').flatMap((group) => group.items.map((it) => it.entry.key));
    expect(keys('mine')).toEqual(['mine']);
    expect(keys('following').sort()).toEqual(['joined', 'mine']);
    expect(keys('all').sort()).toEqual(['joined', 'mine', 'other']);
  });

  it('folds automations at the end, and only for All', () => {
    const items = [
      item('digest', { rootSenderId: '@mindroom_bot:x', isInvolved: false }, { automation: true }),
      item('talk', { rootSenderId: '@bob:x', isInvolved: false }),
    ];
    expect(shape(groupThreads(items, 'all', ME, ''))).toEqual([
      ['recent', ['talk']],
      ['automations', ['digest']],
    ]);
    expect(groupThreads(items, 'following', ME, '')).toEqual([]);
  });

  it('leaves out threads without replies and matches the search on their text', () => {
    const items = [
      item('empty', { replies: 0 }),
      item('deploy', { searchableText: 'staging load test deploy' }),
      item('deck', { searchableText: 'board deck polish' }),
    ];
    expect(shape(groupThreads(items, 'following', ME, '  DEPLOY '))).toEqual([
      ['recent', ['deploy']],
    ]);
  });

  it('orders the recent threads by their last activity', () => {
    const groups = groupThreads(
      [item('old', { lastActivityTs: 1 }), item('new', { lastActivityTs: 9 })],
      'following',
      ME,
      ''
    );
    expect(shape(groups)).toEqual([['recent', ['new', 'old']]]);
  });
});
