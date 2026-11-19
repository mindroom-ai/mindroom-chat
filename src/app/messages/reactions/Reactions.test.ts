import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Reactions } from './Reactions';

const { reactionRenderSpy, useMessageRenderer } = vi.hoisted(() => ({
  reactionRenderSpy: vi.fn(),
  useMessageRenderer: vi.fn(),
}));

vi.mock('../../plugins/messageRenderers', () => ({ useMessageRenderer }));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  const passthrough = 'div';

  return {
    ...actual,
    Box: passthrough,
    Modal: passthrough,
    Overlay: passthrough,
    OverlayBackdrop: passthrough,
    OverlayCenter: passthrough,
    Text: passthrough,
    Tooltip: passthrough,
    TooltipProvider: ({ children }: { children: (ref: null) => React.ReactNode }) => children(null),
    as: <T extends React.ElementType, P>(component: React.ForwardRefRenderFunction<any, P>) =>
      React.forwardRef(component) as unknown as T,
    toRem: (value: number) => `${value / 16}rem`,
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@bas:mindroom.chat',
  }),
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => true,
}));

vi.mock('./Reaction', () => ({
  ReactionTooltipMsg: () => null,
  Reaction: ({
    reaction,
    count,
    label,
    onClick,
    ...props
  }: {
    reaction: string;
    count: number;
    label?: string;
    onClick?: () => void;
  }) => {
    reactionRenderSpy({ reaction, count, label, props });
    return React.createElement(
      'button',
      { type: 'button', onClick, ...props },
      reaction,
      label || count
    );
  },
}));

vi.mock('./ReactionViewer', () => ({
  ReactionViewer: () => null,
}));

vi.mock('../styles.css', () => ({
  ReactionsContainer: 'ReactionsContainer',
  ReactionsTooltipText: 'ReactionsTooltipText',
  StopLabels: 'StopLabels',
  StopLabel: 'StopLabel',
  StopLabelHidden: 'StopLabelHidden',
  StopStatus: 'StopStatus',
}));

class MockRelations {
  constructor(private groupedAnnotations?: [string, Set<MatrixEvent>][]) {}

  on() {}

  removeListener() {}

  getSortedAnnotationsByKey() {
    return (
      this.groupedAnnotations ??
      ([
        [
          '🔄',
          new Set([
            {
              getSender: () => '@bas:mindroom.chat',
              getTs: () => 0,
              getRelation: () => ({ rel_type: 'm.annotation' }),
              isRedacted: () => false,
            } as MatrixEvent,
          ]),
        ],
      ] as [string, Set<MatrixEvent>][])
    );
  }
}

const renderers: ReturnType<typeof create>[] = [];
const render = (element: React.ReactElement) => {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(element);
  });
  renderers.push(renderer);
  return renderer;
};

const AGENT = '@agent:mindroom.chat';
const VIEWER = '@bas:mindroom.chat';
const reaction = (sender: string, id = `$${sender}`) =>
  ({
    getId: () => id,
    getSender: () => sender,
    getTs: () => 0,
    getRelation: () => ({ rel_type: 'm.annotation' }),
    isRedacted: () => false,
  } as MatrixEvent);
const stops = (senders: string[]) =>
  new MockRelations([['🛑', new Set(senders.map((sender) => reaction(sender)))]]);
const streamingReply = () =>
  ({
    getSender: () => AGENT,
    getContent: () => ({ 'io.mindroom.stream_status': 'streaming' }),
  } as MatrixEvent);
const stopProps = (
  relations: MockRelations,
  targetEvent: MatrixEvent,
  onReactionToggle: ReturnType<typeof vi.fn>
) => ({
  room: {} as never,
  mEventId: '$event',
  targetEvent,
  canSendReaction: true,
  relations: relations as never,
  onReactionToggle,
});
const stopChip = (renderer: ReturnType<typeof create>) => renderer.root.findByType('button');
const shownLabel = (renderer: ReturnType<typeof create>) =>
  renderer.root.find((node) => node.props['aria-hidden'] === false).props.children;
const status = (renderer: ReturnType<typeof create>) =>
  renderer.root.find((node) => node.props.role === 'status').props.children;

describe('Reactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      renderers.splice(0).forEach((renderer) => renderer.unmount());
    });
  });

  it('passes the rendered relations object back on toggle', () => {
    const relations = new MockRelations();
    const onReactionToggle = vi.fn();

    const renderer = render(
      React.createElement(Reactions, {
        room: {} as never,
        mEventId: '$event',
        targetEvent: {
          getSender: () => '@bas:mindroom.chat',
          getContent: () => ({}),
        } as MatrixEvent,
        canSendReaction: true,
        relations: relations as never,
        onReactionToggle,
      })
    );

    const button = renderer.root.findByType('button');

    act(() => {
      button.props.onClick();
    });

    expect(onReactionToggle).toHaveBeenCalledWith('$event', '🔄', undefined, relations, false);
  });

  it('does not toggle a reaction on an unconfirmed target', () => {
    const relations = new MockRelations();
    const onReactionToggle = vi.fn();

    const renderer = render(
      React.createElement(Reactions, {
        room: {} as never,
        mEventId: '~!room:example.org:txn-root',
        targetEvent: {
          getSender: () => '@bas:mindroom.chat',
          getContent: () => ({}),
        } as MatrixEvent,
        canSendReaction: true,
        relations: relations as never,
        onReactionToggle,
      })
    );

    const button = renderer.root.findByType('button');
    expect(button.props.onClick).toBeUndefined();

    act(() => {
      button.props.onClick?.();
    });

    expect(onReactionToggle).not.toHaveBeenCalled();
  });

  it('ignores redacted reaction shells when rendering counts', () => {
    const relations = new MockRelations([
      [
        '🛑',
        new Set([
          {
            getSender: () => '@bas:mindroom.chat',
            getTs: () => 0,
            getRelation: () => ({ rel_type: 'm.annotation' }),
            isRedacted: () => true,
          } as MatrixEvent,
          {
            getSender: () => '@someone:mindroom.chat',
            getTs: () => 0,
            getRelation: () => ({ rel_type: 'm.annotation' }),
            isRedacted: () => false,
          } as MatrixEvent,
        ]),
      ],
    ]);

    render(
      React.createElement(Reactions, {
        room: {} as never,
        mEventId: '$event',
        targetEvent: {
          getSender: () => '@bas:mindroom.chat',
          getContent: () => ({}),
        } as MatrixEvent,
        canSendReaction: true,
        relations: relations as never,
        onReactionToggle: vi.fn(),
      })
    );

    expect(reactionRenderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reaction: '🛑',
        count: 1,
      })
    );
  });

  it('hides a stale stop chip once the target message proves a terminal stream', () => {
    const relations = new MockRelations([
      [
        '🛑',
        new Set([
          {
            getSender: () => '@agent:mindroom.chat',
            getTs: () => 0,
            getRelation: () => ({ rel_type: 'm.annotation' }),
            isRedacted: () => false,
          } as MatrixEvent,
        ]),
      ],
      [
        '👍',
        new Set([
          {
            getSender: () => '@bas:mindroom.chat',
            getTs: () => 0,
            getRelation: () => ({ rel_type: 'm.annotation' }),
            isRedacted: () => false,
          } as MatrixEvent,
        ]),
      ],
    ]);
    const targetEvent = {
      getSender: () => '@agent:mindroom.chat',
      getContent: () => ({ 'io.mindroom.stream_status': 'completed' }),
    } as MatrixEvent;

    render(
      React.createElement(Reactions, {
        room: {} as never,
        mEventId: '$event',
        targetEvent,
        canSendReaction: true,
        relations: relations as never,
        onReactionToggle: vi.fn(),
      })
    );

    expect(reactionRenderSpy).not.toHaveBeenCalledWith(expect.objectContaining({ reaction: '🛑' }));
    expect(reactionRenderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reaction: '👍', count: 1 })
    );
  });

  it.each([
    ["hides the option chips of a MindRoom agent's question, whose card shows them", false],
    ['keeps them where a client plugin renders the message instead of the card', true],
  ])('%s', (_, pluginRenders) => {
    useMessageRenderer.mockReturnValue(pluginRenders ? { id: 'poll', tag: 'poll' } : undefined);
    const chip = (sender: string) =>
      new Set([
        {
          getSender: () => sender,
          getTs: () => 0,
          getRelation: () => ({ rel_type: 'm.annotation' }),
          isRedacted: () => false,
        } as MatrixEvent,
      ]);
    const relations = new MockRelations([
      ['🔴', chip('@mindroom_code:mindroom.chat')],
      ['👍', chip('@bas:mindroom.chat')],
    ]);
    const content = {
      'io.mindroom.interactive': {
        question_text: 'Which color?',
        options: { '🔴': 'red', '1': 'red' },
        option_labels: { '🔴': 'Red', '1': 'Red' },
      },
    };
    const targetEvent = {
      getId: () => '$event',
      getType: () => 'm.room.message',
      getSender: () => '@mindroom_code:mindroom.chat',
      getContent: () => content,
      getOriginalContent: () => content,
    } as unknown as MatrixEvent;

    render(
      React.createElement(Reactions, {
        room: { roomId: '!room:mindroom.chat' } as never,
        mEventId: '$event',
        targetEvent,
        canSendReaction: true,
        relations: relations as never,
        onReactionToggle: vi.fn(),
      })
    );

    expect(useMessageRenderer).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventId: '$event', sender: '@mindroom_code:mindroom.chat' }),
      '@bas:mindroom.chat'
    );
    expect(reactionRenderSpy.mock.calls.some(([call]) => call.reaction === '🔴')).toBe(
      pluginRenders
    );
    expect(reactionRenderSpy).toHaveBeenCalledWith(expect.objectContaining({ reaction: '👍' }));
  });

  it.each([
    ["names the agent's stop button Stop reply", '@agent:mindroom.chat', 'Stop reply', true],
    ["counts another person's stop reaction", '@alice:mindroom.chat', undefined, false],
  ])('%s while the target message is still streaming', (_, sender, name, resend) => {
    const relations = stops([sender]);
    const onReactionToggle = vi.fn();
    const renderer = render(
      React.createElement(Reactions, stopProps(relations, streamingReply(), onReactionToggle))
    );

    expect(renderer.root.findByType('button').props['aria-label']).toBe(name);
    act(() => {
      renderer.root.findByType('button').props.onClick();
    });
    expect(onReactionToggle).toHaveBeenCalledWith('$event', '🛑', undefined, relations, resend);
  });

  it('reads Stopping… from the press on, keeping its name, its size and the keyboard', async () => {
    let finish!: (sent: boolean) => void;
    const onReactionToggle = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const target = streamingReply();
    // A Stop on a regenerated reply first takes back the viewer's stop of the earlier run.
    const view = (who: string[]) => stopProps(stops(who), target, onReactionToggle);
    const renderer = render(React.createElement(Reactions, view([AGENT, VIEWER])));
    expect(shownLabel(renderer)).toBe('Stop reply');
    expect(status(renderer)).toBe('');
    act(() => {
      stopChip(renderer).props.onClick();
    });

    const chip = () => stopChip(renderer);
    expect(shownLabel(renderer)).toBe('Stopping…');
    // Both labels stay in the chip, one hidden, so it keeps the wider one's size.
    expect(renderer.root.findAll((node) => node.props['aria-hidden'] === true)).toHaveLength(1);
    expect(chip().props).toMatchObject({ 'aria-label': 'Stop reply', 'aria-disabled': true });
    expect(chip().props.disabled).toBe(false);
    expect(chip().props['aria-pressed']).toBeUndefined();
    expect(status(renderer)).toBe('Stopping…');

    // Sync drops the earlier stop while its redaction is pending: still Stopping…, and a second
    // press sends nothing more.
    act(() => renderer.update(React.createElement(Reactions, view([AGENT]))));
    expect(shownLabel(renderer)).toBe('Stopping…');
    act(() => {
      chip().props.onClick?.();
    });
    expect(onReactionToggle).toHaveBeenCalledTimes(1);

    // Sent, it stays Stopping… until the agent's 🛑 goes.
    await act(async () => finish(true));
    act(() => renderer.update(React.createElement(Reactions, view([AGENT, VIEWER]))));
    expect(shownLabel(renderer)).toBe('Stopping…');
  });

  it("makes Stop pressable again when taking back the earlier run's stop is refused", async () => {
    const onReactionToggle = vi.fn(async () => false);
    // The refused redaction leaves the earlier stop in place.
    const props = stopProps(stops([AGENT, VIEWER]), streamingReply(), onReactionToggle);
    const renderer = render(React.createElement(Reactions, props));
    await act(async () => stopChip(renderer).props.onClick());

    expect(shownLabel(renderer)).toBe('Stop reply');
    expect(status(renderer)).toBe('');
    expect(stopChip(renderer).props['aria-disabled']).toBeUndefined();
    await act(async () => stopChip(renderer).props.onClick());
    expect(onReactionToggle).toHaveBeenCalledTimes(2);
  });

  it("keeps a newer run's Stopping… when an earlier run's stop fails late", async () => {
    let finishFirst: (sent: boolean) => void = () => {};
    const onReactionToggle = vi
      .fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (finishFirst = resolve)))
      .mockImplementation(() => new Promise<boolean>(() => {}));
    const view = (who: [string, string][]) =>
      stopProps(
        new MockRelations([['🛑', new Set(who.map(([s, id]) => reaction(s, id)))]]),
        streamingReply(),
        onReactionToggle
      );
    const renderer = render(React.createElement(Reactions, view([[AGENT, '$stop1']])));
    act(() => {
      stopChip(renderer).props.onClick();
    });
    // A new run brings a new 🛑 before the first stop settles; the viewer presses its Stop.
    act(() => renderer.update(React.createElement(Reactions, view([[AGENT, '$stop2']]))));
    act(() => {
      stopChip(renderer).props.onClick();
    });
    expect(shownLabel(renderer)).toBe('Stopping…');

    // The first run's stop fails now: the second run's Stop stays pending and takes no press.
    await act(async () => finishFirst(false));
    expect(shownLabel(renderer)).toBe('Stopping…');
    act(() => {
      stopChip(renderer).props.onClick?.();
    });
    expect(onReactionToggle).toHaveBeenCalledTimes(2);
  });

  it('stops a later run of the same reply again, after a reload too', () => {
    const onReactionToggle = vi.fn();
    let content: Record<string, unknown> = { 'io.mindroom.stream_status': 'streaming' };
    const target = { getSender: () => AGENT, getContent: () => content } as MatrixEvent;
    const view = (who: [string, string][]) =>
      stopProps(
        new MockRelations([['🛑', new Set(who.map(([s, id]) => reaction(s, id)))]]),
        target,
        onReactionToggle
      );
    const firstRun = view([[AGENT, '$stop1']]);
    const renderer = render(React.createElement(Reactions, firstRun));
    act(() => {
      stopChip(renderer).props.onClick();
    });
    act(() =>
      renderer.update(
        React.createElement(
          Reactions,
          view([
            [AGENT, '$stop1'],
            [VIEWER, '$mine'],
          ])
        )
      )
    );
    expect(shownLabel(renderer)).toBe('Stopping…');

    // The run ends; an edit of the message it answers regenerates the same reply, with a new 🛑.
    content = { 'io.mindroom.stream_status': 'cancelled' };
    act(() => renderer.update(React.createElement(Reactions, view([[VIEWER, '$mine']]))));
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
    content = { 'io.mindroom.stream_status': 'streaming' };
    const secondRun = view([
      [VIEWER, '$mine'],
      [AGENT, '$stop2'],
    ]);
    act(() => renderer.update(React.createElement(Reactions, secondRun)));
    expect(shownLabel(renderer)).toBe('Stop reply');
    act(() => {
      stopChip(renderer).props.onClick();
    });
    expect(onReactionToggle).toHaveBeenLastCalledWith(
      '$event',
      '🛑',
      undefined,
      secondRun.relations,
      true
    );
    expect(shownLabel(renderer)).toBe('Stopping…');

    // A reload forgets the press, and the earlier run's stop does not count for this run.
    const reloaded = render(React.createElement(Reactions, secondRun));
    expect(shownLabel(reloaded)).toBe('Stop reply');
    expect(stopChip(reloaded).props['aria-disabled']).toBeUndefined();
  });

  it('drops the stop chip once the target finishes streaming in place', () => {
    const relations = stops([AGENT]);
    let content: Record<string, unknown> = { 'io.mindroom.stream_status': 'streaming' };
    const targetEvent = {
      getSender: () => '@agent:mindroom.chat',
      getContent: () => content,
    } as MatrixEvent;
    const props = {
      room: {} as never,
      mEventId: '$event',
      targetEvent,
      canSendReaction: true,
      relations: relations as never,
      onReactionToggle: vi.fn(),
    };
    const renderer = render(React.createElement(Reactions, props));
    expect(renderer.root.findAllByType('button')).toHaveLength(1);

    content = { 'io.mindroom.stream_status': 'completed' };
    act(() => {
      renderer.update(React.createElement(Reactions, props));
    });
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
  });
});
