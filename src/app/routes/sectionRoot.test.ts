import { describe, expect, it } from 'vitest';
import { SECTION_ROOT_HANDLE, isSectionRootHandle } from './sectionRoot';

describe('isSectionRootHandle', () => {
  it('knows only the section root handle', () => {
    expect(isSectionRootHandle(SECTION_ROOT_HANDLE)).toBe(true);
    expect(isSectionRootHandle(undefined)).toBe(false);
    expect(isSectionRootHandle(null)).toBe(false);
    expect(isSectionRootHandle({})).toBe(false);
  });
});
