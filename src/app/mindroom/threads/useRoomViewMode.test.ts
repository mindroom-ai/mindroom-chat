import { describe, expect, it } from 'vitest';
import { resolveEffectiveRoomViewMode } from './useRoomViewMode';

describe('resolveEffectiveRoomViewMode', () => {
  it('keeps compact and threaded preferences while Simple Mode is enabled', () => {
    expect(resolveEffectiveRoomViewMode('compact', true)).toBe('compact');
    expect(resolveEffectiveRoomViewMode('threaded', true)).toBe('threaded');
  });

  it('keeps Classic out of Simple Mode by falling back to compact', () => {
    expect(resolveEffectiveRoomViewMode('classic', true)).toBe('compact');
  });

  it('preserves the account-scoped room preference outside Simple Mode', () => {
    expect(resolveEffectiveRoomViewMode('classic', false)).toBe('classic');
    expect(resolveEffectiveRoomViewMode('threaded', false)).toBe('threaded');
  });
});
