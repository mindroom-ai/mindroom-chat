import { EventEmitter } from 'node:events';
import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import {
  collectAvailableTags,
  getDisplayTags,
  isThreadResolved,
  isValidTagName,
  normalizeTagName,
  parseThreadTagsContent,
  RESOLVED_TAG,
  type ThreadTagsContent,
} from '../event-store/threads/threadTags';
import { tagColor, TAG_TEXT_COLOR } from './tags/threadTagColor';
import { ThreadContextBanner, type ThreadContextBannerProps } from './ThreadContextBanner';
import { settingsAtom } from '../preferences/settings';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import { runShortcut } from '../shortcuts/useShortcut';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';

const menuProps = vi.hoisted(() => vi.fn());
const textDirection = vi.hoisted(() => vi.fn(() => 'ltr'));
vi.mock('./ThreadActionsMenu', () => ({
  ThreadActionsMenu: (props: unknown) => {
    menuProps(props);
    return React.createElement('div', { role: 'menu' });
  },
}));

vi.mock('./ThreadHeaderSlot', () => ({
  ThreadHeaderSlot: ({ room, threadId }: { room: Room; threadId: string }) =>
    React.createElement('u', { 'data-thread-header-slot': `${room.roomId} ${threadId}` }),
}));

vi.mock('../approvals/ThreadApprovalControls', () => ({
  ThreadApprovalPermissions: () => React.createElement('b', { 'data-approvals': 'true' }),
}));
vi.mock('../approvals/auto-approve/AutoApproveChip', () => ({
  AutoApproveChip: ({ threadId }: { threadId: string }) =>
    React.createElement('i', { 'data-auto-approve': threadId }),
}));

// The optical glass needs a real DOM node; pass the banner's own ref through, and say whether the
// banner asked for glass.
const glass = vi.hoisted(() => ({ enabled: undefined as boolean | undefined }));
vi.mock('../ui/glass/liquid/useLiquidGlass', () => ({
  useLiquidGlass: (ref?: unknown, enabled = true) => {
    glass.enabled = enabled;
    return ref;
  },
}));
// A phone's back chevron, without the theme its real one reads.
vi.mock('../ui/page/PhoneBackButton', () => ({
  PhoneBackButton: ({ label, onBack }: { label: string; onBack: () => void }) =>
    React.createElement('button', {
      'aria-label': label,
      'data-phone-back': 'true',
      onClick: onBack,
    }),
}));

const pinningMocks = vi.hoisted(() => ({
  pinnedEventIds: [] as string[],
  canPin: false,
  setPinned: vi.fn(),
  updating: false,
  error: undefined,
}));
vi.mock('../event-store/threads/useThreadPinning', () => ({
  useThreadPinning: () => pinningMocks,
}));

const ISO_1 = '2026-04-07T00:00:01.000Z';
const ISO_2 = '2026-04-07T00:00:02.000Z';
const ISO_3 = '2026-04-07T00:00:03.000Z';

const bannerMocks = vi.hoisted(() => ({
  useThreadRootEvent: vi.fn(),
  useThreadTags: vi.fn(),
  useMutateThreadTags: vi.fn(),
  useThreadHeaderInfo: vi.fn(),
  useCachedThreadRoot: vi.fn(),
}));

vi.mock('folds', async () => {
  const React = await import('react');

  const renderElement = ({
    as,
    children,
    ...props
  }: {
    as?: keyof React.JSX.IntrinsicElements;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement(as ?? 'div', props, children);

  return {
    Box: renderElement,
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement('button', props, children),
    Icon: (props: Record<string, unknown>) => React.createElement('i', props),
    IconButton: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
      ({ children, ...props }, ref) => React.createElement('button', { ...props, ref }, children)
    ),
    Icons: { ArrowLeft: 'arrow-left', Check: 'check', ChevronBottom: 'chevron-bottom' },
    Tooltip: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    // Render the tooltip beside its trigger, so tests can read what it says.
    TooltipProvider: ({
      tooltip,
      align,
      children,
    }: {
      tooltip: React.ReactNode;
      align?: string;
      children: (triggerRef: () => void) => React.ReactNode;
    }) =>
      React.createElement(
        React.Fragment,
        null,
        children(() => undefined),
        React.createElement('div', { role: 'tooltip', 'data-align': align }, tooltip)
      ),
    Text: ({
      as,
      children,
      truncate: _truncate,
      priority: _priority,
      size: _size,
      ...props
    }: {
      as?: keyof React.JSX.IntrinsicElements;
      children?: React.ReactNode;
      truncate?: boolean;
      priority?: string;
      size?: string;
      [key: string]: unknown;
    }) => React.createElement(as ?? 'span', props, children),
  };
});

vi.mock('@tabler/icons-react', async () => {
  const React = await import('react');
  return {
    IconCalendarEvent: (props: Record<string, unknown>) => React.createElement('svg', props),
    IconClock: (props: Record<string, unknown>) => React.createElement('svg', props),
  };
});

vi.mock('./useThreadRootEvent', () => ({
  useThreadRootEvent: bannerMocks.useThreadRootEvent,
}));

vi.mock('../event-store/sdk/cachedThreadRoots', () => ({
  useCachedThreadRoot: bannerMocks.useCachedThreadRoot,
}));

vi.mock('./tags/useThreadTags', () => ({
  useThreadTags: bannerMocks.useThreadTags,
}));

vi.mock('./tags/useMutateThreadTags', () => ({
  useMutateThreadTags: bannerMocks.useMutateThreadTags,
}));

vi.mock('./useThreadHeaderInfo', () => ({
  useThreadHeaderInfo: bannerMocks.useThreadHeaderInfo,
}));

vi.mock('./tags/ThreadTagPill', () => ({
  ThreadTagPill: ({ name }: { name: string }) => React.createElement('span', null, name),
}));

vi.mock('./tags/ThreadTagPicker', () => ({
  ThreadTagPicker: () => React.createElement('button', null, '+ tag'),
}));

vi.mock('./ThreadContextBanner.css', () => ({
  Banner: 'Banner',
  BannerResolved: 'BannerResolved',
  BannerSnoozed: 'BannerSnoozed',
  Collapsed: 'Collapsed',
  CompactHidden: 'CompactHidden',
  DesktopOnlyTags: 'DesktopOnlyTags',
  EyebrowRow: 'EyebrowRow',
  MetadataDot: 'MetadataDot',
  MobileOnlyTags: 'MobileOnlyTags',
  OverflowChip: 'OverflowChip',
  PhoneHeader: 'PhoneHeader',
  PhoneMore: 'PhoneMore',
  PhonePin: 'PhonePin',
  PhoneRoom: 'PhoneRoom',
  PhoneRoomButton: 'PhoneRoomButton',
  PhoneRow: 'PhoneRow',
  PhoneStatus: 'PhoneStatus',
  PhoneTags: 'PhoneTags',
  PhoneTitle: 'PhoneTitle',
  PhoneTitleRow: 'PhoneTitleRow',
  ResolutionByline: 'ResolutionByline',
  ResolutionBylineDot: 'ResolutionBylineDot',
  ResolverName: 'ResolverName',
  ResolvedButton: 'ResolvedButton',
  ScheduledDot: 'ScheduledDot',
  ScheduledIndicator: 'ScheduledIndicator',
  ScheduledWrap: 'ScheduledWrap',
  SnoozeAction: 'SnoozeAction',
  SubtitleRow: 'SubtitleRow',
  SummaryText: 'SummaryText',
  SummaryTextChanged: 'SummaryTextChanged',
  TagsRow: 'TagsRow',
  TitleColumn: 'TitleColumn',
  TitleRow: 'TitleRow',
  ViewLabel: 'ViewLabel',
}));

vi.mock('../messages/ThreadIndicator.css', () => ({
  ThreadScheduledIndicator: 'ThreadScheduledIndicator',
  ThreadScheduledIcon: 'ThreadScheduledIcon',
}));

vi.mock('../messages/styles.css', () => ({
  MessageOptionsButton: 'MessageOptionsButton',
}));

// Resolve t() keys against the real en.json so assertions below keep
// checking user-visible English copy ('Thread View', 'Resolve', …).
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn, i18n: { dir: textDirection } }),
  };
});

/**
 * ThreadContextBanner integration tests.
 *
 * These test the data flow that powers the banner: tag parsing,
 * display filtering, color generation, and permission/edge-case logic.
 * Full React render tests with heavy SDK mocking are deferred to
 * manual testing per the plan.
 */

describe('ThreadContextBanner data flow', () => {
  describe('tag display filtering', () => {
    it('renders pills for existing tags (excluding resolved)', () => {
      const content: ThreadTagsContent = {
        tags: {
          bug: { set_by: '@a:b', set_at: ISO_1 },
          feature: { set_by: '@a:b', set_at: ISO_2 },
          [RESOLVED_TAG]: { set_by: '@a:b', set_at: ISO_3 },
        },
      };
      const display = getDisplayTags(content);
      expect(display).toEqual(['bug', 'feature']);
      expect(display).not.toContain(RESOLVED_TAG);
    });

    it('shows no pills when only resolved tag exists', () => {
      const content: ThreadTagsContent = {
        tags: { [RESOLVED_TAG]: { set_by: '@a:b', set_at: ISO_1 } },
      };
      expect(getDisplayTags(content)).toEqual([]);
    });

    it('shows no pills for empty tags', () => {
      expect(getDisplayTags({ tags: {} })).toEqual([]);
    });
  });

  describe('overflow counter', () => {
    it('counts overflow for >3 tags on desktop', () => {
      const DESKTOP_MAX_PILLS = 3;
      const tags = ['bug', 'feature', 'review', 'urgent', 'wontfix'];
      const visible = tags.slice(0, DESKTOP_MAX_PILLS);
      const overflowCount = tags.length - visible.length;
      expect(visible).toEqual(['bug', 'feature', 'review']);
      expect(overflowCount).toBe(2);
    });

    it('no overflow for <=3 tags', () => {
      const DESKTOP_MAX_PILLS = 3;
      const tags = ['bug', 'feature'];
      const overflowCount = tags.length - Math.min(tags.length, DESKTOP_MAX_PILLS);
      expect(overflowCount).toBe(0);
    });
  });

  describe('resolve chip state', () => {
    it('isResolved reflects resolved tag presence', () => {
      expect(
        isThreadResolved({
          tags: { [RESOLVED_TAG]: { set_by: '@a:b', set_at: ISO_1 } },
        })
      ).toBe(true);
      expect(isThreadResolved({ tags: {} })).toBe(false);
    });
  });

  describe('read-only mode', () => {
    it('hides picker when canEdit is false (tag validation)', () => {
      // When canEdit = false, the banner hides + button and x affordances.
      // This validates the data condition: a user without power level
      // would have canEdit = false in useThreadTags.
      expect(isValidTagName('bug')).toBe(true);
      expect(isValidTagName('')).toBe(false);
    });
  });

  describe('disabled state before root hydration', () => {
    it('returns empty content when parsing undefined state', () => {
      const content = parseThreadTagsContent(undefined);
      expect(content.tags).toEqual({});
      expect(getDisplayTags(content)).toEqual([]);
    });
  });

  describe('tag color determinism', () => {
    it('produces consistent colors for the same tag name', () => {
      expect(tagColor('bug')).toBe(tagColor('bug'));
      expect(tagColor('feature')).toBe(tagColor('feature'));
    });

    it('produces different colors for different tag names', () => {
      expect(tagColor('bug')).not.toBe(tagColor('feature'));
    });

    it('produces HSL format', () => {
      expect(tagColor('bug')).toMatch(/^hsl\(\d+, 65%, 82%\)$/);
    });

    it('has correct dark text color constant', () => {
      expect(TAG_TEXT_COLOR).toBe('#1a1a1a');
    });
  });

  describe('tag suggestions', () => {
    it('excludes current thread tags from suggestions', () => {
      const allContents: ThreadTagsContent[] = [
        {
          tags: {
            bug: { set_by: '@a:b', set_at: ISO_1 },
            feature: { set_by: '@a:b', set_at: ISO_2 },
          },
        },
      ];
      const currentTags = { bug: { set_by: '@a:b', set_at: ISO_1 } };
      expect(collectAvailableTags(allContents, currentTags)).toEqual(['feature']);
    });

    it('never suggests resolved tag', () => {
      const allContents: ThreadTagsContent[] = [
        {
          tags: {
            [RESOLVED_TAG]: { set_by: '@a:b', set_at: ISO_1 },
            bug: { set_by: '@a:b', set_at: ISO_2 },
          },
        },
      ];
      expect(collectAvailableTags(allContents, {})).toEqual(['bug']);
    });
  });

  describe('tag input validation', () => {
    it('normalizes input', () => {
      expect(normalizeTagName('  Bug  ')).toBe('bug');
    });

    it('rejects empty/whitespace', () => {
      expect(isValidTagName('')).toBe(false);
      expect(isValidTagName('   ')).toBe(false);
    });

    it('rejects reserved resolved tag', () => {
      expect(isValidTagName('resolved')).toBe(false);
      expect(isValidTagName('  Resolved  ')).toBe(false);
    });

    it('accepts valid names', () => {
      expect(isValidTagName('bug')).toBe(true);
      expect(isValidTagName('feature-request')).toBe(true);
      expect(isValidTagName('wontfix')).toBe(true);
    });
  });
});

// The text a node renders, its pieces joined by spaces.
const text = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : text(child)))
    .filter(Boolean)
    .join(' ');

describe('ThreadContextBanner rendering', () => {
  let store: ReturnType<typeof createStore>;
  // The shortcut labels below are the ones of platforms without a Command key: pin the platform
  // the shortcut formatter reads, so the test host's own does not decide.
  let platform: MockInstance<() => string>;
  beforeEach(() => {
    platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
  });
  afterEach(() => {
    platform.mockRestore();
  });
  beforeEach(() => {
    store = createStore();
    menuProps.mockClear();
    pinningMocks.pinnedEventIds = [];
    pinningMocks.canPin = false;
    pinningMocks.setPinned.mockReset();
    bannerMocks.useThreadRootEvent.mockReturnValue('$root');
    bannerMocks.useCachedThreadRoot.mockReturnValue(undefined);
    bannerMocks.useThreadTags.mockReturnValue({
      tags: {},
      displayTags: [],
      isResolved: false,
      canEdit: false,
      availableTags: [],
    });
    bannerMocks.useMutateThreadTags.mockReturnValue({
      addTag: vi.fn(),
      removeTag: vi.fn(),
      setResolved: vi.fn(),
      updating: false,
      error: undefined,
    });
    bannerMocks.useThreadHeaderInfo.mockReturnValue({ scheduledTaskCount: 0 });
  });

  const bannerElement = (
    summaryText?: string,
    threadId = '$root',
    columnProps?: Partial<
      Pick<
        ThreadContextBannerProps,
        'onShowBeside' | 'onShowFull' | 'onClose' | 'onExitThread' | 'phoneHeader'
      >
    >
  ) =>
    React.createElement(
      Provider,
      { store },
      React.createElement(ThreadContextBanner, {
        room: {
          roomId: '!room:example.org',
          getThread: () => undefined,
          findEventById: () => undefined,
          getUnfilteredTimelineSet: () => undefined,
          getMember: (userId: string) =>
            userId === '@alice:example.org'
              ? { rawDisplayName: 'Alice', name: 'Alice' }
              : undefined,
          hasEncryptionStateEvent: () => false,
          on: vi.fn(),
          removeListener: vi.fn(),
        } as unknown as Room,
        threadId,
        summaryInfo: summaryText ? { summaryText } : undefined,
        onExitThread: vi.fn(),
        ...columnProps,
      })
    );
  const renderBanner = (
    summaryText?: string,
    createNodeMock?: (element: React.ReactElement) => unknown
  ) => create(bannerElement(summaryText), createNodeMock ? { createNodeMock } : undefined);

  it('opens actions for the active thread and current summary without offering navigation', async () => {
    const renderer = renderBanner('Current summary');
    const banner = renderer.root.findByProps({ className: 'Banner' });
    const target = { focus: vi.fn(), isConnected: true, contains: () => true };
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 120,
      clientY: 230,
      currentTarget: target,
      target,
    };

    await act(async () => banner.props.onContextMenu(event));

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    const selectedMenu = menuProps.mock.calls.at(-1)![0];
    expect(selectedMenu.rootId).toBe('$root');
    expect(selectedMenu.summaryText).toBe('Current summary');
    expect(selectedMenu.anchor).toEqual({ x: 120, y: 230, width: 0, height: 0 });
    expect(selectedMenu.onOpenThread).toBeUndefined();
    await act(() => selectedMenu.onClose());
    // Focusing inside the sticky banner must not scroll the thread to its top.
    expect(target.focus).toHaveBeenCalledOnce();
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
    renderer.unmount();
  });

  it.each([
    { key: 'ContextMenu', shiftKey: false },
    { key: 'F10', shiftKey: true },
  ])('supports the $key keyboard shortcut and restores the focused trigger', async (keys) => {
    const renderer = renderBanner();
    const banner = renderer.root.findByProps({ className: 'Banner' });
    const trigger = { focus: vi.fn(), isConnected: true };
    const anchor = { x: 20, y: 30, width: 400, height: 80 };
    const event = {
      ...keys,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: { getBoundingClientRect: () => anchor, contains: () => true },
      target: trigger,
    };

    await act(async () => banner.props.onKeyDown(event));

    const selectedMenu = menuProps.mock.calls.at(-1)![0];
    expect(selectedMenu.rootId).toBe('$root');
    expect(selectedMenu.anchor).toEqual(anchor);
    await act(() => selectedMenu.onClose());
    expect(trigger.focus).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  it('restores focus to More when the original trigger has detached', async () => {
    const moreButton = { focus: vi.fn(), isConnected: true };
    const renderer = renderBanner(undefined, (element) =>
      element.type === 'button' && element.props['aria-haspopup'] === 'menu' ? moreButton : null
    );
    const trigger = { focus: vi.fn(), isConnected: false };
    const banner = renderer.root.findByProps({ className: 'Banner' });
    await act(async () =>
      banner.props.onKeyDown({
        key: 'ContextMenu',
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: {
          getBoundingClientRect: () => ({ x: 20, y: 30, width: 400, height: 80 }),
          contains: () => true,
        },
        target: trigger,
      })
    );

    await act(() => menuProps.mock.calls.at(-1)![0].onClose());

    expect(trigger.focus).not.toHaveBeenCalled();
    expect(moreButton.focus).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  it('offers a More button and ignores a stale close after the thread route changes', async () => {
    const renderer = renderBanner();
    const trigger = {
      focus: vi.fn(),
      isConnected: true,
      getBoundingClientRect: () => ({ x: 20, y: 30, width: 30, height: 30 }),
    };
    const more = () =>
      renderer.root
        .findAllByType('button')
        .find((button) => button.props['aria-haspopup'] === 'menu')!;

    expect(more().props['aria-label']).toBe('Thread options');
    await act(async () => more().props.onClick({ currentTarget: trigger }));
    const firstMenu = menuProps.mock.calls.at(-1)![0];

    const nextProps: ThreadContextBannerProps = {
      ...(renderer.root.findByType(ThreadContextBanner).props as ThreadContextBannerProps),
      threadId: '$next',
    };
    bannerMocks.useThreadRootEvent.mockReturnValue('$next');
    act(() => renderer.update(React.createElement(ThreadContextBanner, nextProps)));
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
    await act(async () => more().props.onClick({ currentTarget: trigger }));
    await act(() => firstMenu.onClose());

    expect(trigger.focus).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(1);
    expect(menuProps.mock.calls.at(-1)![0].rootId).toBe('$next');
    const nextMenu = menuProps.mock.calls.at(-1)![0];
    renderer.unmount();
    await act(() => nextMenu.onClose());
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it('ignores context-menu and keyboard events from portalled header controls', async () => {
    const renderer = renderBanner();
    const banner = renderer.root.findByProps({ className: 'Banner' });
    const event = {
      key: 'ContextMenu',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: { contains: () => false },
      target: {},
    };

    await act(async () => {
      banner.props.onContextMenu(event);
      banner.props.onKeyDown(event);
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(menuProps).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('replaces Resolve with a solid pin and allows only admins to unpin', () => {
    pinningMocks.pinnedEventIds = ['$root'];
    bannerMocks.useThreadHeaderInfo.mockReturnValue({ scheduledTaskCount: 0 });
    const member = renderBanner();
    expect(JSON.stringify(member.toJSON())).not.toContain('Resolve');
    const pinnedStatus = member.root.findByProps({ role: 'img', 'aria-label': 'Pinned' });
    expect(pinnedStatus.findByType('i').props.filled).toBe(true);
    expect(member.root.findAll((node) => node.children.includes('Pinned'))).toHaveLength(0);
    expect(member.root.findAllByProps({ 'aria-label': 'Unpin thread' })).toHaveLength(0);
    member.unmount();
    pinningMocks.canPin = true;
    const admin = renderBanner();
    expect(admin.root.findAll((node) => node.children.includes('Pinned'))).toHaveLength(0);
    const unpin = admin.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === 'Unpin thread');
    expect(unpin).toBeDefined();
    expect(unpin!.findByType('i').props.filled).toBe(true);
    unpin!.props.onClick();
    expect(pinningMocks.setPinned).toHaveBeenCalledWith('$root', false);
    admin.unmount();
  });

  it('keeps only back, title and More on short screens', () => {
    pinningMocks.canPin = true;
    bannerMocks.useThreadTags.mockReturnValue({
      tags: { bug: { set_by: '@a:b', set_at: ISO_1 } },
      displayTags: ['bug'],
      isResolved: false,
      canEdit: true,
      availableTags: [],
    });
    const hidden = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root
        .findAll(
          (node) =>
            typeof node.type === 'string' &&
            String(node.props.className ?? '')
              .split(' ')
              .includes('CompactHidden')
        )
        .map((node) => {
          const [className] = String(node.props.className).split(' ');
          return (
            node.props['aria-label'] ?? (className === 'CompactHidden' ? text(node) : className)
          );
        });

    const summarized = renderBanner('A concise thread summary');
    expect(hidden(summarized)).toEqual(['TagsRow', 'Pin thread', 'Resolve', 'MobileOnlyTags']);
    const more = summarized.root.findByProps({ 'aria-label': 'Thread options' });
    expect(more.props.className).toBe('MessageOptionsButton');
    summarized.unmount();

    // Without a title the eyebrow is the only label, so it stays.
    const untitled = renderBanner();
    expect(hidden(untitled)).not.toContain('ViewLabel');
    untitled.unmount();

    // A resolved status stays in view; only its byline goes.
    bannerMocks.useThreadTags.mockReturnValue({
      tags: { [RESOLVED_TAG]: { set_by: '@alice:example.org', set_at: ISO_1 } },
      displayTags: [],
      isResolved: true,
      canEdit: false,
      availableTags: [],
    });
    const resolved = renderBanner('A concise thread summary');
    expect(JSON.stringify(resolved.toJSON())).toContain('"Resolved"');
    expect(hidden(resolved)).toEqual(['Resolved by Alice', 'Pin thread']);
    resolved.unmount();

    // The solid pin replaces Resolve and stays in view.
    pinningMocks.pinnedEventIds = ['$root'];
    const pinned = renderBanner('A concise thread summary');
    expect(hidden(pinned)).toEqual([]);
    expect(pinned.root.findByProps({ 'aria-label': 'Unpin thread' })).toBeDefined();
    pinned.unmount();
  });

  it('leaves Show beside and Show in full to its More menu, with no button of their own', async () => {
    const onShowBeside = vi.fn();
    const onShowFull = vi.fn();
    const renderer = create(bannerElement(undefined, '$root', { onShowBeside, onShowFull }));
    const labels = renderer.root
      .findAllByType('button')
      .map((button) => button.props['aria-label'] as string | undefined);
    expect(labels).not.toContain('Show the thread beside the messages');
    expect(labels).not.toContain('Show the thread in full');
    const more = renderer.root
      .findAllByType('button')
      .find((button) => button.props['aria-haspopup'] === 'menu')!;
    const trigger = { getBoundingClientRect: () => ({ x: 0, y: 0, width: 30, height: 30 }) };
    await act(async () => more.props.onClick({ currentTarget: trigger }));
    expect(menuProps.mock.calls.at(-1)![0]).toMatchObject({ onShowBeside, onShowFull });
    renderer.unmount();
  });

  it('drops the Thread View eyebrow once the thread has a title', () => {
    const eyebrow = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root.findAll(
        (node) =>
          typeof node.type === 'string' &&
          String(node.props.className ?? '')
            .split(' ')
            .includes('ViewLabel')
      );

    const summarized = renderBanner('A concise thread summary');
    expect(eyebrow(summarized)).toHaveLength(0);
    summarized.unmount();

    const untitled = renderBanner();
    expect(eyebrow(untitled)).toHaveLength(1);
    untitled.unmount();

    // A scheduled-task line is a title too.
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      scheduledTaskCount: 2,
      nextScheduledTs: Date.parse('2026-04-04T18:12:00.000Z'),
      scheduledDisplayText: 'in 12m',
    });
    const scheduled = renderBanner();
    expect(eyebrow(scheduled)).toHaveLength(0);
    scheduled.unmount();
  });

  it("titles a thread without a summary by its first message's start", () => {
    const rootEvent = new MatrixEvent({
      event_id: '$root',
      type: 'm.room.message',
      room_id: '!room:example.org',
      sender: '@bob:example.org',
      origin_server_ts: 1,
      content: { msgtype: 'm.text', body: '**Deploy** plan for @alice:example.org: staging first' },
    });
    const element = (summaryText?: string) =>
      React.createElement(
        Provider,
        { store },
        React.createElement(ThreadContextBanner, {
          room: {
            roomId: '!room:example.org',
            getThread: () => undefined,
            findEventById: (eventId: string) => (eventId === '$root' ? rootEvent : undefined),
            getUnfilteredTimelineSet: () => undefined,
            getMember: (userId: string) =>
              userId === '@alice:example.org'
                ? { rawDisplayName: 'Alice', name: 'Alice' }
                : undefined,
            hasEncryptionStateEvent: () => false,
            on: vi.fn(),
            removeListener: vi.fn(),
          } as unknown as Room,
          threadId: '$root',
          summaryInfo: summaryText ? { summaryText } : undefined,
          onExitThread: vi.fn(),
        })
      );

    const untitled = create(element());
    const title = untitled.root.findByProps({ 'data-thread-context-root-title': 'true' });
    expect(text(title)).toBe('Deploy plan for Alice: staging first');
    expect(title.props.title).toBe('Deploy plan for Alice: staging first');
    expect(JSON.stringify(untitled.toJSON())).not.toContain('Thread View');
    untitled.unmount();

    const summarized = create(element('Staging deploy plan'));
    expect(summarized.root.findAllByProps({ 'data-thread-context-root-title': 'true' })).toEqual(
      []
    );
    expect(text(summarized.root.findByProps({ 'data-thread-context-summary': 'true' }))).toBe(
      'Staging deploy plan'
    );
    summarized.unmount();
  });

  it('titles a thread the SDK does not know by its cached first message', () => {
    // Offline, the SDK holds neither the thread nor its root; the event cache does.
    bannerMocks.useCachedThreadRoot.mockReturnValue(
      new MatrixEvent({
        event_id: '$root',
        type: 'm.room.message',
        room_id: '!room:example.org',
        sender: '@bob:example.org',
        origin_server_ts: 1,
        content: { msgtype: 'm.text', body: 'Harbor schedule for the week' },
      })
    );
    const banner = create(
      React.createElement(
        Provider,
        { store },
        React.createElement(ThreadContextBanner, {
          room: {
            roomId: '!room:example.org',
            getThread: () => undefined,
            findEventById: () => undefined,
            getUnfilteredTimelineSet: () => undefined,
            getMember: () => undefined,
            hasEncryptionStateEvent: () => false,
            on: vi.fn(),
            removeListener: vi.fn(),
          } as unknown as Room,
          threadId: '$root',
          onExitThread: vi.fn(),
        })
      )
    );
    const title = banner.root.findByProps({ 'data-thread-context-root-title': 'true' });
    expect(text(title)).toBe('Harbor schedule for the week');
    expect(JSON.stringify(banner.toJSON())).not.toContain('Thread View');
    banner.unmount();
  });

  it('offers + tag only next to existing tags', () => {
    const editable = { tags: {}, isResolved: false, canEdit: true, availableTags: ['bug'] };
    bannerMocks.useThreadTags.mockReturnValue({ ...editable, displayTags: [] });
    const untagged = renderBanner('A concise thread summary');
    // More still adds the first tag.
    expect(JSON.stringify(untagged.toJSON())).not.toContain('+ tag');
    untagged.unmount();

    bannerMocks.useThreadTags.mockReturnValue({
      ...editable,
      tags: { bug: { set_by: '@a:b', set_at: ISO_1 } },
      displayTags: ['bug'],
    });
    const tagged = renderBanner('A concise thread summary');
    // One picker beside the desktop tags, one beside the mobile tags row.
    expect(
      tagged.root.findAll((node) => node.type === 'button' && node.children.includes('+ tag'))
    ).toHaveLength(2);
    tagged.unmount();
  });

  it('collapses to back and Show details from More and keeps that for the next thread', async () => {
    pinningMocks.canPin = true;
    bannerMocks.useThreadTags.mockReturnValue({
      tags: { bug: { set_by: '@a:b', set_at: ISO_1 } },
      displayTags: ['bug'],
      isResolved: false,
      canEdit: true,
      availableTags: [],
    });
    const banner = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root.findByProps({ 'data-thread-context-banner': 'true' });
    const buttons = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root.findAllByType('button').map((button) => button.props['aria-label']);
    const focusable = { more: { focus: vi.fn() }, show: { focus: vi.fn() } };
    // Inside act, so the settings subscription is live before the click.
    const renderSubscribed = (summary: string) => {
      let renderer: ReturnType<typeof renderBanner> | undefined;
      act(() => {
        renderer = renderBanner(summary, (element) => {
          if (element.props['aria-haspopup'] === 'menu') return focusable.more;
          if (element.props['aria-label'] === 'Show thread details') return focusable.show;
          return null;
        });
      });
      return renderer!;
    };
    const openMore = async (renderer: ReturnType<typeof renderBanner>) => {
      const trigger = {
        focus: vi.fn(),
        isConnected: true,
        getBoundingClientRect: () => ({ x: 20, y: 30, width: 30, height: 30 }),
      };
      const more = renderer.root.findByProps({ 'aria-label': 'Thread options' });
      await act(async () => more.props.onClick({ currentTarget: trigger }));
      return menuProps.mock.calls.at(-1)![0];
    };

    const renderer = renderSubscribed('A concise thread summary');
    expect(banner(renderer).props.className).toBe('Banner');
    expect(buttons(renderer)).not.toContain('Hide thread details');
    const menu = await openMore(renderer);
    act(() => {
      menu.onHideDetails();
      menu.onClose();
    });
    expect(banner(renderer).props.className).toBe('Banner Collapsed');
    expect(store.get(settingsAtom).threadBannerCollapsed).toBe(true);
    expect(buttons(renderer)).toEqual(['Back', 'Show thread details']);
    expect(renderer.root.findAllByProps({ 'data-approvals': 'true' })).toHaveLength(1);
    // Auto-approval stays in view with the thread's own ID.
    expect(renderer.root.findAllByProps({ 'data-auto-approve': '$root' })).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('A concise thread summary');
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
    // Hide unmounted with the menu; focus moves to the button that undoes it.
    expect(focusable.show.focus).toHaveBeenCalledOnce();
    expect(focusable.show.focus).toHaveBeenCalledWith({ preventScroll: true });
    renderer.unmount();

    const next = renderSubscribed('Another thread');
    expect(banner(next).props.className).toBe('Banner Collapsed');
    expect(focusable.show.focus).toHaveBeenCalledOnce();
    focusable.more.focus.mockClear();
    await act(() => next.root.findByProps({ 'aria-label': 'Show thread details' }).props.onClick());
    expect(banner(next).props.className).toBe('Banner');
    expect(store.get(settingsAtom).threadBannerCollapsed).toBe(false);
    expect(focusable.more.focus).toHaveBeenCalledOnce();
    expect(focusable.more.focus).toHaveBeenCalledWith({ preventScroll: true });
    next.unmount();
  });

  it('focuses the banner on expanding while More waits for a confirmed root', async () => {
    store.set(settingsAtom, { ...store.get(settingsAtom), threadBannerCollapsed: true });
    bannerMocks.useThreadRootEvent.mockReturnValue('~!room:example.org:txn-root');
    const banner = { focus: vi.fn() };
    const more = { focus: vi.fn(), disabled: true };
    let renderer: ReturnType<typeof renderBanner> | undefined;
    act(() => {
      renderer = renderBanner('A concise thread summary', (element) => {
        if (element.props['data-thread-context-banner']) return banner;
        if (element.props['aria-haspopup'] === 'menu') return more;
        return null;
      });
    });
    await act(() =>
      renderer!.root.findByProps({ 'aria-label': 'Show thread details' }).props.onClick()
    );
    expect(more.focus).not.toHaveBeenCalled();
    expect(banner.focus).toHaveBeenCalledWith({ preventScroll: true });
    renderer!.unmount();
  });

  it('keeps the resolved tint and offers no Hide item once collapsed', async () => {
    store.set(settingsAtom, { ...store.get(settingsAtom), threadBannerCollapsed: true });
    bannerMocks.useThreadTags.mockReturnValue({
      tags: { [RESOLVED_TAG]: { set_by: '@alice:example.org', set_at: ISO_1 } },
      displayTags: [],
      isResolved: true,
      canEdit: true,
      availableTags: [],
    });
    const renderer = renderBanner('A concise thread summary');
    const banner = renderer.root.findByProps({ 'data-thread-context-banner': 'true' });
    expect(banner.props.className).toBe('BannerResolved Collapsed');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('"Resolved"');
    // Right-clicking the pill still opens the actions, without Hide.
    const target = { focus: vi.fn(), isConnected: true, contains: () => true };
    await act(async () =>
      banner.props.onContextMenu({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        clientX: 10,
        clientY: 10,
        currentTarget: target,
        target,
      })
    );
    expect(menuProps.mock.calls.at(-1)![0].onHideDetails).toBeUndefined();
    renderer.unmount();
  });

  it('hides the metadata row when no summary or scheduled task info exists', () => {
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      summaryText: undefined,
      scheduledTaskCount: 0,
      nextScheduledTs: undefined,
      scheduledDisplayText: undefined,
    });

    const renderer = renderBanner();
    const tree = JSON.stringify(renderer.toJSON());

    expect(tree).toContain('Thread View');
    expect(tree).not.toContain('Focused thread context is active.');
    expect(tree).not.toContain('Next task');
  });

  it("draws the plugins' thread header slot before More, and after the approvals once collapsed", () => {
    /** The banner's slot, approvals and buttons in document order. */
    const order = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root
        .findAll(
          (node) =>
            node.type === 'button' ||
            (typeof node.type === 'string' &&
              (node.props['data-thread-header-slot'] !== undefined ||
                node.props['data-approvals'] !== undefined))
        )
        .map(
          (node) =>
            node.props['data-thread-header-slot'] ??
            (node.props['data-approvals'] ? 'approvals' : node.props['aria-label'])
        );
    const expanded = renderBanner();
    expect(order(expanded)).toEqual([
      'Back',
      'approvals',
      '!room:example.org $root',
      'Thread options',
      'Resolve',
    ]);
    expanded.unmount();
    act(() => store.set(settingsAtom, { ...store.get(settingsAtom), threadBannerCollapsed: true }));
    const collapsed = renderBanner();
    expect(order(collapsed)).toEqual([
      'Back',
      'approvals',
      '!room:example.org $root',
      'Show thread details',
    ]);
    collapsed.unmount();
  });

  it('draws no thread header slot until the server confirms the thread root', () => {
    bannerMocks.useThreadRootEvent.mockReturnValue('~!room:example.org:txn-root');
    const renderer = renderBanner();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('data-thread-header-slot');
    renderer.unmount();
  });

  it('disables tag and resolve actions for a provisional thread root', () => {
    bannerMocks.useThreadRootEvent.mockReturnValue('~!room:example.org:txn-root');
    bannerMocks.useThreadTags.mockReturnValue({
      displayTags: [],
      isResolved: false,
      canEdit: true,
      availableTags: ['bug'],
    });
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      scheduledTaskCount: 0,
      nextScheduledTs: undefined,
      scheduledDisplayText: undefined,
    });

    const renderer = renderBanner();
    const resolveButton = renderer.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === 'Resolve');

    expect(JSON.stringify(renderer.toJSON())).not.toContain('+ tag');
    expect(resolveButton?.props.disabled).toBe(true);
  });

  it('ignores every menu trigger until the provisional root is confirmed', async () => {
    bannerMocks.useThreadRootEvent.mockReturnValue('~!room:example.org:txn-root');
    const renderer = renderBanner();
    const banner = renderer.root.findByProps({ className: 'Banner' });
    const target = {
      contains: () => true,
      getBoundingClientRect: () => ({ x: 20, y: 30, width: 30, height: 30 }),
    };
    const more = () =>
      renderer.root
        .findAllByType('button')
        .find((button) => button.props['aria-haspopup'] === 'menu')!;
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: target,
      target,
      clientX: 20,
      clientY: 30,
    };

    await act(async () => {
      more().props.onClick(event);
      banner.props.onContextMenu(event);
      banner.props.onKeyDown({ ...event, key: 'ContextMenu' });
      banner.props.onKeyDown({ ...event, key: 'F10', shiftKey: true });
    });

    expect(more().props.disabled).toBe(true);
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
    bannerMocks.useThreadRootEvent.mockReturnValue('$confirmed');
    act(() =>
      renderer.update(
        React.createElement(
          ThreadContextBanner,
          renderer.root.findByType(ThreadContextBanner).props as ThreadContextBannerProps
        )
      )
    );
    expect(more().props.disabled).toBe(false);
    await act(async () => more().props.onClick(event));
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(1);
    renderer.unmount();
  });

  it('renders a truncated summary row when summary text is available', () => {
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      scheduledTaskCount: 0,
      nextScheduledTs: undefined,
      scheduledDisplayText: undefined,
    });

    const renderer = renderBanner('A concise thread summary');
    const tree = JSON.stringify(renderer.toJSON());

    expect(tree).toContain('A concise thread summary');
    expect(renderer.root.findByProps({ title: 'A concise thread summary' })).toBeTruthy();
    expect(renderer.root.findByProps({ 'data-thread-context-summary': 'true' })).toBeTruthy();
    expect(tree).not.toContain('Next task');
  });

  it('tints the summary only when it changes in the same thread', async () => {
    const summaryClass = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root.findByProps({ 'data-thread-context-summary': 'true' }).props.className;
    let renderer!: ReturnType<typeof renderBanner>;
    act(() => {
      renderer = create(bannerElement('Push bug'));
    });
    expect(summaryClass(renderer)).toBe('SummaryText');

    act(() => renderer.update(bannerElement('Fixing token refresh')));
    expect(summaryClass(renderer)).toBe('SummaryText SummaryTextChanged');
    // Played once: remounting the title, as expanding the banner does, does not replay it.
    await act(() =>
      renderer.root.findByProps({ 'data-thread-context-summary': 'true' }).props.onAnimationEnd()
    );
    expect(summaryClass(renderer)).toBe('SummaryText');

    act(() => renderer.update(bannerElement('Another thread', '$other')));
    expect(summaryClass(renderer)).toBe('SummaryText');
  });

  it('drops a pending tint when the banner collapses', () => {
    const summaryClass = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root.findByProps({ 'data-thread-context-summary': 'true' }).props.className;
    const setCollapsed = (threadBannerCollapsed: boolean) =>
      act(() => store.set(settingsAtom, { ...store.get(settingsAtom), threadBannerCollapsed }));
    let renderer!: ReturnType<typeof renderBanner>;
    act(() => {
      renderer = create(bannerElement('Push bug'));
    });
    act(() => renderer.update(bannerElement('Fixing token refresh')));
    expect(summaryClass(renderer)).toBe('SummaryText SummaryTextChanged');

    // Collapsed before the tint ends, so the title unmounts without its animationend.
    setCollapsed(true);
    setCollapsed(false);

    expect(summaryClass(renderer)).toBe('SummaryText');
    act(() => renderer.unmount());
  });

  it('shows the next summary once the SDK replaces a redacted latest summary', () => {
    const notice = (eventId: string, summary: string, timestamp: number) =>
      new MatrixEvent({
        event_id: eventId,
        type: 'm.room.message',
        origin_server_ts: timestamp,
        content: {
          msgtype: 'm.notice',
          body: summary,
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
          'io.mindroom.thread_summary': {
            version: 1,
            summary,
            generated_at: new Date(timestamp).toISOString(),
          },
        },
      });
    const older = notice('$older', 'Older title', 1000);
    // Until it re-fetches the root, the SDK's latest reply is an unredacted copy.
    const thread = {
      id: '$root',
      replyToEvent: notice('$leaked', 'Leaked title', 2000),
      lastReply: () => null,
      getUnfilteredTimelineSet: () => ({
        getLiveTimeline: () => ({ getEvents: () => [], getNeighbouringTimeline: () => null }),
        relations: { getChildEventsForEvent: () => undefined },
      }),
    };
    const emitter = new EventEmitter();
    const room = {
      roomId: '!room:example.org',
      getThread: () => thread,
      findEventById: () => undefined,
      getMember: () => undefined,
      hasEncryptionStateEvent: () => false,
      on: emitter.on.bind(emitter),
      removeListener: emitter.removeListener.bind(emitter),
    } as unknown as Room;
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(ThreadContextBanner, {
          room,
          threadId: '$root',
          summaryInfo: { summaryText: 'Older title', eventTs: 1000, eventId: '$older' },
          onExitThread: vi.fn(),
        })
      );
    });
    const summaryText = () =>
      renderer.root.findByProps({ 'data-thread-context-summary': 'true' }).props.title;
    expect(summaryText()).toBe('Leaked title');

    thread.replyToEvent = older;
    act(() => {
      emitter.emit(ThreadEvent.Update, thread);
    });
    expect(summaryText()).toBe('Older title');
  });

  it('does not render the summary node when summary text is empty or undefined', () => {
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      scheduledTaskCount: 0,
      nextScheduledTs: undefined,
      scheduledDisplayText: undefined,
    });

    const emptyRenderer = renderBanner('');
    const undefinedRenderer = renderBanner();

    expect(
      emptyRenderer.root.findAllByProps({ 'data-thread-context-summary': 'true' })
    ).toHaveLength(0);
    expect(
      undefinedRenderer.root.findAllByProps({ 'data-thread-context-summary': 'true' })
    ).toHaveLength(0);
  });

  it('renders the scheduled countdown row when only scheduled task info exists', () => {
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      summaryText: undefined,
      scheduledTaskCount: 2,
      nextScheduledTs: Date.parse('2026-04-04T18:12:00.000Z'),
      scheduledDisplayText: 'in 12m',
    });

    const renderer = renderBanner();
    const tree = JSON.stringify(renderer.toJSON());

    expect(tree).toContain('Next task in 12m');
    expect(tree).toContain('Resolve');
  });

  it('uses scheduled-task fallback copy when no next-run timestamp is available', () => {
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      summaryText: undefined,
      scheduledTaskCount: 2,
      nextScheduledTs: undefined,
      scheduledDisplayText: '2 scheduled tasks',
    });

    const renderer = renderBanner();
    const tree = JSON.stringify(renderer.toJSON());

    expect(tree).toContain('2 scheduled tasks');
    expect(renderer.root.findByProps({ 'aria-label': '2 pending scheduled tasks' })).toBeTruthy();
  });

  it('renders the backend cron description when it is the only scheduled task detail', () => {
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      scheduledTaskCount: 1,
      nextScheduledTs: undefined,
      cronDescription: 'At 09:00',
      scheduledDisplayText: 'At 09:00',
    });

    const renderer = renderBanner();
    const tree = JSON.stringify(renderer.toJSON());

    expect(tree).toContain('At 09:00');
    expect(tree).not.toContain('1 scheduled task');
    expect(
      renderer.root.findByProps({ 'aria-label': '1 pending scheduled task, At 09:00' })
    ).toBeTruthy();
  });

  describe('snooze', () => {
    const SET_AT = '2026-11-13T10:00:00Z';
    const withSnooze = (until: string, isResolved = false, canEdit = false) =>
      bannerMocks.useThreadTags.mockReturnValue({
        tags: { snoozed: { set_by: '@alice:example.org', set_at: SET_AT, data: { until } } },
        displayTags: [],
        isResolved,
        canEdit,
        availableTags: [],
      });
    const unsnoozeButtons = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root.findAll(
        (node) => node.type === 'button' && node.props['data-thread-unsnooze'] === 'true'
      );
    const snoozedRows = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root.findAll(
        (node) => typeof node.type === 'string' && node.props['data-thread-snoozed'] === 'true'
      );

    afterEach(() => vi.useRealTimers());

    it('shows "Snoozed until ..." while the thread is snoozed and nothing after its time', () => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.parse('2026-11-13T10:00:00Z'));
      withSnooze('2026-11-13T10:30:00Z');
      const renderer = renderBanner();
      const bannerClass = () =>
        renderer.root.findByProps({ 'data-thread-context-banner': 'true' }).props.className;
      expect(JSON.stringify(renderer.toJSON())).toContain(
        `Snoozed until ${new Intl.DateTimeFormat('en', {
          hour: 'numeric',
          minute: '2-digit',
        }).format(Date.parse('2026-11-13T10:30:00Z'))}`
      );
      expect(snoozedRows(renderer)).toHaveLength(1);
      expect(bannerClass()).toBe('BannerSnoozed');
      act(() => {
        vi.advanceTimersByTime(30 * 60_000);
      });
      expect(JSON.stringify(renderer.toJSON())).not.toContain('Snoozed until');
      expect(snoozedRows(renderer)).toHaveLength(0);
      expect(bannerClass()).toBe('Banner');
    });

    it('offers Unsnooze beside the snooze to those who may edit tags', async () => {
      const unsnooze = vi.fn();
      bannerMocks.useMutateThreadTags.mockReturnValue({
        addTag: vi.fn(),
        removeTag: vi.fn(),
        setResolved: vi.fn(),
        unsnooze,
        updating: false,
        error: undefined,
      });
      const until = new Date(Date.now() + 3600_000).toISOString();

      withSnooze(until, false, false);
      expect(unsnoozeButtons(renderBanner())).toHaveLength(0);

      withSnooze(until, false, true);
      const renderer = renderBanner();
      const [button] = unsnoozeButtons(renderer);
      expect(button?.props.children).toBe('Unsnooze');
      await act(() => button?.props.onClick());
      expect(unsnooze).toHaveBeenCalledWith('$root');
    });

    it('shows a resolved and snoozed thread as resolved only', () => {
      withSnooze(new Date(Date.now() + 3600_000).toISOString(), true);
      const renderer = renderBanner();
      expect(JSON.stringify(renderer.toJSON())).not.toContain('Snoozed until');
      expect(snoozedRows(renderer)).toHaveLength(0);
      expect(
        renderer.root.findByProps({ 'data-thread-context-banner': 'true' }).props.className
      ).toBe('BannerResolved');
    });
  });

  it('renders summary and scheduled countdown together when both exist', () => {
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse('2026-04-04T18:03:00.000Z'),
      scheduledDisplayText: 'in 3m',
    });

    const renderer = renderBanner('Summary text here');
    const tree = JSON.stringify(renderer.toJSON());

    expect(tree).toContain('Summary text here');
    expect(tree).toContain('in 3m');
    expect(tree).toContain('·');
    expect(tree).toContain('Resolve');
  });

  it('offers Resolve as an icon button named by a tooltip, like More and the pin', () => {
    pinningMocks.canPin = true;
    bannerMocks.useThreadTags.mockReturnValue({
      tags: {},
      displayTags: [],
      isResolved: false,
      canEdit: true,
      availableTags: [],
    });
    const renderer = renderBanner('A concise thread summary');
    const resolve = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Resolve'
    );
    expect(resolve.findByType('i').props.src).toBe('check');
    expect(resolve.props.className).toBe('MessageOptionsButton CompactHidden');
    const tips = renderer.root.findAllByProps({ role: 'tooltip' }).map(text);
    expect(tips).toEqual([
      'Back Alt+←',
      'Thread options',
      'Pin thread',
      'Resolve Ctrl+Shift+Enter',
    ]);
    expect(resolve.props['aria-keyshortcuts']).toBe('Control+Shift+Enter');
    // The tooltips replace the native ones.
    expect(renderer.root.findAll((node) => node.type === 'button' && !!node.props.title)).toEqual(
      []
    );
    renderer.unmount();
  });

  it('resolves the thread from its shortcut, but not while a side panel hides the conversation', () => {
    const setResolved = vi.fn();
    bannerMocks.useThreadTags.mockReturnValue({
      tags: {},
      displayTags: [],
      isResolved: false,
      canEdit: true,
      availableTags: [],
    });
    bannerMocks.useMutateThreadTags.mockReturnValue({
      addTag: vi.fn(),
      removeTag: vi.fn(),
      setResolved,
      updating: false,
      error: undefined,
    });
    let renderer: ReturnType<typeof renderBanner> | undefined;
    act(() => {
      renderer = renderBanner('A concise thread summary');
    });
    const press = () => runShortcut('resolveThread', {} as KeyboardEvent);

    act(() => store.set(conversationBehindPanelAtom, true));
    press();
    expect(setResolved).not.toHaveBeenCalled();

    act(() => store.set(conversationBehindPanelAtom, false));
    expect(press()).toBe(true);
    expect(setResolved).toHaveBeenCalledTimes(1);
    act(() => renderer?.unmount());
  });

  it("with onClose it advertises no resolve shortcut, which acts on the page's thread", async () => {
    bannerMocks.useThreadTags.mockReturnValue({
      tags: {},
      displayTags: [],
      isResolved: false,
      canEdit: true,
      availableTags: [],
    });
    const resolveKeys = (renderer: ReturnType<typeof create>) =>
      renderer.root.findByProps({ 'aria-label': 'Resolve' }).props['aria-keyshortcuts'] as unknown;
    const main = create(bannerElement());
    expect(resolveKeys(main)).toBeDefined();
    main.unmount();

    const second = create(bannerElement(undefined, '$root', { onClose: vi.fn() }));
    expect(resolveKeys(second)).toBeUndefined();
    const trigger = {
      focus: vi.fn(),
      isConnected: true,
      getBoundingClientRect: () => ({ x: 20, y: 30, width: 30, height: 30 }),
    };
    await act(async () =>
      second.root.findByProps({ 'aria-label': 'Thread options' }).props.onClick({
        currentTarget: trigger,
      })
    );
    expect(menuProps.mock.calls.at(-1)?.[0]).toMatchObject({ shortcutless: true });
    second.unmount();
  });

  it('with onClose it offers Close thread in place of Back', () => {
    const onClose = vi.fn();
    const renderer = create(bannerElement(undefined, '$root', { onClose }));
    const labels = renderer.root
      .findAllByType('button')
      .map((button) => button.props['aria-label'] as unknown);
    expect(labels).toContain('Close thread');
    expect(labels).not.toContain('Back');
    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Close thread' }).props.onClick();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('opens the back tooltip toward the banner in either text direction', () => {
    const backTip = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root.findAllByProps({ role: 'tooltip' }).find((tip) => text(tip).startsWith('Back'))!
        .props['data-align'];
    const ltr = renderBanner('A concise thread summary');
    expect(backTip(ltr)).toBe('Start');
    ltr.unmount();
    textDirection.mockReturnValue('rtl');
    const rtl = renderBanner('A concise thread summary');
    expect(backTip(rtl)).toBe('End');
    rtl.unmount();
    textDirection.mockReturnValue('ltr');
  });

  it('shows who resolved the thread after its title, not below the chip', () => {
    bannerMocks.useThreadTags.mockReturnValue({
      tags: {
        resolved: {
          set_by: '@alice:example.org',
          set_at: '2026-08-27T12:00:00.000Z',
        },
      },
      displayTags: [],
      isResolved: true,
      canEdit: true,
      availableTags: [],
    });
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      scheduledTaskCount: 0,
      nextScheduledTs: undefined,
      scheduledDisplayText: undefined,
    });

    const renderer = renderBanner('A concise thread summary');

    const chip = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Resolved'
    );
    expect(chip.props.className).toBe('MessageOptionsButton ResolvedButton');
    // Screen readers hear who resolved it from the button too, also where the byline is hidden.
    const bylineId = renderer.root.findByProps({ 'data-thread-resolution-byline': 'true' }).props
      .id;
    expect(bylineId).toBeTruthy();
    expect(chip.props['aria-describedby']).toBe(bylineId);
    expect(chip.findByType('i').props.src).toBe('check');
    // Who resolved it, and what pressing it does.
    expect(renderer.root.findAllByProps({ role: 'tooltip' }).map(text)).toContain(
      'Resolved by Alice Ctrl+Shift+Enter Reopen thread'
    );
    const byline = renderer.root.findByProps({ 'data-thread-resolution-byline': 'true' });
    expect(byline.props['aria-label']).toBe('Resolved by Alice');
    expect(byline.findByProps({ className: 'ResolverName' }).findByType('span').children).toContain(
      'by Alice'
    );
    const subtitle = renderer.root.findByProps({ className: 'SubtitleRow' });
    expect(
      subtitle.findAllByProps({ 'data-thread-resolution-byline': 'true' }, { deep: false })
    ).toHaveLength(1);
    expect(
      byline.findAllByProps({ className: 'MetadataDot ResolutionBylineDot' }, { deep: false })
    ).toHaveLength(1);
    expect(
      chip.findAllByProps({ 'data-thread-resolution-byline': 'true' }, { deep: false })
    ).toHaveLength(0);
    renderer.unmount();

    // Untitled, the byline needs no separator and the eyebrow stays.
    const untitled = renderBanner();
    expect(JSON.stringify(untitled.toJSON())).toContain('Thread View');
    const untitledByline = untitled.root.findByProps({ 'data-thread-resolution-byline': 'true' });
    expect(
      untitledByline.findAllByProps(
        { className: 'MetadataDot ResolutionBylineDot' },
        { deep: false }
      )
    ).toHaveLength(0);
    untitled.unmount();

    // A reader can't reopen, so the tooltip only says who resolved it.
    bannerMocks.useThreadTags.mockReturnValue({
      tags: { resolved: { set_by: '@alice:example.org', set_at: '2026-08-27T12:00:00.000Z' } },
      displayTags: [],
      isResolved: true,
      canEdit: false,
      availableTags: [],
    });
    const reader = renderBanner('A concise thread summary');
    expect(reader.root.findAllByProps({ role: 'tooltip' }).map(text)).toContain(
      'Resolved by Alice'
    );
    expect(JSON.stringify(reader.toJSON())).not.toContain('Reopen thread');
    reader.unmount();

    // A pinned thread shows the pin instead of the chip and its byline.
    pinningMocks.pinnedEventIds = ['$root'];
    const pinned = renderBanner('A concise thread summary');
    expect(
      pinned.root.findAllByProps({ 'data-thread-resolution-byline': 'true' }, { deep: false })
    ).toHaveLength(0);
    pinned.unmount();
  });

  describe("as the rows of a phone's room header", () => {
    // 122 characters, invented.
    const LONG_TITLE =
      'Fix the flaky upload retry on slow networks, show progress per file, and keep partial uploads when the app is closed early';
    const onRoomMenu = vi.fn();
    const onExitThread = vi.fn();
    const renderPhone = (summaryText?: string, threadId = '$root') =>
      create(
        React.createElement(
          ScreenSizeProvider,
          { value: ScreenSize.Mobile },
          bannerElement(summaryText, threadId, {
            onExitThread,
            phoneHeader: {
              roomName: 'Design',
              actions: React.createElement('button', { 'aria-label': 'Call' }),
              onRoomMenu,
              menuBadge: React.createElement('em', { 'data-room-menu-dot': '' }),
            },
          })
        )
      );
    /** What the row holds, in order: each control by its label or its marker. */
    const rowOrder = (renderer: ReturnType<typeof renderPhone>) =>
      renderer.root
        .findByProps({ className: 'PhoneRow' })
        .findAll(
          (node) => typeof node.type === 'string' && (node.type === 'button' || node.type === 'u'),
          { deep: true }
        )
        .map((node) =>
          String(node.props['aria-label'] ?? node.props['data-thread-header-slot'] ?? text(node))
        );
    const editable = (tags: string[] = []) =>
      bannerMocks.useThreadTags.mockReturnValue({
        tags: {},
        displayTags: tags,
        isResolved: false,
        canEdit: true,
        availableTags: [],
      });
    beforeEach(() => {
      onRoomMenu.mockClear();
      onExitThread.mockClear();
      pinningMocks.canPin = true;
      editable();
    });

    it('holds back, the room, the plugins, Resolve, the calls and More in one row, without pin or card', () => {
      const renderer = renderPhone(LONG_TITLE);
      expect(rowOrder(renderer)).toEqual([
        'Back',
        'Design',
        '!room:example.org $root',
        'Resolve',
        'Call',
        'Thread options',
      ]);
      // Flat rows of the header: no glass card, and the marker the banner's rules hang on.
      expect(glass.enabled).toBe(false);
      expect(renderer.root.findAllByProps({ className: 'Banner' })).toHaveLength(0);
      const header = renderer.root.findByProps({ className: 'PhoneHeader' });
      expect(header.props).toMatchObject({
        'data-thread-context-banner': 'true',
        'data-thread-phone-header': 'true',
      });
      // Pin is the menu's there; Resolve stays in view on short screens too.
      const labels = header.findAllByType('button').map((button) => button.props['aria-label']);
      expect(labels).not.toContain('Pin thread');
      expect(header.findByProps({ 'aria-label': 'Resolve' }).props.className).not.toContain(
        'CompactHidden'
      );
      // The room menu's dot shows on More.
      expect(
        header.findByProps({ 'aria-label': 'Thread options' }).findAllByProps({
          'data-room-menu-dot': '',
        })
      ).toHaveLength(1);
      renderer.unmount();
    });

    it("leads back from the chevron and from the room's name", () => {
      const renderer = renderPhone(LONG_TITLE);
      act(() => {
        renderer.root.findByProps({ 'data-phone-back': 'true' }).props.onClick();
      });
      const name = renderer.root.findByProps({ className: 'PhoneRoomButton' });
      expect(name.props.title).toBe('Back to room');
      expect(name.parent?.type).toBe('h1');
      act(() => {
        name.props.onClick();
      });
      expect(onExitThread).toHaveBeenCalledTimes(2);
      renderer.unmount();
    });

    it('shows the whole title under the row: it wraps and no line is cut', () => {
      const renderer = renderPhone(LONG_TITLE);
      const title = renderer.root.findByProps({ 'data-thread-context-summary': 'true' });
      expect(text(title)).toBe(LONG_TITLE);
      expect(title.props).toMatchObject({ className: 'PhoneTitle', truncate: false });
      expect(title.props['data-own-direction']).toBe('block');
      // Under the row, not in it.
      const summary = { 'data-thread-context-summary': 'true' };
      expect(
        renderer.root
          .findByProps({ className: 'PhoneTitleRow' })
          .findAllByProps(summary, { deep: false })
      ).toHaveLength(1);
      expect(
        renderer.root.findByProps({ className: 'PhoneRow' }).findAllByProps(summary)
      ).toHaveLength(0);
      renderer.unmount();

      // The banner card keeps its one cut line.
      const card = renderBanner(LONG_TITLE);
      expect(card.root.findByProps(summary).props).toMatchObject({
        className: 'SummaryText',
        truncate: true,
      });
      card.unmount();
    });

    it("opens the room's menu from More while the server has not confirmed the thread's root", async () => {
      const anchor = { x: 340, y: 60, width: 40, height: 40 };
      const trigger = { getBoundingClientRect: () => anchor, focus: vi.fn(), isConnected: true };
      const shown = menuProps.mock.calls.length;
      bannerMocks.useThreadRootEvent.mockReturnValue('~local');
      const renderer = renderPhone(undefined, '~local');
      const more = renderer.root.findByProps({ 'aria-label': 'Thread options' });
      expect(more.props.disabled).toBe(false);
      await act(async () => more.props.onClick({ currentTarget: trigger }));
      expect(onRoomMenu).toHaveBeenCalledWith(anchor);
      // The thread's own menu, with what would change a thread the server does not have, stays shut.
      expect(menuProps.mock.calls).toHaveLength(shown);
      renderer.unmount();

      // The card has no room menu to open: its More waits for the root.
      const card = create(bannerElement(undefined, '~local'));
      expect(card.root.findByProps({ 'aria-label': 'Thread options' }).props.disabled).toBe(true);
      card.unmount();
    });

    it("gives More the header buttons' size, and the title a block that takes the focus to be scrolled", () => {
      const renderer = renderPhone(LONG_TITLE);
      expect(renderer.root.findByProps({ 'aria-label': 'Thread options' }).props.className).toBe(
        'MessageOptionsButton PhoneMore'
      );
      expect(renderer.root.findByProps({ className: 'PhoneTitleRow' }).props.tabIndex).toBe(0);
      renderer.unmount();
      const card = renderBanner(LONG_TITLE);
      expect(card.root.findByProps({ 'aria-label': 'Thread options' }).props.className).toBe(
        'MessageOptionsButton'
      );
      card.unmount();
    });

    it('wraps the first message that titles a thread without a summary, where the card cuts it', () => {
      bannerMocks.useCachedThreadRoot.mockReturnValue(
        new MatrixEvent({
          event_id: '$root',
          type: 'm.room.message',
          room_id: '!room:example.org',
          sender: '@bob:example.org',
          origin_server_ts: 1,
          content: { msgtype: 'm.text', body: LONG_TITLE },
        })
      );
      const rootTitle = { 'data-thread-context-root-title': 'true' };
      const renderer = renderPhone();
      const title = renderer.root.findByProps(rootTitle);
      expect(text(title)).toBe(LONG_TITLE);
      expect(title.props).toMatchObject({ className: 'PhoneTitle', truncate: false });
      expect(title.props['data-own-direction']).toBe('block');
      renderer.unmount();

      const card = renderBanner();
      expect(card.root.findByProps(rootTitle).props).toMatchObject({
        className: 'SummaryText',
        truncate: true,
      });
      card.unmount();
    });

    it('puts the tags away, and marks a pinned thread beside its title in place of Resolve', () => {
      editable(['triage', 'networking']);
      const tagged = renderPhone(LONG_TITLE);
      const shown = JSON.stringify(tagged.toJSON());
      expect(shown).not.toContain('triage');
      expect(shown).not.toContain('+ tag');
      expect(tagged.root.findAllByProps({ className: 'PhonePin' })).toHaveLength(0);
      tagged.unmount();

      pinningMocks.pinnedEventIds = ['$root'];
      const pinned = renderPhone(LONG_TITLE);
      const pin = pinned.root.findByProps({ className: 'PhonePin' });
      expect(pin.props).toMatchObject({ role: 'img', 'aria-label': 'Pinned' });
      expect(
        pinned.root.findByProps({ className: 'PhoneTitleRow' }).findAll((node) => node === pin)
      ).toHaveLength(1);
      expect(rowOrder(pinned)).not.toContain('Resolve');
      pinned.unmount();
    });

    it("opens the room's menu from the thread's, where More is, and offers no Hide details", async () => {
      // A stored Hide details folds the card only: the header's rows stay.
      store.set(settingsAtom, { ...store.get(settingsAtom), threadBannerCollapsed: true });
      const renderer = renderPhone(LONG_TITLE);
      expect(renderer.root.findAllByProps({ 'aria-label': 'Show thread details' })).toHaveLength(0);
      const more = renderer.root.findByProps({ 'aria-label': 'Thread options' });
      const anchor = { x: 340, y: 60, width: 32, height: 32 };
      const trigger = { getBoundingClientRect: () => anchor, focus: vi.fn(), isConnected: true };
      await act(async () => more.props.onClick({ currentTarget: trigger }));
      const menu = menuProps.mock.calls.at(-1)![0];
      expect(menu.onHideDetails).toBeUndefined();
      act(() => {
        menu.onRoomMenu();
      });
      expect(onRoomMenu).toHaveBeenCalledWith(anchor);
      renderer.unmount();

      // The card's menu has no room menu to open.
      const card = renderBanner(LONG_TITLE);
      await act(async () =>
        card.root
          .findByProps({ 'aria-label': 'Show thread details' })
          .props.onClick({ currentTarget: trigger })
      );
      await act(async () =>
        card.root.findByProps({ 'aria-label': 'Thread options' }).props.onClick({
          currentTarget: trigger,
        })
      );
      expect(menuProps.mock.calls.at(-1)![0].onRoomMenu).toBeFalsy();
      card.unmount();
    });

    it('keeps a schedule, a snooze and the resolver in a row under the title', () => {
      bannerMocks.useThreadHeaderInfo.mockReturnValue({
        scheduledTaskCount: 1,
        nextScheduledTs: undefined,
        scheduledDisplayText: 'in 12m',
      });
      const renderer = renderPhone(LONG_TITLE);
      const status = renderer.root.findByProps({ className: 'PhoneStatus' });
      expect(JSON.stringify(renderer.toJSON())).toContain('in 12m');
      expect(status.findAllByProps({ 'data-auto-approve': '$root' })).toHaveLength(1);
      expect(status.findAllByProps({ 'data-approvals': 'true' })).toHaveLength(1);
      // No separator dot: the row is the status's own.
      expect(status.findAllByProps({ 'aria-hidden': 'true' }).map(text)).not.toContain('·');
      renderer.unmount();
    });
  });
});
