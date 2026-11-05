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

type SearchItemStrGetter<T> = (item: T) => string | string[];

const normalizeSearchString = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase().trim();

const toStrings = (value: string | string[]): string[] => (Array.isArray(value) ? value : [value]);

/**
 * Searches `items` by the strings `getItemStr` returns, in slices so long lists do not block
 * typing. Items whose string starts with the query come first; others that contain it follow.
 * A new query or a reset cancels the search in progress; a new item list runs the last query
 * again over it.
 */
export const useAsyncSearch = <T>(
  items: T[],
  getItemStr: SearchItemStrGetter<T>,
  options?: AsyncSearchOptions
): [AsyncSearchResult<T> | undefined, (query: string) => void, () => void] => {
  const [result, setResult] = useState<AsyncSearchResult<T>>();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const getItemStrRef = useRef(getItemStr);
  getItemStrRef.current = getItemStr;
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
      const prefixMatches: T[] = [];
      const otherMatches: T[] = [];
      let index = 0;

      const runSlice = () => {
        const end = Math.min(index + SEARCH_SLICE_SIZE, source.length);
        const slice = source.slice(index, end);
        index = end;
        for (const item of slice) {
          const strings = toStrings(getItemStrRef.current(item)).map(normalizeSearchString);
          if (strings.some((value) => value.startsWith(needle))) prefixMatches.push(item);
          else if (strings.some((value) => value.includes(needle))) otherMatches.push(item);
        }
        if (index < source.length) {
          timerRef.current = setTimeout(runSlice, 0);
          return;
        }
        timerRef.current = undefined;
        const matches = [...prefixMatches, ...otherMatches];
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
