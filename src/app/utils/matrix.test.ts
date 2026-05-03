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
