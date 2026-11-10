import { useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Icon, Icons } from 'folds';
import { withReasoning } from './Reasoning';

vi.mock('./Reasoning.css', () => ({
  Reasoning: 'Reasoning',
  Toggle: 'Toggle',
  CollapseEnd: 'CollapseEnd',
  Label: 'Label',
  Chevron: 'Chevron',
  Body: 'Body',
  ActivityCode: 'Code',
}));

const ICON_NAMES = new Map<unknown, string>([
  [Icons.Bulb, 'bulb'],
  [Icons.ChevronRight, 'chevron'],
  [Icons.ChevronTop, 'chevron up'],
]);

describe('reasoning header', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const focused: string[] = [];

  const toggle = (content: Record<string, unknown>) => {
    act(() => {
      renderer = create(<>{withReasoning(content, <p>Answer</p>, {})}</>, {
        // Each button records its class when it takes the focus.
        createNodeMock: (element) =>
          element.type === 'button'
            ? { focus: () => focused.push(element.props.className as string) }
            : null,
      });
    });
    return renderer!.root.findByProps({ className: 'Toggle' });
  };

  const collapseEnd = () =>
    renderer!.root.findAll(
      (node) => node.type === 'button' && node.props.className === 'CollapseEnd'
    );

  // The button's direct children: icons by their source, the label by its text.
  const parts = (button: ReactTestInstance) =>
    (button.children as ReactTestInstance[]).map((child) =>
      child.type === Icon
        ? {
            icon: ICON_NAMES.get(child.props.src) ?? 'other',
            className: child.props.className as string | undefined,
            hidden: child.props['aria-hidden'] as boolean,
          }
        : { label: child.children.join('') }
    );

  it('shows a bulb, the label and one chevron that CSS turns when it opens', () => {
    const button = toggle({
      body: 'Answer',
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.reasoning': { text: 'Weighed two options', duration_ms: 7600 },
    });

    expect(parts(button)).toEqual([
      { icon: 'bulb', className: undefined, hidden: true },
      { label: 'Thought for 8 s' },
      { icon: 'chevron', className: 'Chevron', hidden: true },
    ]);
    expect(button.props['aria-expanded']).toBe(false);

    act(() => {
      button.props.onClick();
    });

    expect(button.props['aria-expanded']).toBe(true);
    expect(parts(button)[2]).toEqual({ icon: 'chevron', className: 'Chevron', hidden: true });
  });

  it('gives streaming reasoning the same header, open', () => {
    const button = toggle({
      body: 'Thinking...',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_reasoning': 'Comparing options',
    });

    expect(parts(button)).toEqual([
      { icon: 'bulb', className: undefined, hidden: true },
      { label: 'Thinking' },
      { icon: 'chevron', className: 'Chevron', hidden: true },
    ]);
    expect(button.props['aria-expanded']).toBe(true);
  });

  it('puts a chevron up and Collapse under open reasoning, which fold it and focus the header', () => {
    focused.length = 0;
    const button = toggle({
      body: 'Thinking...',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.live_reasoning': 'Comparing options',
    });

    const [end] = collapseEnd();
    if (!end) throw new Error('No collapse button under the reasoning');
    expect(parts(end)).toEqual([
      { icon: 'chevron up', className: undefined, hidden: true },
      { label: 'Collapse' },
    ]);
    expect(end.props['aria-expanded']).toBeUndefined();

    act(() => {
      end.props.onClick();
    });

    expect(button.props['aria-expanded']).toBe(false);
    expect(collapseEnd()).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ className: 'Body' })).toHaveLength(0);
    expect(focused).toEqual(['Toggle']);
  });

  it('has no collapse button under folded reasoning', () => {
    toggle({
      body: 'Answer',
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.reasoning': { text: 'Weighed two options', duration_ms: 7600 },
    });

    expect(collapseEnd()).toHaveLength(0);
  });

  it('keeps the body and its state when warm-up lines or reasoning come and go', () => {
    const Body = () => {
      const [first] = useState(() => Math.random());
      return <p data-first={first}>Answer</p>;
    };
    const body = <Body />;
    const show = (extra: Record<string, unknown>) => (
      <>
        {withReasoning(
          { body: 'Answer', 'io.mindroom.stream_status': 'streaming', ...extra },
          body,
          {}
        )}
      </>
    );
    act(() => {
      renderer = create(show({}));
    });
    const first = renderer!.root.findByType('p').props['data-first'];
    for (const extra of [
      { 'io.mindroom.live_activity': 'Starting the worker' },
      {},
      { 'io.mindroom.live_reasoning': 'Thinking it over' },
      {},
    ]) {
      act(() => renderer!.update(show(extra)));
      expect(renderer!.root.findByType('p').props['data-first']).toBe(first);
    }
  });
});
