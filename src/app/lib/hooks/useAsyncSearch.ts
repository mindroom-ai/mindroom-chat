import { useCallback, useEffect, useRef, useState } from 'react';

/** How many items a caller may scan synchronously while the async search is still running. */
export const SEARCH_NOW_SCAN_LIMIT = 50;

/** Items the search checks per slice before yielding to the browser. */
const SEARCH_SLICE_SIZE = 200;

type AsyncSearchResult<T> = {
  query: string;
  items: T[];
};

type AsyncSearchOptions = {
  /** Most results to return. */
  limit?: number;
};

/** How well an item matches the normalized query: lower is better, undefined is no match. */
export type SearchRank<T> = (item: T, needle: string) => number | undefined;

/** Queries and the strings they are matched against compare in this form. */
export const normalizeSearchString = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase().trim();

type Ranked<T> = { item: T; rank: number };

const rankEach = <T>(items: readonly T[], rank: SearchRank<T>, needle: string): Ranked<T>[] =>
  items.flatMap((item) => {
    const itemRank = rank(item, needle);
    return itemRank === undefined ? [] : [{ item, rank: itemRank }];
  });

// Array sort is stable, so items of equal rank keep the order they were given in.
const byRank = <T>(ranked: Ranked<T>[]): T[] =>
  ranked.sort((left, right) => left.rank - right.rank).map(({ item }) => item);

/** The items `rank` matches to the normalized `needle`, best first; equal ranks keep their order. */
export const rankMatches = <T>(items: readonly T[], rank: SearchRank<T>, needle: string): T[] =>
  byRank(rankEach(items, rank, needle));

/**
 * Searches `items` with `rank`, in slices so long lists do not block typing, and answers the
 * matches best first, as `rankMatches` does. A new query or a reset cancels the search in
 * progress; a new item list runs the last query again over it.
 */
export const useAsyncSearch = <T>(
  items: T[],
  rank: SearchRank<T>,
  options?: AsyncSearchOptions
): [AsyncSearchResult<T> | undefined, (query: string) => void, () => void] => {
  const [result, setResult] = useState<AsyncSearchResult<T>>();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const rankRef = useRef(rank);
  rankRef.current = rank;
  const limit = options?.limit;
  const queryRef = useRef<string>();

  const cancel = useCallback(() => {
    if (timerRef.current === undefined) return;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);

  const search = useCallback(
    (query: string) => {
      cancel();
      queryRef.current = query;
      const needle = normalizeSearchString(query);
      const source = itemsRef.current;
      const ranked: Ranked<T>[] = [];
      let index = 0;

      const runSlice = () => {
        const end = Math.min(index + SEARCH_SLICE_SIZE, source.length);
        ranked.push(...rankEach(source.slice(index, end), rankRef.current, needle));
        index = end;
        if (index < source.length) {
          timerRef.current = setTimeout(runSlice, 0);
          return;
        }
        timerRef.current = undefined;
        const matches = byRank(ranked);
        setResult({ query, items: limit === undefined ? matches : matches.slice(0, limit) });
      };

      timerRef.current = setTimeout(runSlice, 0);
    },
    [cancel, limit]
  );

  const resetSearch = useCallback(() => {
    cancel();
    queryRef.current = undefined;
    setResult(undefined);
  }, [cancel]);

  const searchedItemsRef = useRef(items);
  useEffect(() => {
    if (searchedItemsRef.current === items) return;
    searchedItemsRef.current = items;
    if (queryRef.current !== undefined) search(queryRef.current);
  }, [items, search]);

  useEffect(() => cancel, [cancel]);

  return [result, search, resetSearch];
};
