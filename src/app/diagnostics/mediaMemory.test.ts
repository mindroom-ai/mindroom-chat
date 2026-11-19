// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMemoryHooks, readMediaMemory, readWasmMemoryMb } from './mediaMemory';

// A module that exports one memory of 16 pages (1 MiB).
const WASM_WITH_MEMORY = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x05, 0x03, 0x01, 0x00, 0x10, 0x07, 0x07, 0x01,
  0x03, 0x6d, 0x65, 0x6d, 0x02, 0x00,
]);

let nextUrl = 0;
const createObjectURL = vi.fn(() => `blob:test/${(nextUrl += 1)}`);
const revokeObjectURL = vi.fn();

describe('media memory', () => {
  let uninstall: () => void;

  beforeEach(() => {
    // jsdom has no object URLs; the hooks wrap whatever the page has when they install.
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    createObjectURL.mockClear();
    uninstall = installMemoryHooks();
    // A second install while installed changes nothing.
    expect(installMemoryHooks()).toBe(uninstall);
  });

  afterEach(() => {
    uninstall();
    document.body.replaceChildren();
  });

  it('puts the original functions back and forgets what it saw once uninstalled', async () => {
    const { instantiate, instantiateStreaming } = WebAssembly;
    await WebAssembly.instantiate(WASM_WITH_MEMORY);
    URL.createObjectURL(new Blob(['x']));

    uninstall();

    expect(URL.createObjectURL).toBe(createObjectURL);
    expect(URL.revokeObjectURL).toBe(revokeObjectURL);
    expect(WebAssembly.instantiate).not.toBe(instantiate);
    expect(WebAssembly.instantiateStreaming).not.toBe(instantiateStreaming);
    expect(readWasmMemoryMb()).toBeUndefined();
    expect(readMediaMemory()).toMatchObject({ object_urls: 0, object_url_mb: 0 });
  });

  it('reports no WebAssembly memory before a module loads, then the size of its memory', async () => {
    expect(readWasmMemoryMb()).toBeUndefined();

    const { instance } = await WebAssembly.instantiate(WASM_WITH_MEMORY);
    expect(readWasmMemoryMb()).toBe(1);

    // Growing memory is what the crypto module does; the gauge follows it.
    (instance.exports.mem as WebAssembly.Memory).grow(16);
    expect(readWasmMemoryMb()).toBe(2);

    // An instance made from a compiled module counts too.
    await WebAssembly.instantiate(await WebAssembly.compile(WASM_WITH_MEMORY));
    expect(readWasmMemoryMb()).toBe(3);

    // The crypto module loads this way.
    await WebAssembly.instantiateStreaming(
      new Response(WASM_WITH_MEMORY, { headers: { 'Content-Type': 'application/wasm' } })
    );
    expect(readWasmMemoryMb()).toBe(4);
  });

  it('records nothing from a load or a kept wrapper that finishes after uninstall', async () => {
    const pending = WebAssembly.instantiate(WASM_WITH_MEMORY);
    const keptCreate = URL.createObjectURL;
    const keptInstantiate = WebAssembly.instantiate;
    uninstall();
    await pending;
    keptCreate(new Blob(['x']));
    await keptInstantiate(WASM_WITH_MEMORY);

    expect(readWasmMemoryMb()).toBeUndefined();
    expect(readMediaMemory()).toMatchObject({ object_urls: 0 });
  });

  it('counts a memory once, however many exports or instances share it', async () => {
    const { instance } = await WebAssembly.instantiate(WASM_WITH_MEMORY);
    const shared = instance.exports.mem as WebAssembly.Memory;
    // Imports `env.mem` and exports it under two names.
    await WebAssembly.instantiate(
      new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x02, 0x0c, 0x01, 0x03, 0x65, 0x6e, 0x76,
        0x03, 0x6d, 0x65, 0x6d, 0x02, 0x00, 0x10, 0x07, 0x09, 0x02, 0x01, 0x61, 0x02, 0x00, 0x01,
        0x62, 0x02, 0x00,
      ]),
      { env: { mem: shared } }
    );

    expect(readWasmMemoryMb()).toBe(1);
  });

  it('returns the URL even when the blob cannot be measured', () => {
    const blob = new Blob(['x']);
    Object.defineProperty(blob, 'size', {
      get: () => {
        throw new Error('no size');
      },
    });

    expect(URL.createObjectURL(blob)).toMatch(/^blob:test\//);
    expect(readMediaMemory()).toMatchObject({ object_urls: 1, object_url_mb: 0 });
  });

  it('counts live object URLs and the bytes of their blobs until they are revoked', () => {
    const before = readMediaMemory();
    const url = URL.createObjectURL(new Blob([new Uint8Array(3 * 1024 * 1024)]));
    URL.createObjectURL(new Blob([new Uint8Array(1024 * 1024)]));

    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(readMediaMemory()).toMatchObject({
      object_urls: before.object_urls + 2,
      object_url_mb: before.object_url_mb + 4,
    });

    URL.revokeObjectURL(url);
    expect(revokeObjectURL).toHaveBeenCalledWith(url);
    expect(readMediaMemory()).toMatchObject({
      object_urls: before.object_urls + 1,
      object_url_mb: before.object_url_mb + 1,
    });
  });

  it('estimates decoded images and canvases in the document, and counts media elements', () => {
    const loaded = document.createElement('img');
    Object.defineProperties(loaded, {
      complete: { value: true },
      naturalWidth: { value: 1024 },
      naturalHeight: { value: 512 },
    });
    const loading = document.createElement('img');
    Object.defineProperty(loading, 'complete', { value: false });
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 1024;
    document.body.append(
      loaded,
      loading,
      canvas,
      document.createElement('video'),
      document.createElement('audio')
    );

    expect(readMediaMemory()).toMatchObject({
      images: 2,
      image_decoded_mb: 2,
      canvases: 1,
      canvas_mb: 2,
      media_elements: 2,
    });
  });
});
