import { describe, expect, it } from 'vitest';
import { withPageFraming } from './serviceWorkerFraming';

// The cached app shell carries index.html's headers, which let this origin frame the page.
const shell = () =>
  new Response('<!doctype html><title>app</title>', {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
      'Content-Security-Policy': "frame-ancestors 'self'",
      'X-Frame-Options': 'SAMEORIGIN',
    },
  });

describe('withPageFraming', () => {
  it('gives the pairing page its own framing headers, in any spelling, and keeps the rest', async () => {
    for (const url of [
      'https://chat.example/connect/?code=ABCD-1234',
      'https://chat.example/CONNECT',
      'https://chat.example/%63onnect/',
    ]) {
      const answer = withPageFraming(url, shell());
      expect(answer.headers.get('Content-Security-Policy'), url).toBe("frame-ancestors 'none'");
      expect(answer.headers.get('X-Frame-Options'), url).toBe('DENY');
      expect(answer.headers.get('Content-Type'), url).toBe('text/html');
      expect(answer.status, url).toBe(200);
      // eslint-disable-next-line no-await-in-loop
      expect(await answer.text(), url).toContain('<title>app</title>');
    }
  });

  it('passes every other page as it is', () => {
    for (const url of ['https://chat.example/', 'https://chat.example/home/?next=/connect']) {
      const response = shell();
      expect(withPageFraming(url, response), url).toBe(response);
    }
  });

  it('passes answers whose headers a worker cannot read', () => {
    const opaque = Response.error();
    expect(opaque.type).toBe('error');
    expect(withPageFraming('https://chat.example/connect', opaque)).toBe(opaque);
  });
});
