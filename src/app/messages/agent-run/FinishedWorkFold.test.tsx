import type { JSX } from 'react';
// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpandAllInitContext, ManualExpansionStateContext } from '../manualExpansionState';
import { FinishedWorkFold } from './FinishedWorkFold';

vi.mock('./FinishedWorkFold.css', () => ({
  Row: 'Row',
  ClockBox: 'ClockBox',
  Clock: 'Clock',
  Hands: 'Hands',
  Label: 'WorkLabel',
  Chevron: 'WorkChevron',
  Ring: 'Ring',
  Work: 'Work',
  WorkInner: 'WorkInner',
}));
vi.mock('./OutlineComet.css', () => ({ Outline: 'Outline' }));
vi.mock('./Reasoning.css', () => ({
  Reasoning: 'Reasoning',
  Toggle: 'Toggle',
  Label: 'Label',
  Chevron: 'Chevron',
}));

// Each test folds a reply of its own key.
let keys = 0;
const nextKey = () => {
  keys += 1;
  return `finished-work:$reply${keys}`;
};

describe('FinishedWorkFold', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  const render = (element: JSX.Element) => {
    act(() => {
      renderer = create(element);
    });
    return renderer!;
  };

  const fold = (foldKey: string, durationMs?: number, foldable = true) => (
    <FinishedWorkFold
      foldKey={foldKey}
      durationMs={durationMs}
      whole={<p id="whole">whole</p>}
      folded={
        foldable ? { work: <p id="work">work</p>, answer: <p id="answer">answer</p> } : undefined
      }
    />
  );

  const rows = () => renderer!.root.findAllByType('button');
  const toggle = () => renderer!.root.findByType('button');
  const label = () =>
    renderer!.root.findByProps({ className: 'Label WorkLabel' }).children.join('');
  const byId = (id: string) => renderer!.root.findAll((node) => node.props.id === id);
  const click = () => {
    act(() => {
      toggle().props.onClick();
    });
  };
  // The work's wrapper finishing its slide, not an animation inside the work.
  const settle = () => {
    const work = renderer!.root.findByProps({ className: 'Work' });
    const event = { target: work, currentTarget: work };
    act(() => {
      work.props.onAnimationEnd(event);
    });
  };

  it('folds a reply that may fold', () => {
    render(fold(nextKey()));

    expect(rows()).toHaveLength(1);
    expect(byId('whole')).toHaveLength(0);
    expect(byId('work')).toHaveLength(0);
    expect(byId('answer')).toHaveLength(1);
  });

  it('renders a reply that may not fold whole, with no element of its own', () => {
    render(fold(nextKey(), undefined, false));

    expect(rows()).toHaveLength(0);
    expect(renderer!.toJSON()).toEqual({ type: 'p', props: { id: 'whole' }, children: ['whole'] });
  });

  it('folds a reply once it may fold', () => {
    const key = nextKey();
    render(fold(key, undefined, false));
    act(() => renderer!.update(fold(key)));

    expect(rows()).toHaveLength(1);
    expect(byId('answer')).toHaveLength(1);
  });

  it('names how long the work took', () => {
    render(fold(nextKey(), 133_000));
    expect(label()).toBe('Worked for 2m 13s');
  });

  it('says Worked without a duration', () => {
    render(fold(nextKey()));
    expect(label()).toBe('Worked');
  });

  it('shows the work only while open', () => {
    render(fold(nextKey()));
    expect(toggle().props['aria-expanded']).toBe(false);
    expect(byId('work')).toHaveLength(0);

    act(() => {
      toggle().props.onClick();
    });
    expect(toggle().props['aria-expanded']).toBe(true);
    expect(byId('work')).toHaveLength(1);
    expect(byId('answer')).toHaveLength(1);

    act(() => {
      toggle().props.onClick();
    });
    expect(toggle().props['aria-expanded']).toBe(false);
    settle();
    expect(byId('work')).toHaveLength(0);
  });

  it('sheds a new ring off the clock on each click', () => {
    render(fold(nextKey()));
    expect(renderer!.root.findAllByType('circle')).toHaveLength(0);

    click();
    const first = renderer!.root.findByType('circle');
    click();
    // A compared instance, not a printed one: printing a test instance does not end.
    expect(renderer!.root.findByType('circle') === first).toBe(false);
  });

  it('keeps the work until it has folded back', () => {
    render(fold(nextKey()));
    click();
    click();
    expect(toggle().props['aria-expanded']).toBe(false);
    expect(byId('work')).toHaveLength(1);

    const work = renderer!.root.findByProps({ className: 'Work' });
    act(() => {
      work.props.onAnimationEnd({ target: byId('work')[0], currentTarget: work });
    });
    expect(byId('work')).toHaveLength(1);

    settle();
    expect(byId('work')).toHaveLength(0);
  });

  it('slides the work open again when it is reopened as it folds back', () => {
    render(fold(nextKey()));
    click();
    settle();
    click();
    click();
    expect(toggle().props['aria-expanded']).toBe(true);
    expect(renderer!.root.findByProps({ className: 'Work' }).props['data-motion']).toBe('opening');
  });

  it('starts at rest when its split comes back after it went as the work folded back', () => {
    const key = nextKey();
    render(fold(key));
    click();
    settle();
    click();
    act(() => renderer!.update(fold(key, undefined, false)));
    act(() => renderer!.update(fold(key)));

    expect(toggle().props['aria-expanded']).toBe(false);
    expect(byId('work')).toHaveLength(0);
  });

  it('folds the work at once when collapse all comes as it folds back', () => {
    const key = nextKey();
    const tree = (expandAll: boolean | undefined) => (
      <ExpandAllInitContext.Provider value={expandAll}>{fold(key)}</ExpandAllInitContext.Provider>
    );
    render(tree(undefined));
    click();
    settle();
    click();
    act(() => renderer!.update(tree(false)));

    expect(byId('work')).toHaveLength(0);
  });

  it('folds the work back at once with reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    render(fold(nextKey()));
    click();
    click();
    expect(byId('work')).toHaveLength(0);
  });

  it('stays open across a remount in the same timeline', () => {
    const key = nextKey();
    const state = new Map<string, boolean>();
    const tree = (
      <ManualExpansionStateContext.Provider value={state}>
        {fold(key)}
      </ManualExpansionStateContext.Provider>
    );
    render(tree);
    act(() => {
      toggle().props.onClick();
    });
    expect(state.get(key)).toBe(true);

    act(() => renderer!.unmount());
    render(tree);
    expect(toggle().props['aria-expanded']).toBe(true);
    expect(byId('work')).toHaveLength(1);
  });

  describe('expand all', () => {
    const withExpandAll = (
      key: string,
      expandAll: boolean | undefined,
      state = new Map<string, boolean>()
    ) => (
      <ManualExpansionStateContext.Provider value={state}>
        <ExpandAllInitContext.Provider value={expandAll}>{fold(key)}</ExpandAllInitContext.Provider>
      </ManualExpansionStateContext.Provider>
    );

    it('opens the work of a reply that mounts under it', () => {
      render(withExpandAll(nextKey(), true));
      expect(toggle().props['aria-expanded']).toBe(true);
    });

    it('opens and folds a mounted reply as it changes', () => {
      const key = nextKey();
      render(withExpandAll(key, undefined));
      expect(toggle().props['aria-expanded']).toBe(false);

      act(() => renderer!.update(withExpandAll(key, true)));
      expect(toggle().props['aria-expanded']).toBe(true);
      expect(byId('work')).toHaveLength(1);

      act(() => renderer!.update(withExpandAll(key, false)));
      expect(toggle().props['aria-expanded']).toBe(false);
      expect(byId('work')).toHaveLength(0);
    });

    it('keeps the choice the reader made for the reply', () => {
      const key = nextKey();
      const state = new Map([[key, true]]);
      render(withExpandAll(key, false, state));
      expect(toggle().props['aria-expanded']).toBe(true);
    });
  });
});
