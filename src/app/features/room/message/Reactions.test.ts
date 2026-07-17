import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Reactions } from './Reactions';

const { reactionRenderSpy } = vi.hoisted(() => ({
  reactionRenderSpy: vi.fn(),
}));

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

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@bas:mindroom.chat',
  }),
}));

vi.mock('../../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => true,
}));

vi.mock('../../../components/message', () => ({
  ReactionTooltipMsg: () => null,
  Reaction: ({
    reaction,
    count,
    onClick,
    ...props
  }: {
    reaction: string;
    count: number;
    onClick?: () => void;
  }) => {
    reactionRenderSpy({ reaction, count, props });
    return React.createElement(
      'button',
      {
        type: 'button',
        onClick,
      },
      `${reaction} ${count}`
    );
  },
}));

vi.mock('../reaction-viewer', () => ({
  ReactionViewer: () => null,
}));

vi.mock('./styles.css', () => ({
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
              getId: () => '$reaction',
              getSender: () => '@bas:mindroom.chat',
              getRelation: () => ({ rel_type: 'm.annotation' }),
              isRedacted: () => false,
            } as MatrixEvent,
          ]),
        ],
      ] as [string, Set<MatrixEvent>][])
    );
  }
}

describe('Reactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the rendered relations object back on toggle', () => {
    const relations = new MockRelations();
    const onReactionToggle = vi.fn();

    const renderer = create(
      React.createElement(Reactions, {
        room: {} as never,
        mEventId: '$event',
        targetEvent: { getContent: () => ({}) } as MatrixEvent,
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

  it('ignores redacted reaction shells when rendering counts', () => {
    const relations = new MockRelations([
      [
        '🛑',
        new Set([
          {
            getId: () => '$redacted-stop',
            getSender: () => '@bas:mindroom.chat',
            getRelation: () => ({ rel_type: 'm.annotation' }),
            isRedacted: () => true,
          } as MatrixEvent,
          {
            getSender: () => '@someone:mindroom.chat',
            getRelation: () => ({ rel_type: 'm.annotation' }),
            isRedacted: () => false,
          } as MatrixEvent,
        ]),
      ],
    ]);

    create(
      React.createElement(Reactions, {
        room: {} as never,
        mEventId: '$event',
        targetEvent: { getContent: () => ({}) } as MatrixEvent,
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
            getRelation: () => ({ rel_type: 'm.annotation' }),
            isRedacted: () => false,
          } as MatrixEvent,
        ]),
      ],
      [
        '👍',
        new Set([
          {
            getId: () => '$thumbs-up',
            getSender: () => '@bas:mindroom.chat',
            getRelation: () => ({ rel_type: 'm.annotation' }),
            isRedacted: () => false,
          } as MatrixEvent,
        ]),
      ],
    ]);
    const targetEvent = {
      getContent: () => ({ 'io.mindroom.stream_status': 'completed' }),
    } as MatrixEvent;

    create(
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

  it('keeps the stop chip while the target message is still streaming', () => {
    const relations = new MockRelations([
      [
        '🛑',
        new Set([
          {
            getSender: () => '@agent:mindroom.chat',
            getRelation: () => ({ rel_type: 'm.annotation' }),
            isRedacted: () => false,
          } as MatrixEvent,
        ]),
      ],
    ]);
    const targetEvent = {
      getContent: () => ({ 'io.mindroom.stream_status': 'streaming' }),
    } as MatrixEvent;

    create(
      React.createElement(Reactions, {
        room: {} as never,
        mEventId: '$event',
        targetEvent,
        canSendReaction: true,
        relations: relations as never,
        onReactionToggle: vi.fn(),
      })
    );

    expect(reactionRenderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reaction: '🛑', count: 1 })
    );
  });

  it('keeps pending-target reaction chips read-only until the event id confirms', () => {
    const relations = new MockRelations();
    const onReactionToggle = vi.fn();

    const renderer = create(
      React.createElement(Reactions, {
        room: {} as never,
        mEventId: '~!room:example.org:txn-root',
        targetEvent: { getContent: () => ({}) } as MatrixEvent,
        canSendReaction: true,
        relations: relations as never,
        onReactionToggle,
      })
    );

    const button = renderer.root.findByType('button');

    expect(button.props.onClick).toBeUndefined();
    expect(reactionRenderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          'aria-disabled': true,
          onContextMenu: expect.any(Function),
        }),
      })
    );
    expect(onReactionToggle).not.toHaveBeenCalled();
  });

  it('keeps a pending own reaction read-only until its redaction target confirms', () => {
    const relations = new MockRelations([
      [
        '👍',
        new Set([
          {
            getId: () => '~!room:example.org:txn-reaction',
            getSender: () => '@bas:mindroom.chat',
            getRelation: () => ({ rel_type: 'm.annotation' }),
            isRedacted: () => false,
          } as MatrixEvent,
        ]),
      ],
    ]);
    const onReactionToggle = vi.fn();

    const renderer = create(
      React.createElement(Reactions, {
        room: {} as never,
        mEventId: '$confirmed-root',
        targetEvent: { getContent: () => ({}) } as MatrixEvent,
        canSendReaction: true,
        relations: relations as never,
        onReactionToggle,
      })
    );

    expect(renderer.root.findByType('button').props.onClick).toBeUndefined();
    expect(reactionRenderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          'aria-disabled': true,
          'aria-pressed': true,
        }),
      })
    );
    expect(onReactionToggle).not.toHaveBeenCalled();
  });
});
