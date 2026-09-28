import { beforeEach, describe, expect, it, vi } from 'vitest';

const { trimReplyFromBody } = vi.hoisted(() => ({
  trimReplyFromBody: vi.fn((body: string) => body),
}));

vi.mock('../../utils/room', () => ({ trimReplyFromBody }));

const { getLocalizedThreadMessagePreviewText, getThreadMessagePreviewText } = await import(
  './threadMessagePreview'
);

const textContent = (body: string): Record<string, unknown> => ({ msgtype: 'm.text', body });
const t = ((key: string, options?: { count?: number }) =>
  `${key}:${options?.count ?? ''}`) as unknown as Parameters<
  typeof getLocalizedThreadMessagePreviewText
>[1];

describe('thread message preview analysis reuse', () => {
  beforeEach(() => {
    trimReplyFromBody.mockClear();
  });

  it('analyzes a body once across preview and localization passes', () => {
    const body = '🔧 `shell` [1]\n**Pruned** the images and freed 12 GB.';

    const first = getLocalizedThreadMessagePreviewText(textContent(body), t);
    const second = getLocalizedThreadMessagePreviewText(textContent(body), t);

    expect(first).toBe('🔧 sharedUi.threadPreviews.tools:1 · Pruned the images and freed 12 GB.');
    expect(second).toBe(first);
    expect(getThreadMessagePreviewText(textContent(body))).toBe(
      '🔧 1 tool · Pruned the images and freed 12 GB.'
    );
    expect(trimReplyFromBody).toHaveBeenCalledTimes(1);
  });

  it('analyzes each distinct body, such as successive streamed edits', () => {
    expect(getThreadMessagePreviewText(textContent('Streaming reply part one'))).toBe(
      'Streaming reply part one'
    );
    expect(getThreadMessagePreviewText(textContent('Streaming reply part one and two'))).toBe(
      'Streaming reply part one and two'
    );
    expect(trimReplyFromBody).toHaveBeenCalledTimes(2);
  });
});
