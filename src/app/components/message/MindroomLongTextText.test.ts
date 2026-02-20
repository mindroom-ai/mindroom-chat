import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { IEncryptedFile } from '../../../types/matrix/common';
import { MindroomLongTextSource } from './mindroomLongText';

const matrixMocks = vi.hoisted(() => ({
  decryptFile: vi.fn(),
  downloadEncryptedMedia: vi.fn(),
  downloadMedia: vi.fn(),
  mxcUrlToHttp: vi.fn(),
}));

vi.mock('../../utils/matrix', () => ({
  decryptFile: matrixMocks.decryptFile,
  downloadEncryptedMedia: matrixMocks.downloadEncryptedMedia,
  downloadMedia: matrixMocks.downloadMedia,
  mxcUrlToHttp: matrixMocks.mxcUrlToHttp,
}));
vi.mock('./MsgTypeRenderers', () => ({
  MEmote: () => null,
  MNotice: () => null,
  MText: () => null,
}));
vi.mock('folds', () => ({
  Box: () => null,
  Spinner: () => null,
  Text: () => null,
  config: {
    space: {
      S100: '4px',
    },
  },
}));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));
vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

const getDownloadMindroomLongTextSidecarText = async () =>
  (await import('./MindroomLongTextText')).downloadMindroomLongTextSidecarText;
const getDownloadMindroomLongTextSidecarBlob = async () =>
  (await import('./MindroomLongTextText')).downloadMindroomLongTextSidecarBlob;
const getShouldResetResolvedContentToPreview = async () =>
  (await import('./MindroomLongTextText')).shouldResetResolvedContentToPreview;
const mockMx = {} as unknown as MatrixClient;

const createLongTextSource = (
  overrides: Partial<MindroomLongTextSource> = {}
): MindroomLongTextSource => ({
  previewContent: {
    msgtype: 'm.file',
    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
  },
  mxcUri: 'mxc://server/content',
  isV2ContentJson: true,
  ...overrides,
});

describe('downloadMindroomLongTextSidecarText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matrixMocks.mxcUrlToHttp.mockReturnValue(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
  });

  it('downloads unencrypted sidecar content using downloadMedia', async () => {
    const downloadMindroomLongTextSidecarText = await getDownloadMindroomLongTextSidecarText();
    matrixMocks.downloadMedia.mockResolvedValue(
      new Blob([JSON.stringify({ msgtype: 'm.text', body: 'full response' })], {
        type: 'application/json',
      })
    );

    const text = await downloadMindroomLongTextSidecarText(mockMx, createLongTextSource(), false);

    expect(matrixMocks.downloadMedia).toHaveBeenCalledWith(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    expect(matrixMocks.downloadEncryptedMedia).not.toHaveBeenCalled();
    expect(text).toContain('"body":"full response"');
  });

  it('downloads sidecar blob for unencrypted content', async () => {
    const downloadMindroomLongTextSidecarBlob = await getDownloadMindroomLongTextSidecarBlob();
    const blob = new Blob(['raw-content'], { type: 'application/json' });
    matrixMocks.downloadMedia.mockResolvedValue(blob);

    const downloadedBlob = await downloadMindroomLongTextSidecarBlob(
      mockMx,
      createLongTextSource(),
      false
    );

    expect(matrixMocks.downloadMedia).toHaveBeenCalledWith(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    expect(downloadedBlob).toBe(blob);
  });

  it('downloads encrypted sidecar content using downloadEncryptedMedia + decryptFile', async () => {
    const downloadMindroomLongTextSidecarText = await getDownloadMindroomLongTextSidecarText();
    const encryptedFile: IEncryptedFile = {
      url: 'mxc://server/encrypted',
      key: { kty: 'oct', k: 'abc', alg: 'A256CTR', key_ops: ['encrypt', 'decrypt'] },
      iv: 'iv',
      hashes: { sha256: 'hash' },
      v: 'v2',
    };

    matrixMocks.mxcUrlToHttp.mockReturnValue(
      'https://example.org/_matrix/media/v3/download/server/encrypted'
    );
    matrixMocks.decryptFile.mockResolvedValue(
      new Blob([JSON.stringify({ msgtype: 'm.text', body: 'decrypted response' })], {
        type: 'application/json',
      })
    );
    matrixMocks.downloadEncryptedMedia.mockImplementation(
      async (_url: string, decryptContent: (buf: ArrayBuffer) => Promise<Blob>) =>
        decryptContent(new ArrayBuffer(32))
    );

    const text = await downloadMindroomLongTextSidecarText(
      mockMx,
      createLongTextSource({
        previewContent: {
          msgtype: 'm.file',
          info: { mimetype: 'application/json' },
          'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        },
        mxcUri: 'mxc://server/encrypted',
        encryptedFile,
      }),
      true
    );

    expect(matrixMocks.downloadEncryptedMedia).toHaveBeenCalledWith(
      'https://example.org/_matrix/media/v3/download/server/encrypted',
      expect.any(Function)
    );
    expect(matrixMocks.decryptFile).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      'application/json',
      encryptedFile
    );
    expect(matrixMocks.downloadMedia).not.toHaveBeenCalled();
    expect(text).toContain('"body":"decrypted response"');
  });
});

describe('shouldResetResolvedContentToPreview', () => {
  it('keeps previously hydrated rich content when preview has no formatted body', async () => {
    const shouldResetResolvedContentToPreview = await getShouldResetResolvedContentToPreview();

    const shouldReset = shouldResetResolvedContentToPreview(
      {
        msgtype: 'm.file',
        body: 'preview only',
      },
      {
        msgtype: 'm.text',
        body: 'resolved body',
        formatted_body: '<p><strong>resolved body</strong></p>',
      }
    );

    expect(shouldReset).toBe(false);
  });

  it('resets when incoming preview includes formatted body', async () => {
    const shouldResetResolvedContentToPreview = await getShouldResetResolvedContentToPreview();

    const shouldReset = shouldResetResolvedContentToPreview(
      {
        msgtype: 'm.text',
        body: 'preview',
        formatted_body: '<p>preview</p>',
      },
      {
        msgtype: 'm.text',
        body: 'older body',
        formatted_body: '<p>older</p>',
      }
    );

    expect(shouldReset).toBe(true);
  });

  it('resets when there is no previously hydrated formatted body', async () => {
    const shouldResetResolvedContentToPreview = await getShouldResetResolvedContentToPreview();

    const shouldReset = shouldResetResolvedContentToPreview(
      {
        msgtype: 'm.file',
        body: 'preview only',
      },
      {
        msgtype: 'm.file',
        body: 'still preview',
      }
    );

    expect(shouldReset).toBe(true);
  });
});
