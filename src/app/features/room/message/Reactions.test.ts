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
    TooltipProvider: ({ children }: { children: (ref: null) => React.ReactNode }) =>
      children(null),
    as:
      <T extends React.ElementType, P>(component: React.ForwardRefRenderFunction<any, P>) =>
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
});
