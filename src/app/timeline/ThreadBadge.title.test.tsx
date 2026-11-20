// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import { ThreadBadge } from './ThreadBadge';

const room = { roomId: '!room:example.org' } as Room;
const title = 'Nightly backup check';
const titledName = `Thread ${title} New · 11 replies`;
const badge = (summaryInfo?: ThreadSummaryInfo, onClick = vi.fn()) => (
  <ThreadBadge
    room={room}
    onClick={onClick}
    model={{
      id: { roomId: room.roomId, threadRootId: '$root' },
      summaryInfo,
      recentThreadSummaryText: '',
      replyCount: 11,
      participantIds: [],
      isResolved: false,
      isUnread: true,
    }}
  />
);

describe('ThreadBadge titles', () => {
  afterEach(cleanup);

  it.each([
    [{ summaryText: title, messageCount: 3 }, 'AI summary of last 3 messages'],
    [{ summaryText: title, isManual: true, messageCount: 3 }, 'Manually edited summary'],
    [{ summaryText: title }, 'AI-generated thread summary'],
    [{ summaryText: title, messageCount: 0 }, 'AI-generated thread summary'],
  ] as const)(
    'puts the title before the count with provenance (%j)',
    (summaryInfo, description) => {
      render(badge(summaryInfo));
      const button = screen.getByRole('button', { name: titledName, description });
      expect(button.textContent).toBe(`${title} New · 11 replies`);
    }
  );

  it.each([undefined, { summaryText: '' }])(
    'keeps the plain reply pill without a title (%j)',
    (summaryInfo) => {
      render(badge(summaryInfo));
      const button = screen.getByRole('button', { name: 'Thread New · 11 replies' });
      expect(button.textContent).toBe('New · 11 replies');
      expect(button.hasAttribute('aria-describedby')).toBe(false);
    }
  );

  it('holds keyboard focus and shows provenance when a title arrives', () => {
    const onClick = vi.fn();
    const { rerender } = render(badge(undefined, onClick));
    const button = screen.getByRole('button');
    act(() => button.focus());
    expect(button.matches(':focus-visible')).toBe(true);
    expect(screen.queryByRole('tooltip')).toBeNull();

    rerender(badge({ summaryText: title }, onClick));
    const description = 'AI-generated thread summary';
    expect(screen.getByRole('button', { name: titledName, description })).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole('tooltip').textContent).toBe(description);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('lets the title set paragraph direction and isolates the metadata in UI direction', () => {
    const html = document.documentElement;
    const previous = html.dir;
    html.dir = 'rtl';
    try {
      render(badge({ summaryText: title }));
      const body = screen.getByText(title).parentElement;
      expect(body?.dir).toBe('auto');
      expect(body?.querySelector('bdi')?.dir).toBe('rtl');
    } finally {
      html.dir = previous;
    }
  });
});
