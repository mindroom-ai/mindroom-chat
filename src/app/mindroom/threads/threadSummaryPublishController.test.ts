import { describe, expect, it } from 'vitest';
import { getActiveThreadSummaryInfo } from './threadSummaryPublishController';

const makeSummaryEvent = (
  summaryText: string,
  generatedAt: string,
  messageCount: number
) =>
  ({
    getContent: () => ({
      msgtype: 'm.notice',
      body: summaryText,
      'io.mindroom.thread_summary': {
        version: 1,
        summary: summaryText,
        generated_at: generatedAt,
        message_count: messageCount,
      },
    }),
  }) as never;

describe('getActiveThreadSummaryInfo', () => {
  it('returns undefined outside a thread route', () => {
    expect(
      getActiveThreadSummaryInfo({
        thread: null,
        threadEvents: [makeSummaryEvent('Summary', '2026-01-01T00:00:00Z', 1)],
        threadId: undefined,
      })
    ).toBeUndefined();
  });

  it('selects the newest summary from active thread sources', () => {
    const older = makeSummaryEvent('Older summary', '2026-01-01T00:00:00Z', 1);
    const newer = makeSummaryEvent('Newer summary', '2026-01-02T00:00:00Z', 2);

    expect(
      getActiveThreadSummaryInfo({
        thread: {
          events: [older],
          timeline: [],
        } as never,
        threadEvents: [newer],
        threadId: '$thread',
      })
    ).toEqual({
      generatedTs: Date.parse('2026-01-02T00:00:00Z'),
      messageCount: 2,
      summaryText: 'Newer summary',
    });
  });
});
