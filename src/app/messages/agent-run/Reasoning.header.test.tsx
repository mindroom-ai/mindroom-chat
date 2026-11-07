import { useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Icon, Icons } from 'folds';
import { withReasoning } from './Reasoning';

vi.mock('./Reasoning.css', () => ({
  Reasoning: 'Reasoning',
  Toggle: 'Toggle',
  Label: 'Label',
  Chevron: 'Chevron',
  Body: 'Body',
  ActivityCode: 'Code',
}));

const ICON_NAMES = new Map<unknown, string>([
  [Icons.Bulb, 'bulb'],
  [Icons.ChevronRight, 'chevron'],
]);

describe('reasoning header', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const toggle = (content: Record<string, unknown>) => {
    act(() => {
      renderer = create(<>{withReasoning(content, <p>Answer</p>, {})}</>);
    });
    return renderer!.root.findByType('button');
  };

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
