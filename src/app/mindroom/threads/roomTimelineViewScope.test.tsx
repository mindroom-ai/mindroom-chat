import { createElement, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import {
  useViewScopedFlag,
  useViewScopedState,
  type ViewScopedFlag,
} from './roomTimelineViewScope';

type Probe<T> = {
  /** The value each render returned, in render order. */
  rendered: T[];
  setValue?: Dispatch<SetStateAction<T>>;
};

function ScopedCounter({ viewKey, probe }: { viewKey: string; probe: Probe<string> }) {
  const [value, setValue] = useViewScopedState(viewKey, () => `${viewKey}:start`);
  probe.rendered.push(value);
  probe.setValue = setValue;
  return null;
}

const mountCounter = (viewKey: string, probe: Probe<string>): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(createElement(ScopedCounter, { viewKey, probe }));
  });
  if (!renderer) throw new Error('Expected a renderer');
  return renderer;
};

describe('useViewScopedState', () => {
  it('starts each view from its own initial value, in the render that shows it', () => {
    const probe: Probe<string> = { rendered: [] };
    const renderer = mountCounter('!a', probe);
    act(() => probe.setValue?.('!a:changed'));
    probe.rendered.length = 0;

    act(() => renderer.update(createElement(ScopedCounter, { viewKey: '!b', probe })));

    // No render of the new view returns the old view's value.
    expect(probe.rendered.length).toBeGreaterThan(0);
    expect(probe.rendered.every((value) => value === '!b:start')).toBe(true);
  });

  it('drops an update meant for a view that is no longer shown', () => {
    const probe: Probe<string> = { rendered: [] };
    const renderer = mountCounter('!a', probe);
    const setForA = probe.setValue;
    act(() => renderer.update(createElement(ScopedCounter, { viewKey: '!b', probe })));
    act(() => probe.setValue?.('!b:changed'));

    act(() => setForA?.('late for !a'));

    // Taken, it would stamp the state with the old view, and the next render would start the
    // shown view over.
    expect(probe.rendered.at(-1)).toBe('!b:changed');
  });

  it('applies values and updaters for the view on screen', () => {
    const probe: Probe<string> = { rendered: [] };
    mountCounter('!a', probe);

    act(() => probe.setValue?.('one'));
    act(() => probe.setValue?.((previous) => `${previous} two`));

    expect(probe.rendered.at(-1)).toBe('one two');
  });

  it('starts over when the reader comes back to a view', () => {
    const probe: Probe<string> = { rendered: [] };
    const renderer = mountCounter('!a', probe);
    act(() => probe.setValue?.('!a:changed'));
    act(() => renderer.update(createElement(ScopedCounter, { viewKey: '!b', probe })));

    act(() => renderer.update(createElement(ScopedCounter, { viewKey: '!a', probe })));

    expect(probe.rendered.at(-1)).toBe('!a:start');
  });
});

function FlagHolder({
  viewKey,
  onRender,
}: {
  viewKey: string;
  onRender: (flagRef: MutableRefObject<ViewScopedFlag>) => void;
}) {
  onRender(useViewScopedFlag(viewKey));
  return null;
}

describe('useViewScopedFlag', () => {
  it('keeps a flag within its view and clears it in the render that switches views', () => {
    const seen: boolean[] = [];
    let flagRef: MutableRefObject<ViewScopedFlag> | undefined;
    const onRender = (ref: MutableRefObject<ViewScopedFlag>) => {
      flagRef = ref;
      seen.push(ref.current.value);
    };
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(createElement(FlagHolder, { viewKey: '!a|', onRender }));
    });
    if (!flagRef || !renderer) throw new Error('Expected the flag to render');
    flagRef.current.value = true;
    const heldRef = flagRef;

    act(() => renderer?.update(createElement(FlagHolder, { viewKey: '!a|', onRender })));
    act(() => renderer?.update(createElement(FlagHolder, { viewKey: '!a|$thread', onRender })));

    expect(seen).toEqual([false, true, false]);
    // A callback that kept the ref reads the new view's flag.
    expect(heldRef).toBe(flagRef);
    expect(heldRef.current).toEqual({ viewKey: '!a|$thread', value: false });
  });
});
