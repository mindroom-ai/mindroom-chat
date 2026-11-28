// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AttachmentByteLimitError,
  downloadCachedAttachment,
} from '../../event-store/cache/attachmentRepository';
import { copyToClipboard } from '../../lib/dom';
import { MAX_TEXT_HIGHLIGHT_LENGTH } from '../../rich-text/code/codeHighlightLimits';
import { InlineFilePreview } from './InlineFilePreview';

vi.mock('../../event-store/cache/attachmentRepository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../event-store/cache/attachmentRepository')>()),
  downloadCachedAttachment: vi.fn(),
}));
vi.mock('../../lib/dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/dom')>()),
  copyToClipboard: vi.fn(async () => true),
}));
vi.mock('focus-trap-react', () => ({
  FocusTrap: ({ children }: { children: ReactNode }) => children,
}));

const download = vi.mocked(downloadCachedAttachment);
const client = createClient({
  baseUrl: 'https://matrix.example.org',
  userId: '@reader:example.org',
});
const body = 'aurora\u202e.patch';
const shownName = 'aurora<U+202E>.patch';
const open = `Open ${shownName}`;
const downloadName = `Download ${shownName}`;
const url = 'mxc://example.org/aurora';
const fullView = 'Full view';
const manualLimit = 1_048_576;
const oversizeSource = 'x'.repeat(manualLimit + 1);
const diff = '--- a/orbit.txt\n+++ b/orbit.txt\n@@ -1,3 +1,3 @@\n-old\n+new\u202e\n context\n';

const card = (size: number | undefined, autoPreview = true, sourceUrl = url) => (
  <InlineFilePreview
    client={client}
    body={body}
    mimeType="application/octet-stream"
    url={sourceUrl}
    size={size}
    autoPreview={autoPreview}
    renderRow={(actions) => <div>{actions}</div>}
  >
    <button type="button">{downloadName}</button>
  </InlineFilePreview>
);

const embedded = (container: HTMLElement) => container.querySelector('[data-code-block-embedded]');
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const dialog = () => screen.findByRole('dialog', { name: shownName });
const provideFile = (text = diff) =>
  download.mockImplementationOnce(() => new Response(text).blob());

const deferredFile = () => {
  let resolve!: (blob: Blob) => void;
  const promise = new Promise<Blob>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};

beforeEach(() => {
  download.mockReset();
});
afterEach(cleanup);

it('loads a small diff once, retains it when hidden, and shares it with both full view actions', async () => {
  const response = deferredFile();
  download.mockReturnValueOnce(response.promise);
  const { container } = render(card(diff.length));

  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(download).toHaveBeenCalledExactlyOnceWith(
    client,
    expect.objectContaining({ mxcUri: url }),
    { signal: expect.any(AbortSignal), maxBytes: MAX_TEXT_HIGHLIGHT_LENGTH }
  );
  expect(screen.getByRole('button', { name: open }).closest('[data-file-actions]')).toBeTruthy();
  expect(screen.getByRole('button', { name: downloadName })).toBeTruthy();

  await act(async () => response.resolve(await new Response(diff).blob()));
  expect(embedded(container)?.querySelector('code')?.textContent).toContain('+new<U+202E>');
  expect(screen.getByRole('region', { name: 'Code' }).style.maxHeight).toBe('7.5em');
  click('Copy code');
  await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(diff));

  click('Hide preview');
  expect(embedded(container)).toBeNull();
  click(open);
  const opened = await dialog();
  expect(opened.querySelector('code')?.textContent).toContain('+new<U+202E>');
  fireEvent.click(within(opened).getByRole('button', { name: 'Close' }));

  click('Preview');
  expect(embedded(container)).not.toBeNull();
  click(fullView);
  expect(await dialog()).toBeTruthy();
  expect(download).toHaveBeenCalledOnce();
});

it.each([
  ['over the automatic limit', MAX_TEXT_HIGHLIGHT_LENGTH + 1, true],
  ['unknown size', undefined, true],
  ['zero size', 0, true],
  ['auto-load off', 400, false],
])('leaves %s as one row until Preview is clicked', async (_case, size, autoPreview) => {
  provideFile();
  const { container } = render(card(size, autoPreview));

  expect(embedded(container)).toBeNull();
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  expect(download).not.toHaveBeenCalled();

  click('Preview');
  await waitFor(() => expect(embedded(container)).not.toBeNull());
  expect(download).toHaveBeenCalledExactlyOnceWith(
    client,
    expect.objectContaining({ mxcUri: url }),
    { signal: expect.any(AbortSignal), maxBytes: manualLimit }
  );
});

it('drops source actions when bytes look binary but keeps Download', async () => {
  provideFile('header\0binary');
  const { container } = render(card(400));

  await waitFor(() => expect(screen.queryByRole('button', { name: open })).toBeNull());
  expect(screen.queryByRole('button', { name: /preview/i })).toBeNull();
  expect(screen.getByRole('button', { name: downloadName })).toBeTruthy();
  expect(embedded(container)).toBeNull();
});

it('goes directly to the viewer for a known file over 1 MiB', async () => {
  provideFile(oversizeSource);
  const { container } = render(card(manualLimit + 1));
  expect(download).not.toHaveBeenCalled();

  click(open);
  expect(await dialog()).toBeTruthy();
  expect(embedded(container)).toBeNull();
  expect(download).toHaveBeenCalledExactlyOnceWith(
    client,
    expect.objectContaining({ mxcUri: url }),
    { signal: expect.any(AbortSignal) }
  );
});

it('opens an unknown-size file without a bounded probe and drops oversized text on close', async () => {
  provideFile(oversizeSource);
  provideFile(oversizeSource);
  render(card(undefined));

  click(open);
  const opened = await dialog();
  expect(download).toHaveBeenCalledExactlyOnceWith(
    client,
    expect.objectContaining({ mxcUri: url }),
    { signal: expect.any(AbortSignal) }
  );
  fireEvent.click(within(opened).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();

  click(open);
  expect(await dialog()).toBeTruthy();
  expect(download).toHaveBeenCalledTimes(2);
});

it('reuses a small unknown-size file for Preview after opening it directly', async () => {
  provideFile();
  const { container } = render(card(undefined));
  click(open);
  const opened = await dialog();
  fireEvent.click(within(opened).getByRole('button', { name: 'Close' }));

  click('Preview');
  expect(embedded(container)).not.toBeNull();
  expect(download).toHaveBeenCalledOnce();
});

it('falls back to the full viewer only when the manual byte limit is exceeded', async () => {
  download.mockRejectedValueOnce(new AttachmentByteLimitError(manualLimit));
  provideFile(oversizeSource);
  const { container } = render(card(undefined));

  click('Preview');
  expect(await dialog()).toBeTruthy();
  expect(embedded(container)).toBeNull();
  expect(download.mock.calls.map(([, , options]) => options?.maxBytes)).toEqual([
    manualLimit,
    undefined,
  ]);
});

it('folds after an automatic limit failure and retries bounded after a manual network failure', async () => {
  download.mockRejectedValueOnce(new AttachmentByteLimitError(MAX_TEXT_HIGHLIGHT_LENGTH));
  download.mockRejectedValueOnce(new Error('Network unavailable'));
  provideFile();
  const { container } = render(card(400));

  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
  await waitFor(() => expect(embedded(container)).not.toBeNull());
  expect(download.mock.calls.map(([, , options]) => options?.maxBytes)).toEqual([
    MAX_TEXT_HIGHLIGHT_LENGTH,
    manualLimit,
    manualLimit,
  ]);
});

it('aborts on replacement and unmount, discarding a late result', async () => {
  const stale = deferredFile();
  const pending = deferredFile();
  download.mockReturnValueOnce(stale.promise).mockReturnValueOnce(pending.promise);
  const { container, rerender, unmount } = render(card(400));
  const firstSignal = download.mock.calls[0]?.[2]?.signal;

  rerender(card(undefined, true, 'mxc://example.org/aurora-edited'));
  expect(firstSignal?.aborted).toBe(true);
  await act(async () => stale.resolve(await new Response('old source').blob()));
  expect(embedded(container)).toBeNull();
  expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();

  click('Preview');
  const secondSignal = download.mock.calls[1]?.[2]?.signal;
  unmount();
  expect(secondSignal?.aborted).toBe(true);
});
