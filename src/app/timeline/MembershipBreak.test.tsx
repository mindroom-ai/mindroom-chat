// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import enAdditions from '../i18n/locales/additions/en.json';
import nlAdditions from '../i18n/locales/additions/nl.json';
import type { MembershipFoldSummary } from './membershipFolds';
import { MembershipBreak } from './MembershipBreak';

vi.mock('./TurnBreak.css', () => ({
  TurnBreak: 'TurnBreak',
  MembershipBreak: 'MembershipBreak',
  Line: 'Line',
  Pill: 'Pill',
  MembershipPill: 'MembershipPill',
  PillLabel: 'PillLabel',
  Chevron: 'Chevron',
  Dots: 'Dots',
}));

const emptySummary = (overrides: Partial<MembershipFoldSummary> = {}): MembershipFoldSummary => ({
  total: 0,
  joined: 0,
  left: 0,
  invited: 0,
  requested: 0,
  kicked: 0,
  banned: 0,
  unbanned: 0,
  profileChanges: 0,
  ...overrides,
});

describe('MembershipBreak', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const renderBreak = (summary: MembershipFoldSummary, open: boolean, onToggle = vi.fn()) => {
    act(() => {
      renderer = create(<MembershipBreak summary={summary} open={open} onToggle={onToggle} />);
    });
    const wrapper = renderer!.root.findByProps({ 'data-membership-break': true });
    const button = wrapper.findByType('button');
    const label = button.findByProps({ className: 'PillLabel' }).children.join('');
    const chevron = button.findByProps({ className: 'Chevron' });
    return { wrapper, button, label, chevron };
  };

  it('shows just the bucket label for a single-kind run with no duplicates', () => {
    const { button, label, chevron } = renderBreak(emptySummary({ total: 5, joined: 5 }), false);
    expect(label).toBe('5 joined');
    expect(button.props.className).toBe('MembershipPill');
    expect(button.props.title).toBeUndefined();
    expect(button.props['aria-expanded']).toBe(false);
    expect(chevron.props['aria-hidden']).toBe(true);
    expect(chevron.children).toEqual(['▾']);
  });

  it('shows total and deduplicated details for multi-kind or deduplicated runs', () => {
    const multi = renderBreak(emptySummary({ total: 17, joined: 11, left: 1, banned: 1 }), false);
    expect(multi.label).toBe('17 room events · 11 joined, 1 left, 1 banned');

    act(() => renderer?.unmount());
    const deduped = renderBreak(emptySummary({ total: 5, joined: 3 }), false);
    expect(deduped.label).toBe('5 room events · 3 joined');
  });

  it('falls back to total room events when no bucket is non-zero', () => {
    const { button, label } = renderBreak(emptySummary({ total: 4 }), false);
    expect(label).toBe('4 room events');
    expect(button.props.title).toBeUndefined();
  });

  it('offers to hide the events when expanded', () => {
    const { button, label, chevron } = renderBreak(
      emptySummary({ total: 17, joined: 11, left: 1, banned: 1 }),
      true
    );
    expect(label).toBe('Hide 17 room events');
    expect(button.props.title).toBeUndefined();
    expect(button.props['aria-expanded']).toBe(true);
    expect(chevron.children).toEqual(['▴']);
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    const { button } = renderBreak(emptySummary({ total: 3, joined: 3 }), false, onToggle);
    act(() => {
      button.props.onClick();
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('updates its localized text live when switching from en to nl', async () => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      resources: {
        en: { translation: enAdditions },
        nl: { translation: nlAdditions },
      },
    });
    const summary = emptySummary({ total: 6, joined: 3, left: 1, banned: 1 });

    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <MembershipBreak summary={summary} open={false} onToggle={vi.fn()} />
        </I18nextProvider>
      );
    });
    expect(renderer!.root.findByProps({ className: 'PillLabel' }).children.join('')).toBe(
      '6 room events · 3 joined, 1 left, 1 banned'
    );

    await act(async () => {
      await language.changeLanguage('nl');
    });
    expect(renderer!.root.findByProps({ className: 'PillLabel' }).children.join('')).toBe(
      '6 kamergebeurtenissen · 3 lid geworden, 1 vertrokken, 1 verbannen'
    );
  });
});
