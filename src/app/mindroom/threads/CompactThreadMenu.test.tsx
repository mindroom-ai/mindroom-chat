import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompactThreadMenu } from './CompactThreadMenu';
import type { CompactThreadCardViewModel } from './types';

vi.mock('./ThreadContextBanner.css', () => ({
  TagPickerInput: 'input',
  TagPickerInputContainer: 'container',
}));
vi.mock('../../styles/Motion.css', () => ({
  motion: { duration: { Normal: '0ms', Fast: '0ms' }, easing: { Standard: 'linear' } },
}));

const state = vi.hoisted(() => ({
  tags: { displayTags: ['triage'], availableTags: ['urgent'], canEdit: true, isResolved: false },
  mutations: {
    addTag: vi.fn(),
    removeTag: vi.fn(),
    setResolved: vi.fn(),
    updating: false,
    error: null,
  },
  pinning: {
    pinnedEventIds: [] as string[],
    canPin: true,
    setPinned: vi.fn(),
    updating: false,
    error: null,
  },
  save: vi.fn(),
  regenerate: vi.fn(),
  copy: vi.fn(),
  canSend: true,
}));
vi.mock('./useThreadTags', () => ({ useThreadTags: () => state.tags }));
vi.mock('./useMutateThreadTags', () => ({ useMutateThreadTags: () => state.mutations }));
vi.mock('./useThreadPinning', () => ({ useThreadPinning: () => state.pinning }));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:test' }),
}));
vi.mock('../../hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../../hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ event: () => state.canSend }),
}));
vi.mock('../../hooks/useRoomMembers', () => ({
  useRoomMembers: () => [
    { userId: '@mindroom_helper:test', name: 'Helper', membership: 'join' },
    { userId: '@mindroom_left:test', name: 'Left', membership: 'leave' },
  ],
}));
vi.mock('./threadSummaryActions', async (original) => ({
  ...(await original<typeof import('./threadSummaryActions')>()),
  saveThreadSummary: state.save,
  requestThreadSummary: state.regenerate,
}));
vi.mock('../../utils/dom', () => ({ copyToClipboard: state.copy }));
vi.mock('../../plugins/via-servers', () => ({ getViaServers: () => ['test'] }));
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  PopOut: ({ content }: { content: React.ReactNode }) => content,
  Overlay: ({ children }: { children: React.ReactNode }) => children,
  OverlayCenter: 'div',
  OverlayBackdrop: 'div',
  Box: 'div',
  Text: 'span',
  Button: 'button',
}));
vi.mock('../../components/glass/GlassPrimitives', () => ({
  Menu: 'div',
  MenuItem: 'button',
  Dialog: 'div',
}));

const viewModel = {
  id: { roomId: '!room:test', threadRootId: '$root' },
  primarySummaryText: 'Old summary',
  titleText: 'Old summary',
  participants: [],
} as unknown as CompactThreadCardViewModel;
const render = () =>
  create(
    <CompactThreadMenu
      room={{ roomId: '!room:test', getMyMembership: () => 'join' } as never}
      viewModel={viewModel}
      anchor={{ x: 10, y: 20, width: 0, height: 0 }}
      onClose={vi.fn()}
      onOpenThread={vi.fn()}
    />
  );
const click = (renderer: ReturnType<typeof create>, label: string) =>
  act(() => {
    renderer.root
      .findAllByType('button')
      .find((node) => node.props['data-thread-action'] === label)!
      .props.onClick();
  });

describe('CompactThreadMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.tags.canEdit = true;
    state.tags.isResolved = false;
    state.pinning.pinnedEventIds = [];
    state.pinning.canPin = true;
    state.canSend = true;
    state.save.mockResolvedValue(undefined);
    state.copy.mockResolvedValue(true);
  });

  it('resolves or reopens the selected thread and suppresses resolve while pinned', () => {
    let renderer = render();
    click(renderer, 'resolve');
    expect(state.mutations.setResolved).toHaveBeenCalledWith('$root', true);
    renderer.unmount();
    state.tags.isResolved = true;
    renderer = render();
    click(renderer, 'resolve');
    expect(state.mutations.setResolved).toHaveBeenLastCalledWith('$root', false);
    renderer.unmount();
    state.pinning.pinnedEventIds = ['$root'];
    renderer = render();
    expect(renderer.root.findAllByProps({ 'data-thread-action': 'resolve' })).toHaveLength(0);
    renderer.unmount();
  });

  it('hides mutations without permissions but leaves navigation and link copying', () => {
    state.tags.canEdit = false;
    state.pinning.canPin = false;
    state.canSend = false;
    const renderer = render();
    const actions = renderer.root
      .findAllByType('button')
      .map((node) => node.props['data-thread-action']);
    expect(actions).toEqual(['open', 'copy']);
    renderer.unmount();
  });

  it('keeps a failed summary draft open and saves successfully on retry', async () => {
    state.save.mockRejectedValueOnce(new Error('Offline'));
    const renderer = render();
    click(renderer, 'editSummary');
    const input = renderer.root.findByType('textarea');
    expect(input.props.value).toBe('Old summary');
    act(() => input.props.onChange({ target: { value: 'My new summary' } }));
    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });
    expect(state.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '$root',
      'My new summary'
    );
    expect(renderer.root.findByType('textarea').props.value).toBe('My new summary');
    expect(renderer.root.findAllByProps({ role: 'alert' }).length).toBeGreaterThan(0);
    renderer.unmount();
  });

  it('lets the user choose a joined agent before sending a regeneration request', async () => {
    const renderer = render();
    click(renderer, 'regenerate');
    expect(state.regenerate).not.toHaveBeenCalled();
    const options = renderer.root.findAllByType('option').map((node) => node.props.value);
    expect(options).toContain('@mindroom_helper:test');
    expect(options).not.toContain('@mindroom_left:test');
    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });
    expect(state.regenerate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '$root',
      '@mindroom_helper:test'
    );
    renderer.unmount();
  });
});
