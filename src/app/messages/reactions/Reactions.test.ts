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
      {
        type: 'button',
        onClick,
      },
      `${reaction} ${label ?? count}`
    );
  },
}));

vi.mock('./ReactionViewer', () => ({
  ReactionViewer: () => null,
}));

vi.mock('../styles.css', () => ({
  ReactionsContainer: 'ReactionsContainer',
  ReactionsTooltipText: 'ReactionsTooltipText',
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

    expect(onReactionToggle).toHaveBeenCalledWith('$event', '🔄', undefined, relations);
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
    ["labels the agent's stop button", '@agent:mindroom.chat', 'Stop'],
    ["counts a person's stop reaction", '@bas:mindroom.chat', undefined],
  ])('%s while the target message is still streaming', (_, sender, label) => {
    const relations = new MockRelations([
      [
        '🛑',
        new Set([
          {
            getSender: () => sender,
            getTs: () => 0,
            getRelation: () => ({ rel_type: 'm.annotation' }),
            isRedacted: () => false,
          } as MatrixEvent,
        ]),
      ],
    ]);
    const targetEvent = {
      getSender: () => '@agent:mindroom.chat',
      getContent: () => ({ 'io.mindroom.stream_status': 'streaming' }),
    } as MatrixEvent;
    const onReactionToggle = vi.fn();

    const renderer = render(
      React.createElement(Reactions, {
        room: {} as never,
        mEventId: '$event',
        targetEvent,
        canSendReaction: true,
        relations: relations as never,
        onReactionToggle,
      })
    );

    expect(reactionRenderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reaction: '🛑', count: 1, label })
    );
    act(() => {
      renderer.root.findByType('button').props.onClick();
    });
    expect(onReactionToggle).toHaveBeenCalledWith('$event', '🛑', undefined, relations);
  });

  it('drops the stop chip once the target finishes streaming in place', () => {
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
    ]);
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
