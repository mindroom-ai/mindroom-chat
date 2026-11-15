// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { CompactThreadCard } from '../threads/overview/CompactThreadCard';
import {
  SAMPLE_ROOM_ID,
  sampleCard,
  sampleGraphemes,
  sampleName,
  sampleReplyCount,
  sampleRootMessage,
  type SampleCardState,
  type SampleThreadId,
} from './tourSample';

const t = i18next.t.bind(i18next);
const THREADS: SampleThreadId[] = ['launch', 'budget', 'website', 'vendor', 'survey'];
const MINUTE = 60_000;

const renderCard = (id: SampleThreadId, state: SampleCardState = {}, now = Date.now()) => {
  const viewModel = sampleCard(id, state, t, now);
  const { container } = render(
    <CompactThreadCard viewModel={viewModel} onClick={() => undefined} />
  );
  return { viewModel, card: container.querySelector<HTMLElement>('[data-thread-root-id]') };
};

afterEach(cleanup);

describe('tourSample', () => {
  it('gives each thread a card the app can render, with its title and last reply', () => {
    THREADS.forEach((id) => {
      const { viewModel, card } = renderCard(id);
      expect(viewModel.id).toEqual({ roomId: SAMPLE_ROOM_ID, threadRootId: `$tour-${id}` });
      expect(card?.textContent).toContain(t(`tour.sample.${id}Title`));
      expect(card?.textContent).toContain(t(`tour.sample.${id}Reply`));
      expect(card?.getAttribute('aria-label')).toContain(viewModel.titleText);
      expect(viewModel.participants.length).toBeGreaterThan(0);
      cleanup();
    });
  });

  it('titles a new thread with the typed message until its summary is written', () => {
    const typed = sampleCard('launch', { title: 'typed' }, t, Date.now());
    expect(typed.titleText).toBe('Draft the spring launch email');
    expect(typed.primarySummaryText).toBeUndefined();
    const summary = sampleCard('launch', { title: 'summary' }, t, Date.now());
    expect(summary.titleText).toBe('Spring launch email');
    expect(summary.primarySummaryText).toBe('Spring launch email');
    expect(summary.previewText).toBe('Writer: Here is a first draft with three subject lines.');
  });

  it('shows the four states the way the app does', () => {
    const streaming = renderCard('launch', { streaming: true });
    expect(streaming.card?.getAttribute('data-attention-state')).toBe('streaming');
    expect(streaming.card?.textContent).toContain('streaming');
    cleanup();

    const unread = renderCard('budget', { unread: true });
    expect(unread.card?.getAttribute('data-thread-unread')).toBe('true');
    cleanup();

    const resolved = renderCard('website', { resolved: true });
    expect(resolved.card?.querySelector('[data-compact-card-resolved-badge]')).toBeTruthy();
    expect(resolved.viewModel.snoozedUntilTs).toBeUndefined();
    cleanup();

    const snoozed = renderCard('vendor', { snoozed: true });
    expect(snoozed.card?.querySelector('[data-thread-snoozed]')?.textContent).toContain(
      'Snoozed until'
    );
  });

  it('says that a thread nobody answered has no replies yet', () => {
    const { viewModel, card } = renderCard('launch', { title: 'typed', noReplies: true });
    expect(viewModel.messageCount).toBe(0);
    expect(viewModel.previewText).toBe('No replies yet');
    expect(card?.querySelector('[data-compact-card-reply-count]')).toBeNull();
  });

  it('shows tags only when asked, and the new reply of a thread that got one', () => {
    expect(sampleCard('budget', {}, t, Date.now()).tags).toEqual([]);
    expect(sampleCard('budget', { tags: true }, t, Date.now()).tags).toEqual(['finance']);
    const before = sampleCard('vendor', {}, t, Date.now());
    const after = sampleCard('vendor', { replied: true }, t, Date.now());
    expect(after.previewText).toContain('The contract is signed.');
    expect(after.messageCount).toBe(before.messageCount + 1);
  });

  it('counts its times from the clock it is given', () => {
    const now = 1_800_000_000_000;
    THREADS.forEach((id) => {
      const at = sampleCard(id, {}, t, now).lastActivityTs;
      const later = sampleCard(id, {}, t, now + 90 * MINUTE).lastActivityTs;
      expect(at).toBeDefined();
      expect(at).toBeLessThan(now);
      expect((later ?? 0) - (at ?? 0)).toBe(90 * MINUTE);
    });
    expect(sampleCard('vendor', { replied: true }, t, now).lastActivityTs).toBe(now);
    expect(sampleCard('launch', { streaming: true }, t, now).lastActivityTs).toBe(now);
    expect(sampleCard('vendor', { snoozed: true }, t, now).snoozedUntilTs).toBeGreaterThan(now);
    // Newest first, as the list sorts them.
    const ages = (['launch', 'budget', 'vendor', 'website', 'survey'] as const).map(
      (id) => now - (sampleCard(id, {}, t, now).lastActivityTs ?? 0)
    );
    expect(ages).toEqual([...ages].sort((a, b) => a - b));
  });

  it('names the people, and each thread by its first message', () => {
    expect(sampleName('you', t)).toBe('You');
    expect(sampleName('ana', t)).toBe('Ana');
    expect(sampleRootMessage('launch')).toEqual({ sender: 'you', text: 'typed' });
    expect(sampleRootMessage('budget').text).toBe('budgetTitle');
    expect(sampleReplyCount('launch', { noReplies: true })).toBe(0);
    expect(sampleReplyCount('vendor', { replied: true })).toBe(sampleReplyCount('vendor', {}) + 1);
  });

  it('splits a text into what a person sees as its characters', () => {
    const text = 'éa 👨‍👩‍👧!';
    const parts = sampleGraphemes(text);
    expect(parts.join('')).toBe(text);
    expect(parts).toHaveLength(typeof Intl.Segmenter === 'function' ? 5 : Array.from(text).length);
    expect(sampleGraphemes('')).toEqual([]);
  });
});
