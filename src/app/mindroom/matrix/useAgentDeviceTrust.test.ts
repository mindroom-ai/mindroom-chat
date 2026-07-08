import { describe, expect, it } from 'vitest';
import { anyDeviceSignedByOwner } from './useAgentDeviceTrust';

describe('anyDeviceSignedByOwner', () => {
  it('is true when at least one device is signed by its owner', () => {
    expect(anyDeviceSignedByOwner([false, true])).toBe(true);
    expect(anyDeviceSignedByOwner([true])).toBe(true);
  });

  it('is false when no device is signed by its owner', () => {
    expect(anyDeviceSignedByOwner([false, false])).toBe(false);
    expect(anyDeviceSignedByOwner([])).toBe(false);
  });

  it('treats an unreportable status (null) as not signed', () => {
    expect(anyDeviceSignedByOwner([null])).toBe(false);
    expect(anyDeviceSignedByOwner([null, false])).toBe(false);
    expect(anyDeviceSignedByOwner([null, true])).toBe(true);
  });
});
