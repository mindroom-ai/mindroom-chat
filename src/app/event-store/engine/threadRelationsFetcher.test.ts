import { beforeAll, describe, expect, it, vi } from 'vitest';
import { makeEvent, matrixClientMock } from '../../timeline/test-utils/RoomTimeline.test.shared';

let fetchAllThreadRelations: typeof import('./threadRelationsFetcher').fetchAllThreadRelations;
let MAX_THREAD_FETCH_EVENTS = 0;

beforeAll(async () => {
  const threadRelationsFetcher = await import('./threadRelationsFetcher');
  fetchAllThreadRelations = threadRelationsFetcher.fetchAllThreadRelations;
  MAX_THREAD_FETCH_EVENTS = threadRelationsFetcher.MAX_THREAD_FETCH_EVENTS;
});

describe('fetchAllThreadRelations', () => {
  const makeRawEvent = (eventId: string, ts: number) => ({
    event_id: eventId,
    origin_server_ts: ts,
    content: { body: eventId },
  });

  const makeFetchMx = () => {
    const mapper = (raw: { event_id?: string; origin_server_ts?: number }) =>
      makeEvent(raw.event_id ?? '', { ts: raw.origin_server_ts ?? 0 });
    return {
      ...matrixClientMock,
      fetchRelations: vi.fn(),
      getEventMapper: () => mapper,
    };
  };

  it('returns null when the first page fails', async () => {
    const mx = makeFetchMx();
    mx.fetchRelations.mockRejectedValue(new Error('network'));

    const result = await fetchAllThreadRelations(
      mx as never,
      '!room:x',
      '$thread',
      200,
      () => false
    );

    expect(result).toBeNull();
    expect(mx.fetchRelations).toHaveBeenCalledTimes(1);
  });

  it('returns partial data when a later page fails', async () => {
    const mx = makeFetchMx();
    mx.fetchRelations
      .mockResolvedValueOnce({
        chunk: [makeRawEvent('$e2', 200), makeRawEvent('$e1', 100)],
        next_batch: 'tok1',
      })
      .mockRejectedValueOnce(new Error('network'));

    const result = await fetchAllThreadRelations(
      mx as never,
      '!room:x',
      '$thread',
      200,
      () => false
    );

    expect(result).not.toBeNull();
    expect(result!.events.map((e) => e.getId())).toEqual(['$e1', '$e2']);
    expect(result!.nextBatchToken).toBe('tok1');
    expect(mx.fetchRelations).toHaveBeenCalledTimes(2);
  });

  it('follows next_batch tokens across multiple pages', async () => {
    const mx = makeFetchMx();
    mx.fetchRelations
      .mockResolvedValueOnce({
        chunk: [makeRawEvent('$e3', 300), makeRawEvent('$e2', 200)],
        next_batch: 'tok1',
      })
      .mockResolvedValueOnce({
        chunk: [makeRawEvent('$e1', 100)],
        next_batch: null,
      });

    const result = await fetchAllThreadRelations(mx as never, '!room:x', '$thread', 2, () => false);

    expect(result).not.toBeNull();
    expect(result!.events.map((e) => e.getId())).toEqual(['$e1', '$e2', '$e3']);
    expect(result!.nextBatchToken).toBeUndefined();
    expect(mx.fetchRelations).toHaveBeenCalledTimes(2);
    expect(mx.fetchRelations.mock.calls[1]![4]).toEqual(expect.objectContaining({ from: 'tok1' }));
  });

  it('returns events in chronological order across batches', async () => {
    const mx = makeFetchMx();
    mx.fetchRelations
      .mockResolvedValueOnce({
        chunk: [makeRawEvent('$e5', 500), makeRawEvent('$e4', 400)],
        next_batch: 'tok1',
      })
      .mockResolvedValueOnce({
        chunk: [makeRawEvent('$e3', 300), makeRawEvent('$e2', 200)],
        next_batch: 'tok2',
      })
      .mockResolvedValueOnce({
        chunk: [makeRawEvent('$e1', 100)],
        next_batch: null,
      });

    const result = await fetchAllThreadRelations(mx as never, '!room:x', '$thread', 2, () => false);

    expect(result!.events.map((e) => e.getId())).toEqual(['$e1', '$e2', '$e3', '$e4', '$e5']);
  });

  it('stops when there is no next_batch token', async () => {
    const mx = makeFetchMx();
    mx.fetchRelations.mockResolvedValueOnce({
      chunk: [makeRawEvent('$e1', 100)],
      next_batch: null,
    });

    const result = await fetchAllThreadRelations(
      mx as never,
      '!room:x',
      '$thread',
      200,
      () => false
    );

    expect(result).not.toBeNull();
    expect(result!.events).toHaveLength(1);
    expect(result!.nextBatchToken).toBeUndefined();
    expect(mx.fetchRelations).toHaveBeenCalledTimes(1);
  });

  it('returns empty events for a thread with no replies', async () => {
    const mx = makeFetchMx();
    mx.fetchRelations.mockResolvedValueOnce({
      chunk: [],
      next_batch: null,
    });

    const result = await fetchAllThreadRelations(
      mx as never,
      '!room:x',
      '$thread',
      200,
      () => false
    );

    expect(result).not.toBeNull();
    expect(result!.events).toHaveLength(0);
  });

  it('returns null when isAborted returns true mid-loop', async () => {
    const mx = makeFetchMx();
    let aborted = false;
    mx.fetchRelations.mockImplementation(async () => {
      aborted = true;
      return { chunk: [makeRawEvent('$e1', 100)], next_batch: 'tok1' };
    });

    const result = await fetchAllThreadRelations(
      mx as never,
      '!room:x',
      '$thread',
      200,
      () => aborted
    );

    expect(result).toBeNull();
    expect(mx.fetchRelations).toHaveBeenCalledTimes(1);
  });

  it('preserves the final next_batch token from the last successful page', async () => {
    const mx = makeFetchMx();
    const largeBatch = Array.from({ length: MAX_THREAD_FETCH_EVENTS }, (_, i) =>
      makeRawEvent(`$e${i}`, i)
    );
    mx.fetchRelations.mockResolvedValueOnce({
      chunk: largeBatch,
      next_batch: 'should-be-preserved',
    });

    const result = await fetchAllThreadRelations(
      mx as never,
      '!room:x',
      '$thread',
      MAX_THREAD_FETCH_EVENTS + 1,
      () => false
    );

    expect(result).not.toBeNull();
    expect(result!.nextBatchToken).toBe('should-be-preserved');
    expect(mx.fetchRelations).toHaveBeenCalledTimes(1);
  });

  it('passes the correct limit parameter to fetchRelations', async () => {
    const mx = makeFetchMx();
    mx.fetchRelations.mockResolvedValueOnce({
      chunk: [],
      next_batch: null,
    });

    await fetchAllThreadRelations(mx as never, '!room:x', '$thread', 200, () => false);

    expect(mx.fetchRelations).toHaveBeenCalledWith(
      '!room:x',
      '$thread',
      null,
      null,
      expect.objectContaining({ limit: 200, recurse: true })
    );
  });
});
