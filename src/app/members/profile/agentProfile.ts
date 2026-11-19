import { Icons, type IconSrc } from 'folds';
import { isRecord } from '../../lib/isRecord';
import { parseAiRunModel, type AiRunModelInfo } from '../../matrix/protocol/aiRun';

/** One toolkit an agent may use, as the backend's tool registry describes it. */
export type AgentTool = {
  name: string;
  displayName: string;
  description: string;
  /** The group it shows in: the registry's category, or `mcp` for a connected MCP server. */
  group: AgentToolGroupKey;
};

/** What `GET /api/rooms/{room}/agents/{agent}/profile` says about an agent. */
export type AgentProfile = { role?: string; model?: AiRunModelInfo; tools: AgentTool[] };

/**
 * The groups in the order the card shows them: the registry's categories, with MCP servers split
 * out as connected apps, and `other` for a category this client does not know yet.
 */
export const AGENT_TOOL_GROUPS = [
  'development',
  'research',
  'productivity',
  'email',
  'mcp',
  'integrations',
  'communication',
  'entertainment',
  'information',
  'smart_home',
  'social',
  'other',
] as const;

export type AgentToolGroupKey = (typeof AGENT_TOOL_GROUPS)[number];

export const AGENT_TOOL_GROUP_ICONS: Record<AgentToolGroupKey, IconSrc> = {
  development: Icons.Terminal,
  research: Icons.Globe,
  productivity: Icons.Clock,
  email: Icons.Mail,
  mcp: Icons.Server,
  integrations: Icons.Category,
  communication: Icons.Message,
  entertainment: Icons.Play,
  information: Icons.Info,
  smart_home: Icons.Bulb,
  social: Icons.User,
  other: Icons.Category,
};

const isGroupKey = (value: string): value is AgentToolGroupKey =>
  (AGENT_TOOL_GROUPS as readonly string[]).includes(value);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const parseTool = (value: unknown): AgentTool | undefined => {
  if (!isRecord(value)) return undefined;
  const name = text(value.name);
  if (!name) return undefined;
  const category = text(value.category);
  let group: AgentToolGroupKey = isGroupKey(category) && category !== 'mcp' ? category : 'other';
  if (text(value.mcp_server)) group = 'mcp';
  return {
    name,
    displayName: text(value.display_name) || name,
    description: text(value.description),
    group,
  };
};

/** The profile route's answer; undefined for anything else, which the card treats as no answer. */
export const parseAgentProfile = (value: unknown): AgentProfile | undefined => {
  if (!isRecord(value) || !Array.isArray(value.tools)) return undefined;
  return {
    role: text(value.role) || undefined,
    model: parseAiRunModel(value.model),
    tools: value.tools.flatMap((tool) => parseTool(tool) ?? []),
  };
};

export type AgentToolGroup = { key: AgentToolGroupKey; tools: AgentTool[] };

/** The tools by group, in the card's order, leaving out empty groups; each keeps the route's order. */
export const groupAgentTools = (tools: AgentTool[]): AgentToolGroup[] =>
  AGENT_TOOL_GROUPS.map((key) => ({
    key,
    tools: tools.filter((tool) => tool.group === key),
  })).filter((group) => group.tools.length > 0);

/** The tools whose name or registry name holds `query`, ignoring case. */
export const filterAgentTools = (tools: AgentTool[], query: string): AgentTool[] => {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return tools;
  return tools.filter((tool) =>
    [tool.displayName, tool.name].some((name) => name.toLocaleLowerCase().includes(needle))
  );
};
