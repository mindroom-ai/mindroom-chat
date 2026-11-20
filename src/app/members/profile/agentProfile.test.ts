import { describe, expect, it } from 'vitest';
import { groupAgentTools, parseAgentProfile } from './agentProfile';

const tool = (name: string, category: string, mcpServer: string | null = null) => ({
  name,
  display_name: `${name[0]!.toUpperCase()}${name.slice(1)} Tools`,
  description: `Does ${name} things`,
  category,
  mcp_server: mcpServer,
});

describe('parseAgentProfile', () => {
  it('reads the route answer, with the model as message badges read it', () => {
    expect(
      parseAgentProfile({
        role: ' Plans the week ',
        model: { config: 'luna', display_name: 'Example Model', id: 'example-1', provider: 'x' },
        tools: [tool('file', 'development')],
      })
    ).toEqual({
      role: 'Plans the week',
      model: {
        modelConfig: 'luna',
        modelDisplayName: 'Example Model',
        modelId: 'example-1',
        modelProvider: 'x',
      },
      tools: [
        {
          name: 'file',
          displayName: 'File Tools',
          description: 'Does file things',
          group: 'development',
        },
      ],
    });
  });

  it('puts MCP servers under connected apps and unknown categories under other', () => {
    const profile = parseAgentProfile({
      role: null,
      model: {},
      tools: [tool('tracker', 'integrations', 'tracker'), tool('future', 'quantum'), { name: '' }],
    });
    expect(profile?.tools.map((each) => [each.name, each.group])).toEqual([
      ['tracker', 'mcp'],
      ['future', 'other'],
    ]);
    expect(profile?.role).toBeUndefined();
    expect(profile?.model).toBeUndefined();
  });

  it('takes nothing else for a profile', () => {
    expect(parseAgentProfile({ detail: 'Not Found' })).toBeUndefined();
    expect(parseAgentProfile(null)).toBeUndefined();
  });
});

describe('groupAgentTools', () => {
  it('orders groups as the card shows them and leaves out empty ones', () => {
    const { tools } = parseAgentProfile({
      tools: [
        tool('weather', 'information'),
        tool('gmail', 'email'),
        tool('shell', 'development'),
        tool('tracker', 'integrations', 'tracker'),
        tool('file', 'development'),
      ],
    })!;
    expect(
      groupAgentTools(tools).map((group) => [group.key, group.tools.map((t) => t.name)])
    ).toEqual([
      ['development', ['shell', 'file']],
      ['email', ['gmail']],
      ['mcp', ['tracker']],
      ['information', ['weather']],
    ]);
  });
});

describe('groupAgentTools with a query', () => {
  it('keeps the tools whose shown or registry name matches, ignoring case', () => {
    const { tools } = parseAgentProfile({
      tools: [tool('shell', 'development'), tool('gmail', 'email')],
    })!;
    const names = (query: string) =>
      groupAgentTools(tools, query).flatMap((group) => group.tools.map((each) => each.name));
    expect(names(' SHE')).toEqual(['shell']);
    expect(names('gmail')).toEqual(['gmail']);
    expect(names('')).toEqual(['shell', 'gmail']);
    expect(groupAgentTools(tools, 'nothing')).toEqual([]);
  });
});
