import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useAttachmentSave } from './attachmentDownload';

const mocks = vi.hoisted(() => ({
  saveFile: vi.fn<(blob: Blob, fileName: string) => Promise<boolean>>(async () => true),
  downloadCachedAttachment: vi.fn(
    async (_mx: unknown, { mimeType }: { mimeType?: string }) =>
      new Blob(['<script>alert(1)</script>'], { type: mimeType })
  ),
}));

vi.mock('../../mindroom/native/nativeFileSave', () => ({ saveFile: mocks.saveFile }));
vi.mock('../../mindroom/messages/attachmentRepository', () => ({
  downloadCachedAttachment: mocks.downloadCachedAttachment,
}));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));

describe('useAttachmentSave', () => {
  it.each(['text/html', 'image/svg+xml', 'application/pdf'])(
    'saves a %s attachment typed application/octet-stream',
    async (mimeType) => {
      let save!: () => Promise<boolean | undefined>;
      function Harness() {
        [, save] = useAttachmentSave({ url: 'mxc://example.org/file', mimeType }, 'page.html');
        return null;
      }
      act(() => {
        create(React.createElement(Harness));
      });

      await act(async () => {
        await expect(save()).resolves.toBe(true);
      });

      expect(mocks.downloadCachedAttachment).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          mxcUri: 'mxc://example.org/file',
          mimeType: 'application/octet-stream',
        })
      );
      const saved = mocks.saveFile.mock.lastCall?.[0];
      expect(mocks.saveFile.mock.lastCall?.[1]).toBe('page.html');
      expect(saved?.type).toBe('application/octet-stream');
      expect(await saved?.text()).toBe('<script>alert(1)</script>');
    }
  );
});
