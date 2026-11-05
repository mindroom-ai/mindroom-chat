import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useThreadsSelected } from './useThreadsSelected';

/** The hook's value for a router showing `path`, optionally under `basename`. */
const selectedAt = (path: string, basename?: string): boolean | undefined => {
  let selected: boolean | undefined;
  function Probe() {
    selected = useThreadsSelected();
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      React.createElement(
        MemoryRouter,
        { initialEntries: [path], basename },
        React.createElement(Probe)
      )
    );
  });
  act(() => renderer?.unmount());
  return selected;
};

describe('useThreadsSelected paths', () => {
  it('selects the Threads page with or without its trailing slash, and pages below it', () => {
    expect(selectedAt('/threads/')).toBe(true);
    expect(selectedAt('/threads')).toBe(true);
    expect(selectedAt('/threads/abc/def')).toBe(true);
  });

  it('matches the letter case of the Threads path', () => {
    expect(selectedAt('/Threads/')).toBe(false);
    expect(selectedAt('/THREADS')).toBe(false);
  });

  it('matches whole segments at the start of the path only', () => {
    expect(selectedAt('/threadsx')).toBe(false);
    expect(selectedAt('/threads-archive/')).toBe(false);
    expect(selectedAt('/rooms/threads/')).toBe(false);
    expect(selectedAt('/home/')).toBe(false);
    expect(selectedAt('/')).toBe(false);
  });

  it('reads the location relative to the router basename', () => {
    expect(selectedAt('/app/threads/', '/app')).toBe(true);
    expect(selectedAt('/app/home/', '/app')).toBe(false);
  });

  it('follows navigation in the same component', () => {
    const values: boolean[] = [];
    let mounts = 0;
    let navigate: NavigateFunction | undefined;
    function Probe() {
      navigate = useNavigate();
      values.push(useThreadsSelected());
      useEffect(() => {
        mounts += 1;
      }, []);
      return null;
    }
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/home/'] },
          React.createElement(Probe)
        )
      );
    });
    expect(values.at(-1)).toBe(false);

    act(() => navigate?.('/threads/'));
    expect(values.at(-1)).toBe(true);

    act(() => navigate?.(-1));
    expect(values.at(-1)).toBe(false);
    expect(mounts).toBe(1);

    act(() => renderer?.unmount());
  });
});
