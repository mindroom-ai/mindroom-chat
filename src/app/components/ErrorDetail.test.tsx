import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MatrixError } from 'matrix-js-sdk';
import { ErrorDetail } from './ErrorDetail';

describe('ErrorDetail', () => {
  it("shows the error's own text in its own direction, lined up with the sentence above", () => {
    const html = renderToStaticMarkup(
      <ErrorDetail error={new MatrixError({ errcode: 'M_FORBIDDEN', error: 'Not allowed' }, 403)} />
    );

    expect(html).toMatch(/^<span [^>]*dir="auto"/);
    expect(html).toContain('text-align:match-parent');
    expect(html).toContain('>M_FORBIDDEN: Not allowed</span>');
  });

  it('renders nothing when the error has no text worth showing', () => {
    expect(renderToStaticMarkup(<ErrorDetail error={new TypeError('Failed to fetch')} />)).toBe('');
    expect(renderToStaticMarkup(<ErrorDetail error={undefined} />)).toBe('');
  });
});
