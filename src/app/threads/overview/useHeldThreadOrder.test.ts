// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useHeldThreadOrder } from './useHeldThreadOrder';

describe('useHeldThreadOrder', () => {
  it('follows the live order while nothing holds it', () => {
    const { result, rerender } = renderHook(({ ids, held }) => useHeldThreadOrder(ids, held), {
      initialProps: { ids: ['$a', '$b', '$c'], held: false },
    });
    rerender({ ids: ['$c', '$a', '$b'], held: false });
    expect(result.current).toEqual(['$c', '$a', '$b']);
  });

  it('keeps the shown order while held, drops threads that leave, adds new ones last', () => {
    const { result, rerender } = renderHook(({ ids, held }) => useHeldThreadOrder(ids, held), {
      initialProps: { ids: ['$a', '$b', '$c', '$d'], held: false },
    });
    rerender({ ids: ['$a', '$b', '$c', '$d'], held: true });
    // $d got a reply and $b was resolved away; $e is new.
    rerender({ ids: ['$e', '$d', '$a', '$c'], held: true });
    expect(result.current).toEqual(['$a', '$c', '$d', '$e']);
    // Still held: the next update keeps that order.
    rerender({ ids: ['$c', '$e', '$d', '$a'], held: true });
    expect(result.current).toEqual(['$a', '$c', '$d', '$e']);
    // Released: the live order applies.
    rerender({ ids: ['$c', '$e', '$d', '$a'], held: false });
    expect(result.current).toEqual(['$c', '$e', '$d', '$a']);
  });
});
