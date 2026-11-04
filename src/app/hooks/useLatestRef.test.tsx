import { act, create } from 'react-test-renderer';
import type { MutableRefObject } from 'react';
import { describe, expect, it } from 'vitest';
import { useLatestRef } from './useLatestRef';

describe('useLatestRef', () => {
  it('keeps one ref across renders that holds the value of the newest one', () => {
    const refs: MutableRefObject<string>[] = [];
    function Probe({ value }: { value: string }) {
      refs.push(useLatestRef(value));
      return null;
    }
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<Probe value="first" />);
    });
    act(() => renderer?.update(<Probe value="second" />));

    expect(refs).toHaveLength(2);
    expect(refs[0]).toBe(refs[1]);
    expect(refs[0]?.current).toBe('second');
    act(() => renderer?.unmount());
  });
});
