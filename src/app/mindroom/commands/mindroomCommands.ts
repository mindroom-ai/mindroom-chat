export type MindroomCommandItem = {
  name: string;
  syntax: string;
  description: string;
};

// Mirrors the MindRoom bot command set (mindroom/commands/parsing.py CommandType
// + _COMMAND_DOCS), in the order `!help` lists them.
export const MINDROOM_COMMANDS: MindroomCommandItem[] = [
  {
    name: 'help',
    syntax: '!help [topic]',
    description: 'Get help about available capabilities or a specific topic.',
  },
  {
    name: 'reload-plugins',
    syntax: '!reload-plugins',
    description: 'Reload configured plugins (admin only).',
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
    name: 'config',
    syntax: '!config <operation>',
    description: 'Manage MindRoom configuration (admin only).',
  },
  {
    name: 'model',
    syntax: '!model [name|list|reset]',
    description: 'Show or switch the model used in the current thread.',
  },
  {
    name: 'thread_mode',
    syntax: '!thread_mode [room|thread|reset|show]',
    description: 'Show or switch the thread mode used in the current room (room admin only).',
  },
  {
    name: 'hi',
    syntax: '!hi',
    description: 'Show welcome information.',
  },
];
