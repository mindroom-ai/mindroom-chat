import { describe, expect, it } from 'vitest';
import { resolveEffectiveRoomViewMode } from './useRoomViewMode';

describe('resolveEffectiveRoomViewMode', () => {
  it('forces compact mode while Simple Mode is enabled', () => {
    expect(resolveEffectiveRoomViewMode('classic', true)).toBe('compact');
    expect(resolveEffectiveRoomViewMode('threaded', true)).toBe('compact');
  });

  it('preserves the account-scoped room preference outside Simple Mode', () => {
    expect(resolveEffectiveRoomViewMode('classic', false)).toBe('classic');
    expect(resolveEffectiveRoomViewMode('threaded', false)).toBe('threaded');
  });

  it('forces human direct messages to classic mode without overwriting the stored preference', () => {
    expect(resolveEffectiveRoomViewMode('compact', false, true)).toBe('classic');
    expect(resolveEffectiveRoomViewMode('threaded', false, true)).toBe('classic');
    expect(resolveEffectiveRoomViewMode('compact', true, true)).toBe('classic');
  });
});
