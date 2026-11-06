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

  it('keeps the shown order while held, drops threads that leave, adds new ones at the live end', () => {
    const { result, rerender } = renderHook(({ ids, held }) => useHeldThreadOrder(ids, held), {
      initialProps: { ids: ['$a', '$b', '$c', '$d'], held: false },
    });
    rerender({ ids: ['$a', '$b', '$c', '$d'], held: true });
    // $d got a reply and $b was resolved away; $e is new and leads the newest-first order.
    rerender({ ids: ['$e', '$d', '$a', '$c'], held: true });
    expect(result.current).toEqual(['$e', '$a', '$c', '$d']);
    // Still held: the next update keeps that order.
    rerender({ ids: ['$c', '$e', '$d', '$a'], held: true });
    expect(result.current).toEqual(['$e', '$a', '$c', '$d']);
    // Released: the live order applies.
    rerender({ ids: ['$c', '$e', '$d', '$a'], held: false });
    expect(result.current).toEqual(['$c', '$e', '$d', '$a']);
  });

  it('puts new threads at the top of a newest-first list, in their live order', () => {
    const { result, rerender } = renderHook(({ ids, held }) => useHeldThreadOrder(ids, held), {
      initialProps: { ids: ['$c', '$b', '$a'], held: true },
    });
    rerender({ ids: ['$e', '$d', '$c', '$b', '$a'], held: true });
    expect(result.current).toEqual(['$e', '$d', '$c', '$b', '$a']);
  });

  it('puts new threads at the bottom of an oldest-first list', () => {
    const { result, rerender } = renderHook(({ ids, held }) => useHeldThreadOrder(ids, held), {
      initialProps: { ids: ['$a', '$b', '$c'], held: true },
    });
    // $a got a reply, which would move it to the bottom; $d is new.
    rerender({ ids: ['$b', '$c', '$a', '$d'], held: true });
    expect(result.current).toEqual(['$a', '$b', '$c', '$d']);
  });

  it('puts a new thread after the thread the live order puts before it', () => {
    const { result, rerender } = renderHook(({ ids, held }) => useHeldThreadOrder(ids, held), {
      initialProps: { ids: ['$a', '$b', '$c'], held: true },
    });
    // An older page brought $x, whose last reply falls between $b and $c.
    rerender({ ids: ['$a', '$b', '$x', '$c'], held: true });
    expect(result.current).toEqual(['$a', '$b', '$x', '$c']);
  });
});
