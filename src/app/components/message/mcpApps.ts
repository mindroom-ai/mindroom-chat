const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';
const MCP_APP_IFRAME_SANDBOX = 'allow-scripts allow-forms allow-popups allow-downloads';

export type McpAppResource = {
  uri: string;
  mimeType: string;
  html: string;
  meta?: Record<string, unknown>;
  toolInput?: Record<string, unknown>;
  toolResult?: Record<string, unknown>;
  toolName?: string;
  resultPreview?: string;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const normalizeMcpAppResource = (
  value: unknown,
  event: Record<string, unknown>
): McpAppResource | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;

  const uri = asString(record.uri);
  const mimeType = asString(record.mime_type);
  const html = typeof record.html === 'string' ? record.html : undefined;
  if (
    !uri ||
    !uri.startsWith('ui://') ||
    mimeType?.toLowerCase() !== MCP_APP_MIME_TYPE ||
    html === undefined
  ) {
    return undefined;
  }

  const meta = asRecord(record.meta);
  const toolInput = asRecord(event.mcp_tool_input);
  const toolResult = asRecord(event.mcp_tool_result);
  return {
    uri,
    mimeType,
    html,
    ...(meta ? { meta } : {}),
    ...(toolInput ? { toolInput } : {}),
    ...(toolResult ? { toolResult } : {}),
    ...(asString(event.tool_name) ? { toolName: asString(event.tool_name) } : {}),
    ...(asString(event.result_preview) ? { resultPreview: asString(event.result_preview) } : {}),
  };
};

export const getMcpAppResources = (content: Record<string, unknown>): McpAppResource[] => {
  const trace = asRecord(content['io.mindroom.tool_trace']);
  const events = trace?.events;
  if (!Array.isArray(events)) return [];

  const resources: McpAppResource[] = [];
  events.forEach((eventValue) => {
    const event = asRecord(eventValue);
    if (!event || !Array.isArray(event.mcp_apps)) return;
    event.mcp_apps.forEach((resourceValue) => {
      const resource = normalizeMcpAppResource(resourceValue, event);
      if (resource) resources.push(resource);
    });
  });
  return resources;
};

export const getMcpAppIframeSandbox = (): string => MCP_APP_IFRAME_SANDBOX;
