// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STREAM_IDLE_LIMIT_MS } from '../matrix/client/streamingReplies';
import { Time } from './Time';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn, i18n: { language: 'en' } }) };
});
vi.mock('./Time.css', () => ({
  ReplyTime: 'ReplyTime',
  Fold: 'Fold',
  FoldText: 'FoldText',
  Live: 'Live',
  Dot: 'Dot',
}));

const at = (hour: number, minute: number, second = 0) =>
  new Date(2026, 2, 5, hour, minute, second).getTime();
const START = at(10, 4, 12);

const timeOf = (container: HTMLElement) => container.querySelector('time') as HTMLElement;
const folded = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-reply-time-fold]')].map((fold) => fold.textContent);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(at(12, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Time', () => {
  it('shows only the start of a message without a known finish', () => {
    const { container } = render(<Time ts={START} hour24Clock />);
    const time = timeOf(container);
    expect(time.textContent).toBe('10:04');
    expect(time.title).toBe('5 Mar 2026 10:04:12');
    expect(time.tabIndex).toBe(-1);
    expect(folded(container)).toEqual([]);
  });

  it('shows the duration after the start of a finished reply, with the rest folded', () => {
    const timing = { startTs: START, endTs: at(10, 11, 24), streaming: false };
    const { container } = render(<Time ts={START} timing={timing} hour24Clock />);
    const time = timeOf(container);
    expect(folded(container)).toEqual(['\u00a0–\u00a010:11', '\u00a012s']);
    expect(time.textContent).toBe('10:04\u00a0–\u00a010:11\u00a0·\u00a07m\u00a012s');
    expect(time.title).toBe(
      ['Started 5 Mar 2026 10:04:12', 'Finished 5 Mar 2026 10:11:24', 'Duration 7m\u00a012s'].join(
        '\n'
      )
    );
  });

  it('unfolds on a tap and folds again on the next one or when the focus leaves', () => {
    const timing = { startTs: START, endTs: at(10, 11, 24), streaming: false };
    const { container } = render(<Time ts={START} timing={timing} hour24Clock />);
    const time = timeOf(container);
    expect(time.tabIndex).toBe(0);
    expect(time.hasAttribute('data-open')).toBe(false);
    fireEvent.click(time);
    expect(time.hasAttribute('data-open')).toBe(true);
    fireEvent.click(time);
    expect(time.hasAttribute('data-open')).toBe(false);
    fireEvent.click(time);
    fireEvent.blur(time);
    expect(time.hasAttribute('data-open')).toBe(false);
  });

  it('leaves out the finish of a reply that ends in the minute it started', () => {
    const timing = { startTs: at(10, 2, 1), endTs: at(10, 2, 5), streaming: false };
    const { container } = render(<Time ts={at(10, 2, 1)} timing={timing} hour24Clock />);
    expect(timeOf(container).textContent).toBe('10:02\u00a0·\u00a04s');
    expect(folded(container)).toEqual([]);
  });

  it('counts a streaming reply up every second, ending now', () => {
    vi.setSystemTime(START + 134_000);
    const timing = { startTs: START, streaming: true, revisionTs: START + 60_000 };
    const { container } = render(<Time ts={START} timing={timing} hour24Clock />);
    const time = timeOf(container);
    expect(container.querySelector('[data-reply-time-live]')).not.toBeNull();
    expect(time.textContent).toBe('10:04\u00a0–\u00a0now\u00a0·\u00a02m\u00a014s');
    expect(time.title).toContain('Still streaming');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(time.textContent).toBe('10:04\u00a0–\u00a0now\u00a0·\u00a02m\u00a015s');
    expect(time.title).toContain('Duration 2m\u00a015s');
  });

  it('turns a streaming reply back to its plain time once its newest revision goes stale', () => {
    vi.setSystemTime(START + STREAM_IDLE_LIMIT_MS);
    const timing = { startTs: START, streaming: true, revisionTs: START };
    const { container } = render(<Time ts={START} timing={timing} hour24Clock />);
    const time = timeOf(container);
    expect(container.querySelector('[data-reply-time-live]')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(container.querySelector('[data-reply-time-live]')).toBeNull();
    expect(time.textContent).toBe('10:04');
    expect(time.title).toBe('5 Mar 2026 10:04:12');
  });
});
