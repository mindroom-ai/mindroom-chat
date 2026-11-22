import { describe, expect, it } from 'vitest';
import { getPhoneHeaderSlots, selectPhoneHeaderActions } from './phoneHeaderActions';

describe('phone header slots', () => {
  // Header padding: 16 + 8. Each 40 px button takes 4 px more for its gap; More starts the group.
  it.each([
    [360, 2, 2],
    [375, 2, 2],
    [390, 2, 2],
    [430, 2, 3],
    [360, 0, 3],
    [375, 1, 3],
    [390, 1, 3],
    [430, 0, 3],
    [240, 2, 0],
  ])('fits %i px and %i calls in %i slots', (viewport, calls, slots) => {
    expect(getPhoneHeaderSlots(viewport - 24, 40 + calls * 44, 44)).toBe(slots);
  });

  it('reserves the full name width down to the pixel and handles unmeasured layouts', () => {
    expect(getPhoneHeaderSlots(203, 40, 44)).toBe(0);
    expect(getPhoneHeaderSlots(204, 40, 44)).toBe(1);
    expect(getPhoneHeaderSlots(0, 40, 44)).toBe(0);
    expect(getPhoneHeaderSlots(430, 0, 0)).toBe(0);
  });
});

describe('phone header promotion', () => {
  it('selects by priority, not by entry order', () => {
    const eligible = ['schedules', 'canvas', 'computer', 'subagents', 'pins', 'members'];
    expect(selectPhoneHeaderActions(3, eligible)).toEqual(
      new Set(['subagents', 'schedules', 'members'])
    );
    expect(selectPhoneHeaderActions(2, eligible)).toEqual(new Set(['subagents', 'schedules']));
  });

  it('fills empty slots from the fallback actions and ignores unrelated entries', () => {
    const eligible = ['plugin', 'pins', 'filterBar', 'computer', 'canvas', 'members'];
    expect(selectPhoneHeaderActions(3, eligible)).toEqual(
      new Set(['members', 'canvas', 'computer'])
    );
    expect(selectPhoneHeaderActions(1, ['pins'])).toEqual(new Set(['pins']));
    expect(selectPhoneHeaderActions(3, [])).toEqual(new Set());
  });
});
