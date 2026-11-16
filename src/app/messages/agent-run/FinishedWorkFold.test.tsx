// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpandAllInitContext, ManualExpansionStateContext } from '../manualExpansionState';
import { FinishedWorkFold } from './FinishedWorkFold';

vi.mock('./FinishedWorkFold.css', () => ({
  Fold: 'Fold',
  Toggle: 'Toggle',
  Label: 'Label',
  Chevron: 'Chevron',
  Work: 'Work',
}));

// Each test folds a reply of its own: the fold remembers per key whether a reply was tall.
let keys = 0;
const nextKey = () => {
  keys += 1;
  return `finished-work:$reply${keys}`;
};

describe('FinishedWorkFold', () => {
  let renderer: ReactTestRenderer | undefined;
  let measured = 0;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    measured = 0;
  });

  /** Renders with the reply `height` pixels tall; jsdom's viewport is 768 pixels. */
  const render = (element: JSX.Element, height = 2000) => {
    act(() => {
      renderer = create(element, {
        createNodeMock: () => ({
          getBoundingClientRect: () => {
            measured += 1;
            return { height };
          },
        }),
      });
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
  const label = () => renderer!.root.findByProps({ className: 'Label' }).children.join('');
  const byId = (id: string) => renderer!.root.findAll((node) => node.props.id === id);

  it('folds a reply taller than the screen', () => {
    expect(window.innerHeight).toBe(768);
    render(fold(nextKey()), 2000);

    expect(rows()).toHaveLength(1);
    expect(byId('whole')).toHaveLength(0);
    expect(byId('work')).toHaveLength(0);
    expect(byId('answer')).toHaveLength(1);
  });

  it('leaves a reply shorter than the screen as it is, without a row', () => {
    render(fold(nextKey()), 500);

    expect(rows()).toHaveLength(0);
    expect(byId('whole')).toHaveLength(1);
    expect(byId('answer')).toHaveLength(0);
  });

  it('renders a reply that may not fold whole, without measuring it', () => {
    render(fold(nextKey(), undefined, false));

    expect(measured).toBe(0);
    expect(rows()).toHaveLength(0);
    expect(byId('whole')).toHaveLength(1);
  });

  it('keeps a short reply in place when it may fold', () => {
    const key = nextKey();
    render(fold(key, undefined, false), 500);
    const whole = byId('whole')[0];
    act(() => renderer!.update(fold(key)));

    expect(measured).toBe(1);
    expect(rows()).toHaveLength(0);
    expect(byId('whole')[0]).toBe(whole);
  });

  it('folds a tall reply once it may fold', () => {
    const key = nextKey();
    render(fold(key, undefined, false));
    act(() => renderer!.update(fold(key)));

    expect(rows()).toHaveLength(1);
    expect(byId('answer')).toHaveLength(1);
  });

  it('measures a reply once, also across a remount', () => {
    const key = nextKey();
    render(fold(key), 2000);
    act(() => renderer!.unmount());
    render(fold(key), 500);

    expect(measured).toBe(1);
    expect(rows()).toHaveLength(1);
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
