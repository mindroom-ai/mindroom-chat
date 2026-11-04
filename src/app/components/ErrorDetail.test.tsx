import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MatrixError } from 'matrix-js-sdk';
import { ErrorDetail } from './ErrorDetail';

describe('ErrorDetail', () => {
  it("shows the error's own text isolated in its own direction, as a line of its own", () => {
    const html = renderToStaticMarkup(
      <ErrorDetail error={new MatrixError({ errcode: 'M_FORBIDDEN', error: 'Not allowed' }, 403)} />
    );

    // No `dir` on the line itself: it lines up with the sentence in the interface's direction.
    expect(html).toMatch(/^<span [^>]*style="display:block/);
    expect(html).not.toMatch(/^<span [^>]*dir=/);
    expect(html).toContain('<bdi>M_FORBIDDEN: Not allowed</bdi>');
  });

  it('renders nothing when the error has no text worth showing', () => {
    expect(renderToStaticMarkup(<ErrorDetail error={new TypeError('Failed to fetch')} />)).toBe('');
    expect(renderToStaticMarkup(<ErrorDetail error={undefined} />)).toBe('');
  });
});
