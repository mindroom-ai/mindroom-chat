import { MatrixError } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  getMatrixUploadErrorMessage,
  getMatrixUploadOriginalName,
  isTransientMatrixError,
  toMatrixUploadError,
  uploadContent,
} from './matrix';

const transientMessage = "Couldn't send — your connection dropped. Try again.";

describe('matrix upload errors', () => {
  it('classifies transient upload errors narrowly', () => {
    expect(
      isTransientMatrixError(new DOMException('The operation was aborted.', 'AbortError'))
    ).toBe(true);
    expect(isTransientMatrixError(new MatrixError({ error: 'Unknown message' }))).toBe(true);
    expect(isTransientMatrixError(new MatrixError({ errcode: 'M_UNKNOWN', error: '' }))).toBe(true);
    expect(
      isTransientMatrixError(new MatrixError({ errcode: 'M_LIMIT_EXCEEDED', error: '' }))
    ).toBe(false);
    expect(isTransientMatrixError(new MatrixError({ errcode: 'M_UNKNOWN', error: '' }, 413))).toBe(
      false
    );
    expect(isTransientMatrixError(new Error('Load failed'))).toBe(false);
  });

  it('preserves existing MatrixError instances while normalizing other upload errors', () => {
    const existing = new MatrixError({ errcode: 'M_FORBIDDEN', error: 'Nope' }, 403);

    expect(toMatrixUploadError(existing, 'upload')).toBe(existing);

    const normalized = toMatrixUploadError(
      new DOMException('The operation was aborted.', 'AbortError'),
      'upload'
    );
    expect(normalized).toBeInstanceOf(MatrixError);
    expect(normalized.errcode).toBe('M_UNKNOWN');
    expect(normalized.message).toContain('The operation was aborted.');
    expect(getMatrixUploadOriginalName(normalized)).toBe('AbortError');
  });

  it('preserves HTTP 413 status when normalizing non-JSON upload errors', () => {
    const httpTooLarge = Object.assign(new Error('Server returned 413 error'), {
      httpStatus: 413,
    });

    const normalized = toMatrixUploadError(httpTooLarge, 'upload');

    expect(normalized).toBeInstanceOf(MatrixError);
    expect(normalized.errcode).toBe('M_TOO_LARGE');
    expect(normalized.httpStatus).toBe(413);
    expect(normalized.message).toContain('Server returned 413 error');
  });

  it('returns friendly upload display messages', () => {
    expect(
      getMatrixUploadErrorMessage(new MatrixError({ errcode: 'M_UNKNOWN', error: '' }), 'upload')
    ).toBe(transientMessage);
    expect(
      getMatrixUploadErrorMessage(
        new MatrixError({ errcode: 'M_LIMIT_EXCEEDED', error: 'Too many uploads' })
      )
    ).toBe('M_LIMIT_EXCEEDED: Too many uploads');
    expect(getMatrixUploadErrorMessage(undefined)).toBe("Couldn't send. Try again.");
  });

  it('returns precise avatar too-large upload messages', () => {
    const matrixTooLarge = new MatrixError({ errcode: 'M_UNKNOWN', error: '' }, 413);
    const rawHttpTooLarge = Object.assign(new Error('Server returned 413 error'), {
      httpStatus: 413,
    });

    expect(
      getMatrixUploadErrorMessage(matrixTooLarge, 'upload', {
        uploadKind: 'avatar',
        fileSize: 2_500_000,
        maxUploadSize: 1_000_000,
      })
    ).toBe('Avatar image is too large. Maximum upload size is 1.0 MB; selected file is 2.5 MB.');
    expect(
      getMatrixUploadErrorMessage(rawHttpTooLarge, 'upload', {
        uploadKind: 'avatar',
      })
    ).toBe('Avatar image is too large for this server. Choose a smaller image.');
    expect(getMatrixUploadErrorMessage(matrixTooLarge, 'upload')).not.toBe(transientMessage);
  });

  it('does not use transient network copy for create-stage normalized errors', () => {
    const normalized = toMatrixUploadError(new Error('create failed'), 'create');

    expect(getMatrixUploadErrorMessage(normalized)).toBe("Couldn't prepare voice message.");
    expect(getMatrixUploadErrorMessage(normalized)).not.toBe(transientMessage);
  });

  it('normalizes uploadContent aborts without copying the human message into errcode', async () => {
    const onError = vi.fn();
    const uploadAbort = new DOMException('The operation was aborted.', 'AbortError');
    const mx = {
      uploadContent: vi.fn(() => Promise.reject(uploadAbort)),
    };

    await uploadContent(mx as never, new Blob(['file']), {
      onSuccess: vi.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toMatchObject({
      errcode: 'M_UNKNOWN',
      message: expect.stringContaining('The operation was aborted.'),
    });
  });
});
