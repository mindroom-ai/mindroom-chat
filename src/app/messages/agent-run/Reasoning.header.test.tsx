import { useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Icon, Icons } from 'folds';
import { withReasoning } from './Reasoning';
import { ToolCallsCogContext } from './toolCallStatus';

vi.mock('./Reasoning.css', () => ({
  Reasoning: 'Reasoning',
  Line: 'Line',
  Toggle: 'Toggle',
  CogRow: 'CogRow',
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

  describe("the reply's tool-call cog", () => {
    const cog = <button data-cog="">2</button>;
    const reply = (content: Record<string, unknown>) => {
      act(() => {
        renderer = create(
          <ToolCallsCogContext.Provider value={cog}>
            {withReasoning(content, <p>Answer</p>, {})}
          </ToolCallsCogContext.Provider>
        );
      });
      return renderer!.root.find((node) => node.props?.['data-cog'] !== undefined);
    };

    it('sits on the line of finished reasoning, after its toggle', () => {
      const found = reply({
        body: 'Answer',
        'io.mindroom.stream_status': 'completed',
        'io.mindroom.reasoning': { text: 'Weighed two options', duration_ms: 7600 },
      });
      const line = found.parent!;
      expect(line.props.className).toBe('Line');
      expect(line.children.map((child) => (child as ReactTestInstance).props.className)).toEqual([
        'Toggle',
        undefined,
      ]);
    });

    it('sits on the line of streaming reasoning too, above the open reasoning', () => {
      const found = reply({
        body: 'Thinking...',
        'io.mindroom.stream_status': 'streaming',
        'io.mindroom.live_reasoning': 'Comparing options',
      });
      expect(found.parent!.props.className).toBe('Line');
      expect(found.parent!.findByProps({ className: 'Toggle' }).props['aria-expanded']).toBe(true);
    });

    it('has a row of its own above the body when the reply has no reasoning', () => {
      const found = reply({ body: 'Answer', 'io.mindroom.stream_status': 'completed' });
      expect(found.parent!.props.className).toBe('CogRow');
      expect(renderer!.toJSON()).toMatchObject([{ props: { className: 'CogRow' } }, { type: 'p' }]);
    });

    it('leaves no row when the reply has no cog', () => {
      act(() => {
        renderer = create(
          <>
            {withReasoning(
              { body: 'Answer', 'io.mindroom.stream_status': 'completed' },
              <p>Answer</p>,
              {}
            )}
          </>
        );
      });
      expect(renderer!.root.findAllByProps({ className: 'CogRow' })).toHaveLength(0);
    });
  });

  it('keeps the body and its state when warm-up lines, reasoning or the cog come and go', () => {
    const Body = () => {
      const [first] = useState(() => Math.random());
      return <p data-first={first}>Answer</p>;
    };
    const body = <Body />;
    const show = ({ cog, ...extra }: Record<string, unknown>) => (
      <ToolCallsCogContext.Provider value={cog ? <button>1</button> : null}>
        {withReasoning(
          { body: 'Answer', 'io.mindroom.stream_status': 'streaming', ...extra },
          body,
          {}
        )}
      </ToolCallsCogContext.Provider>
    );
    act(() => {
      renderer = create(show({}));
    });
    const first = renderer!.root.findByType('p').props['data-first'];
    for (const extra of [
      { 'io.mindroom.live_activity': 'Starting the worker' },
      {},
      { cog: true },
      { cog: true, 'io.mindroom.live_reasoning': 'Thinking it over' },
      { 'io.mindroom.live_reasoning': 'Thinking it over' },
      {},
    ]) {
      act(() => renderer!.update(show(extra)));
      expect(renderer!.root.findByType('p').props['data-first']).toBe(first);
    }
  });
});
