import { afterEach, describe, expect, it, vi } from 'vitest';

const find = vi.hoisted(() => vi.fn());
vi.mock('linkifyjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('linkifyjs')>();
  find.mockImplementation(actual.find);
  return { ...actual, find };
});

const { getBodyUrls } = await import('./bodyUrls');

afterEach(() => find.mockClear());

describe('getBodyUrls', () => {
  it('lists each http(s) URL once, in order, and skips other links', () => {
    expect(
      getBodyUrls('See https://a.example/x and mail me@example.org, then https://a.example/x again')
    ).toEqual(['https://a.example/x']);
    expect(getBodyUrls('http://b.example then example.org')).toEqual([
      'http://b.example',
      'http://example.org',
    ]);
  });

  it('tokenizes a body once, however often its message renders', () => {
    const body = `A reply that renders on every row update ${Math.random()} https://c.example`;
    const first = getBodyUrls(body);
    expect(getBodyUrls(body)).toBe(first);
    expect(getBodyUrls(body)).toEqual(['https://c.example']);
    expect(find).toHaveBeenCalledTimes(1);
  });
});
