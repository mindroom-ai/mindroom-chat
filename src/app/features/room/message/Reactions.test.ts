import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk';
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

const makeTargetEvent = (content: Record<string, unknown>): MatrixEvent =>
  new MatrixEvent({
    event_id: '$event',
    room_id: '!room:mindroom.chat',
    sender: '@agent:mindroom.chat',
    type: 'm.room.message',
    origin_server_ts: 1,
    content,
  });

const replaceTargetEventContent = (
  targetEvent: MatrixEvent,
  content: Record<string, unknown>
): void => {
  targetEvent.makeReplaced(
    new MatrixEvent({
      event_id: '$edit',
      room_id: '!room:mindroom.chat',
      sender: '@agent:mindroom.chat',
      type: 'm.room.message',
      origin_server_ts: 2,
      content: {
        'm.new_content': content,
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: targetEvent.getId(),
        },
      },
    })
  );
};

const makeReactionEvent = (sender = '@agent:mindroom.chat', isRedacted = false): MatrixEvent =>
  ({
    getSender: () => sender,
    getRelation: () => ({ rel_type: 'm.annotation' }),
    isRedacted: () => isRedacted,
  } as MatrixEvent);

const renderReactions = (relations: MockRelations, targetEvent: MatrixEvent) =>
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
        targetEvent: makeTargetEvent({}),
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
          makeReactionEvent('@bas:mindroom.chat', true),
          makeReactionEvent('@someone:mindroom.chat'),
        ]),
      ],
    ]);

    create(
      React.createElement(Reactions, {
        room: {} as never,
        mEventId: '$event',
        targetEvent: makeTargetEvent({}),
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
      ['🛑', new Set([makeReactionEvent()])],
      ['👍', new Set([makeReactionEvent('@bas:mindroom.chat')])],
    ]);
    const targetEvent = makeTargetEvent({ 'io.mindroom.stream_status': 'completed' });

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
    const relations = new MockRelations([['🛑', new Set([makeReactionEvent()])]]);
    const targetEvent = makeTargetEvent({ 'io.mindroom.stream_status': 'streaming' });

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

  it('recomputes a stale-only chip when the same target event becomes terminal', () => {
    const relations = new MockRelations([['🛑', new Set([makeReactionEvent()])]]);
    const targetEvent = makeTargetEvent({ 'io.mindroom.stream_status': 'streaming' });
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderReactions(relations, targetEvent);
    });
    expect(renderer!.root.findAllByType('button')).toHaveLength(1);

    act(() => {
      replaceTargetEventContent(targetEvent, { 'io.mindroom.stream_status': 'completed' });
    });

    expect(renderer!.toJSON()).toBeNull();
  });

  it('removes only the stale stop chip from mixed reactions after an in-place edit', () => {
    const relations = new MockRelations([
      ['🛑', new Set([makeReactionEvent()])],
      ['👍', new Set([makeReactionEvent('@bas:mindroom.chat')])],
    ]);
    const targetEvent = makeTargetEvent({ 'io.mindroom.stream_status': 'streaming' });
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = renderReactions(relations, targetEvent);
    });
    expect(
      renderer!.root.findAllByType('button').map((button) => button.children.join(''))
    ).toEqual(['🛑 1', '👍 1']);

    act(() => {
      replaceTargetEventContent(targetEvent, { 'io.mindroom.stream_status': 'completed' });
    });

    expect(
      renderer!.root.findAllByType('button').map((button) => button.children.join(''))
    ).toEqual(['👍 1']);
  });

  it('keeps ordinary reactions on a terminal target', () => {
    const relations = new MockRelations([
      ['👍', new Set([makeReactionEvent('@bas:mindroom.chat')])],
    ]);

    const renderer = renderReactions(
      relations,
      makeTargetEvent({ 'io.mindroom.stream_status': 'completed' })
    );

    expect(renderer.root.findAllByType('button').map((button) => button.children.join(''))).toEqual(
      ['👍 1']
    );
  });
});
