import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ThreadWorkflowCounts,
  ThreadWorkflowTab,
} from '../../event-store/threads/threadWorkflow';
import { WorkflowTabs } from './WorkflowTabs';
import * as css from './WorkflowTabs.css';

const COUNTS: ThreadWorkflowCounts = { needsYou: 6, working: 8, later: 0, done: 14, all: 28 };

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const render = (active: ThreadWorkflowTab | undefined, counts: ThreadWorkflowCounts) => {
  const element = <WorkflowTabs active={active} counts={counts} />;
  act(() => {
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
  return renderer!.root;
};
const tab = (key: ThreadWorkflowTab) =>
  renderer!.root.find((node) => node.type === 'button' && node.props['data-thread-tab'] === key);
const gestures = () =>
  renderer!.root
    .findAll((node) => node.type === 'button' && node.props['data-gesture'] !== undefined)
    .map((node) => node.props['data-thread-tab'] as string);
const byClass = (className: string) =>
  renderer!.root.findAll((node) => node.type === 'span' && node.props.className === className);

describe('WorkflowTabs', () => {
  it('moves nothing on mount', () => {
    render('needsYou', COUNTS);
    expect(tab('needsYou').props['aria-pressed']).toBe(true);
    expect(gestures()).toEqual([]);
    expect(byClass(css.PingDot)).toHaveLength(0);
    expect(byClass(css.RollOut)).toHaveLength(0);
    expect(byClass(css.RollIn)).toHaveLength(0);
  });

  it('plays the gesture of a newly pressed tab only', () => {
    render('needsYou', COUNTS);
    render('done', COUNTS);
    expect(gestures()).toEqual(['done']);
    // Other filters press no tab, and the next pressed one gestures again.
    render(undefined, COUNTS);
    expect(gestures()).toEqual([]);
    render('done', COUNTS);
    expect(gestures()).toEqual(['done']);
  });

  it('rolls a changed count up or down and pings Needs you only when it grows', () => {
    render('all', COUNTS);
    render('all', { ...COUNTS, needsYou: 7, all: 29 });
    expect(byClass(css.PingDot)).toHaveLength(1);
    const rolled = () =>
      renderer!.root.findAll((node) => node.props['data-roll'] !== undefined && !!node.props.as);
    expect(rolled().map((node) => node.props['data-roll'])).toEqual(['up', 'up']);
    expect(byClass(css.RollOut).map((node) => node.props.children)).toEqual(['6', '28']);

    render('all', { ...COUNTS, needsYou: 5, all: 29 });
    expect(rolled().map((node) => node.props['data-roll'])).toEqual(['down', 'up']);
    expect(byClass(css.PingDot)).toHaveLength(1);
    expect(tab('needsYou').props['aria-label']).toBe('Needs you 5');
  });
});
