import { Icons, type IconSrc } from 'folds';
import { isRecord } from '../../lib/isRecord';
import { parseAiRunModel, type AiRunModelInfo } from '../../matrix/protocol/aiRun';

/**
 * The groups in the order the card shows them, each with its icon: the tool registry's categories,
 * MCP servers apart as connected apps, and `other` for a category this client does not know yet.
 */
const GROUPS = [
  ['development', Icons.Terminal],
  ['research', Icons.Globe],
  ['productivity', Icons.Clock],
  ['email', Icons.Mail],
  ['mcp', Icons.Server],
  ['integrations', Icons.Category],
  ['communication', Icons.Message],
  ['entertainment', Icons.Play],
  ['information', Icons.Info],
  ['smart_home', Icons.Bulb],
  ['social', Icons.User],
  ['other', Icons.Category],
] as const satisfies ReadonlyArray<readonly [string, IconSrc]>;

export type AgentToolGroupKey = (typeof GROUPS)[number][0];

/** One toolkit configured for an agent, as the backend's tool registry describes it. */
export type AgentTool = {
  name: string;
  displayName: string;
  description: string;
  group: AgentToolGroupKey;
};

/** What `GET /api/rooms/{room}/agents/{agent}/profile` says about an agent. */
export type AgentProfile = { role?: string; model?: AiRunModelInfo; tools: AgentTool[] };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const parseTool = (value: unknown): AgentTool[] => {
  const name = isRecord(value) ? text(value.name) : '';
  if (!isRecord(value) || !name) return [];
  const category = text(value.category);
  const known = GROUPS.find(([key]) => key === category && key !== 'mcp')?.[0];
  const group = text(value.mcp_server) ? 'mcp' : (known ?? 'other');
  const displayName = text(value.display_name) || name;
  return [{ name, displayName, description: text(value.description), group }];
};

/** The profile route's answer; undefined for anything else, which the card treats as no answer. */
export const parseAgentProfile = (value: unknown): AgentProfile | undefined => {
  if (!isRecord(value) || !Array.isArray(value.tools)) return undefined;
  return {
    role: text(value.role) || undefined,
    model: parseAiRunModel(value.model),
    tools: value.tools.flatMap(parseTool),
  };
};

/**
 * The tools whose name or registry name holds `query` (ignoring case), by group in the card's
 * order, leaving out empty groups; each group keeps the route's order.
 */
export const groupAgentTools = (tools: AgentTool[], query = '') => {
  const needle = query.trim().toLocaleLowerCase();
  const shown = tools.filter((tool) =>
    [tool.displayName, tool.name].some((name) => name.toLocaleLowerCase().includes(needle))
  );
  return GROUPS.map(([key, icon]) => ({
    key,
    icon,
    tools: shown.filter((tool) => tool.group === key),
  })).filter((group) => group.tools.length > 0);
};
