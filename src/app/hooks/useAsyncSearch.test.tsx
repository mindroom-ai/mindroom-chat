import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAsyncSearch, UseAsyncSearchResult } from './useAsyncSearch';

const getStr = (item: string) => item;
let latest: { result?: UseAsyncSearchResult<string>; search: (query: string) => void };

function Harness({ list }: { list: string[] }) {
  const [result, search] = useAsyncSearch(list, getStr);
  latest = { result, search };
  return null;
}

const originalWindow = globalThis.window;

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { performance: { now: () => 0 }, setTimeout, clearTimeout },
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

describe('useAsyncSearch', () => {
  it('searches a new list again instead of dropping the result', () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Harness list={['maya', 'mind']} />);
    });
    act(() => latest.search('Min'));
    expect(latest.result).toEqual({ query: 'min', items: ['mind'] });

    act(() => renderer.update(<Harness list={['maya', 'mindy']} />));

    expect(latest.result).toEqual({ query: 'min', items: ['mindy'] });
  });
});
