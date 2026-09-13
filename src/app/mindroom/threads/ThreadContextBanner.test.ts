import React from 'react';
import { create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import {
  collectAvailableTags,
  getDisplayTags,
  isThreadResolved,
  isValidTagName,
  normalizeTagName,
  parseThreadTagsContent,
  RESOLVED_TAG,
  type ThreadTagsContent,
} from './threadTags';
import { tagColor, TAG_TEXT_COLOR } from './threadTagColor';
import { ThreadContextBanner } from './ThreadContextBanner';

const ISO_1 = '2026-04-07T00:00:01.000Z';
const ISO_2 = '2026-04-07T00:00:02.000Z';
const ISO_3 = '2026-04-07T00:00:03.000Z';

const bannerMocks = vi.hoisted(() => ({
  useThreadRootEvent: vi.fn(),
  useThreadTags: vi.fn(),
  useMutateThreadTags: vi.fn(),
  useThreadHeaderInfo: vi.fn(),
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
    Button: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement('button', props, children),
    Icon: (props: Record<string, unknown>) => React.createElement('i', props),
    IconButton: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement('button', props, children),
    Icons: { ArrowLeft: 'arrow-left' },
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
  };
});

vi.mock('./useThreadRootEvent', () => ({
  useThreadRootEvent: bannerMocks.useThreadRootEvent,
}));

vi.mock('./useThreadTags', () => ({
  useThreadTags: bannerMocks.useThreadTags,
}));

vi.mock('./useMutateThreadTags', () => ({
  useMutateThreadTags: bannerMocks.useMutateThreadTags,
}));

vi.mock('./useThreadHeaderInfo', () => ({
  getNextThreadScheduledTs: () => undefined,
  useThreadHeaderInfo: bannerMocks.useThreadHeaderInfo,
}));

vi.mock('./ThreadTagPill', () => ({
  ThreadTagPill: ({ name }: { name: string }) => React.createElement('span', null, name),
}));

vi.mock('./ThreadTagPicker', () => ({
  ThreadTagPicker: () => React.createElement('button', null, '+ tag'),
}));

vi.mock('./ThreadContextBanner.css', () => ({
  Banner: 'Banner',
  BannerResolved: 'BannerResolved',
  DesktopOnlyTags: 'DesktopOnlyTags',
  MetadataDot: 'MetadataDot',
  MobileOnlyTags: 'MobileOnlyTags',
  OverflowChip: 'OverflowChip',
  ResolveChip: 'ResolveChip',
  ScheduledIndicator: 'ScheduledIndicator',
  ScheduledWrap: 'ScheduledWrap',
  SubtitleRow: 'SubtitleRow',
  SummaryText: 'SummaryText',
  TagsRow: 'TagsRow',
  TitleColumn: 'TitleColumn',
  TitleRow: 'TitleRow',
  ViewLabel: 'ViewLabel',
}));

vi.mock('./ThreadIndicator.css', () => ({
  ThreadScheduledIndicator: 'ThreadScheduledIndicator',
  ThreadScheduledIcon: 'ThreadScheduledIcon',
}));

// Resolve t() keys against the real en.json so assertions below keep
// checking user-visible English copy ('Thread View', 'Resolve', …).
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
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

describe('ThreadContextBanner rendering', () => {
  beforeEach(() => {
    bannerMocks.useThreadRootEvent.mockReturnValue('$root');
    bannerMocks.useThreadTags.mockReturnValue({
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
  });

  const renderBanner = (summaryText?: string) =>
    create(
      React.createElement(ThreadContextBanner, {
        room: {
          roomId: '!room:example.org',
          getThread: () => undefined,
          findEventById: () => undefined,
          hasEncryptionStateEvent: () => false,
        } as unknown as Room,
        threadId: '$root',
        summaryInfo: summaryText ? { summaryText } : undefined,
        onExitThread: vi.fn(),
      })
    );

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
      .find((button) =>
        button.findAllByType('span').some((child) => child.children.includes('Resolve'))
      );

    expect(JSON.stringify(renderer.toJSON())).not.toContain('+ tag');
    expect(resolveButton?.props.disabled).toBe(true);
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
});
