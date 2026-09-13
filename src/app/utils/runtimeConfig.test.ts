import { describe, expect, it } from 'vitest';
import { isServiceWorkerEnabled } from './runtimeConfig';

describe('isServiceWorkerEnabled', () => {
  it('defaults to false when not configured', () => {
    const originalValue = (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown })
      .__ENABLE_SERVICE_WORKER__;

    try {
      delete (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__;
      expect(isServiceWorkerEnabled()).toBe(false);
    } finally {
      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ =
        originalValue;
    }
  });

  it('accepts boolean or string values', () => {
    const originalValue = (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown })
      .__ENABLE_SERVICE_WORKER__;

    try {
      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ = true;
      expect(isServiceWorkerEnabled()).toBe(true);

      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ = 'true';
      expect(isServiceWorkerEnabled()).toBe(true);

      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ = 'false';
      expect(isServiceWorkerEnabled()).toBe(false);
    } finally {
      (globalThis as { __ENABLE_SERVICE_WORKER__?: unknown }).__ENABLE_SERVICE_WORKER__ =
        originalValue;
    }
  });
});
