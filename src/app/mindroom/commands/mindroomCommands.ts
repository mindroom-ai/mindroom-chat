export type MindroomCommandItem = {
  name: string;
  syntax: string;
  description: string;
};

export const MINDROOM_COMMANDS: MindroomCommandItem[] = [
  {
    name: 'help',
    syntax: '!help [topic]',
    description: 'Get help about available capabilities or a specific topic.',
  },
  {
    name: 'schedule',
    syntax: '!schedule <task>',
    description: 'Schedule a task for later execution.',
  },
  {
    name: 'list_schedules',
    syntax: '!list_schedules',
    description: 'List all scheduled tasks.',
  },
  {
    name: 'cancel_schedule',
    syntax: '!cancel_schedule <id|all>',
    description: 'Cancel one schedule by id or all schedules.',
  },
  {
    name: 'edit_schedule',
    syntax: '!edit_schedule <id> <task>',
    description: 'Update an existing schedule task.',
  },
  {
    name: 'widget',
    syntax: '!widget [url]',
    description: 'Attach or configure a widget.',
  },
  {
    name: 'config',
    syntax: '!config <operation>',
    description: 'Manage MindRoom configuration.',
  },
  {
    name: 'hi',
    syntax: '!hi',
    description: 'Show welcome information.',
  },
  {
    name: 'skill',
    syntax: '!skill <name> [args]',
    description: 'Run a skill by name with optional arguments.',
  },
];
