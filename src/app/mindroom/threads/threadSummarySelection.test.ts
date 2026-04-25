import { describe, expect, it } from 'vitest';
import {
  buildPreferredThreadSummaryMap,
  shouldWriteThreadSummaryToCache,
} from './threadSummarySelection';

describe('buildPreferredThreadSummaryMap', () => {
  it('prefers the newer cached summary over an older loaded room summary', () => {
    const cachedSummaryMap = new Map([
      [
        '$root',
        {
          summaryText: 'Newer cached summary',
          generatedTs: Date.parse('2026-03-29T11:00:00.000Z'),
          messageCount: 12,
        },
      ],
    ]);
    const loadedSummaryMap = new Map([
      [
        '$root',
        {
          summaryText: 'Older loaded summary',
          generatedTs: Date.parse('2026-03-29T10:00:00.000Z'),
          messageCount: 10,
        },
      ],
    ]);

    expect(buildPreferredThreadSummaryMap(cachedSummaryMap, loadedSummaryMap)).toEqual(
      new Map([
        [
          '$root',
          {
            summaryText: 'Newer cached summary',
            generatedTs: Date.parse('2026-03-29T11:00:00.000Z'),
            messageCount: 12,
          },
        ],
      ])
    );
  });
});

describe('shouldWriteThreadSummaryToCache', () => {
  it('does not overwrite a newer cached summary with an older loaded summary', () => {
    expect(
      shouldWriteThreadSummaryToCache(
        {
          summaryText: 'Newer cached summary',
          generatedTs: Date.parse('2026-03-29T11:00:00.000Z'),
          messageCount: 12,
        },
        {
          summaryText: 'Older loaded summary',
          generatedTs: Date.parse('2026-03-29T10:00:00.000Z'),
          messageCount: 10,
        }
      )
    ).toBe(false);
  });

  it('writes when the loaded summary is newer than the cached summary', () => {
    expect(
      shouldWriteThreadSummaryToCache(
        {
          summaryText: 'Older cached summary',
          generatedTs: Date.parse('2026-03-29T10:00:00.000Z'),
          messageCount: 10,
        },
        {
          summaryText: 'Newer loaded summary',
          generatedTs: Date.parse('2026-03-29T11:00:00.000Z'),
          messageCount: 12,
        }
      )
    ).toBe(true);
  });

  it('writes when the loaded summary text changes but recency metadata ties', () => {
    expect(
      shouldWriteThreadSummaryToCache(
        {
          summaryText: 'Stale cached text',
          generatedTs: Date.parse('2026-03-29T11:00:00.000Z'),
          messageCount: 12,
        },
        {
          summaryText: 'Updated live text',
          generatedTs: Date.parse('2026-03-29T11:00:00.000Z'),
          messageCount: 12,
        }
      )
    ).toBe(true);
  });
});
