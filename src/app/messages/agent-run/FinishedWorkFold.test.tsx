import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualExpansionStateContext } from '../manualExpansionState';
import { FinishedWorkFold } from './FinishedWorkFold';

vi.mock('./FinishedWorkFold.css', () => ({
  Fold: 'Fold',
  Toggle: 'Toggle',
  Label: 'Label',
  Chevron: 'Chevron',
  Work: 'Work',
}));

describe('FinishedWorkFold', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const render = (element: JSX.Element) => {
    act(() => {
      renderer = create(element);
    });
    return renderer!;
  };

  const toggle = () => renderer!.root.findByType('button');
  const label = () => renderer!.root.findByProps({ className: 'Label' }).children.join('');
  const work = () => renderer!.root.findAll((node) => node.props.id === 'work');

  it('names how long the work took', () => {
    render(
      <FinishedWorkFold foldKey="finished-work:$a" durationMs={133_000}>
        <p id="work">work</p>
      </FinishedWorkFold>
    );
    expect(label()).toBe('Worked for 2m 13s');
  });

  it('says Worked without a duration', () => {
    render(
      <FinishedWorkFold foldKey="finished-work:$a">
        <p id="work">work</p>
      </FinishedWorkFold>
    );
    expect(label()).toBe('Worked');
  });

  it('shows the work only while open', () => {
    render(
      <FinishedWorkFold foldKey="finished-work:$a">
        <p id="work">work</p>
      </FinishedWorkFold>
    );
    expect(toggle().props['aria-expanded']).toBe(false);
    expect(work()).toHaveLength(0);

    act(() => {
      toggle().props.onClick();
    });
    expect(toggle().props['aria-expanded']).toBe(true);
    expect(work()).toHaveLength(1);

    act(() => {
      toggle().props.onClick();
    });
    expect(toggle().props['aria-expanded']).toBe(false);
    expect(work()).toHaveLength(0);
  });

  it('stays open across a remount in the same timeline', () => {
    const state = new Map<string, boolean>();
    const fold = (
      <ManualExpansionStateContext.Provider value={state}>
        <FinishedWorkFold foldKey="finished-work:$a">
          <p id="work">work</p>
        </FinishedWorkFold>
      </ManualExpansionStateContext.Provider>
    );
    render(fold);
    act(() => {
      toggle().props.onClick();
    });
    expect(state.get('finished-work:$a')).toBe(true);

    act(() => renderer!.unmount());
    render(fold);
    expect(toggle().props['aria-expanded']).toBe(true);
    expect(work()).toHaveLength(1);
  });
});
