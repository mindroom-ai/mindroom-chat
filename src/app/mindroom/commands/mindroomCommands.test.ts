import { describe, expect, it } from 'vitest';
import { MINDROOM_COMMANDS } from './mindroomCommands';

describe('MINDROOM_COMMANDS', () => {
  it('contains required command names', () => {
    const names = MINDROOM_COMMANDS.map((c) => c.name);
    expect(names).toEqual([
      'help',
      'schedule',
      'list_schedules',
      'cancel_schedule',
      'edit_schedule',
      'widget',
      'config',
      'hi',
      'skill',
    ]);
  });
});
