import { describe, expect, it } from 'vitest';
import { precacheFetchPlugin } from './swPrecacheFetch';

const ORIGIN = 'https://app.example';

describe('precache downloads', () => {
  it('download the crypto wasm past the HTTP cache, keeping its integrity check', async () => {
    const request = new Request(`${ORIGIN}/assets/matrix_sdk_crypto_wasm_bg-DQQaknxI.wasm`, {
      integrity: 'sha384-abc',
      credentials: 'same-origin',
    });
    const sent = await precacheFetchPlugin.requestWillFetch({ request });
    expect(sent.cache).toBe('no-store');
    expect(sent.integrity).toBe('sha384-abc');
    expect(sent.url).toBe(request.url);
  });

  it('leave every other file to the HTTP cache', async () => {
    const request = new Request(`${ORIGIN}/assets/index-Ch1Y9ep2.js`);
    expect(await precacheFetchPlugin.requestWillFetch({ request })).toBe(request);
  });
});
