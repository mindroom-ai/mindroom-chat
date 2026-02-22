import { sanitizeText } from '../../utils/sanitize';

type ToolTraceEvent = {
  type?: unknown;
  tool_name?: unknown;
  args_preview?: unknown;
  result_preview?: unknown;
};

const hasToolTags = (customBody?: string): boolean =>
  typeof customBody === 'string' && /<(tool|tool-group)\b/i.test(customBody);

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim() : undefined;

const formatToolCommand = (toolName?: string, argsPreview?: string): string => {
  const safeTool = toolName || 'tool';
  if (!argsPreview) return safeTool;
  return `${safeTool}(${argsPreview})`;
};

const escapeToolBody = (command: string, result?: string): string => {
  const escapedCommand = sanitizeText(command);
  if (typeof result !== 'string') {
    return escapedCommand;
  }
  return `${escapedCommand}\n${sanitizeText(result)}`;
};

export const buildMindroomToolTraceHtml = (content: Record<string, unknown>): string | undefined => {
  const trace = content['io.mindroom.tool_trace'];
  if (!trace || typeof trace !== 'object') return undefined;

  // Respect the server's display flag (set when show_tool_calls is false)
  const traceObj = trace as Record<string, unknown>;
  if (traceObj.display === false) return undefined;

  const eventsRaw = traceObj.events;
  if (!Array.isArray(eventsRaw) || eventsRaw.length === 0) return undefined;

  const calls: { toolName: string; command: string; body: string; pending: boolean }[] = [];

  eventsRaw.forEach((eventRaw) => {
    if (!eventRaw || typeof eventRaw !== 'object') return;
    const event = eventRaw as ToolTraceEvent;
    const type = asText(event.type);
    const toolName = asText(event.tool_name) ?? 'tool';

    if (type === 'tool_call_started') {
      const command = formatToolCommand(toolName, asText(event.args_preview));
      calls.push({
        toolName,
        command,
        body: escapeToolBody(command),
        pending: true,
      });
      return;
    }

    if (type === 'tool_call_completed') {
      const fallbackCommand = formatToolCommand(toolName, asText(event.args_preview));
      const result = asText(event.result_preview);

      const pendingIndex = [...calls]
        .reverse()
        .findIndex((call) => call.pending && call.toolName === toolName);
      if (pendingIndex >= 0) {
        const index = calls.length - 1 - pendingIndex;
        const command = calls[index].command || fallbackCommand;
        calls[index] = {
          ...calls[index],
          body: escapeToolBody(command, typeof result === 'string' ? result : ''),
          pending: false,
        };
      } else {
        const command = fallbackCommand;
        calls.push({
          toolName,
          command,
          body: escapeToolBody(command, typeof result === 'string' ? result : ''),
          pending: false,
        });
      }
    }
  });

  if (calls.length === 0) return undefined;

  const toolHtml = calls.map((call) => `<tool>${call.body}</tool>`).join('\n');
  if (calls.length === 1) return toolHtml;
  return `<tool-group>\n${toolHtml}\n</tool-group>`;
};

export const mergeMindroomToolTraceIntoCustomBody = (
  content: Record<string, unknown>
): Record<string, unknown> => {
  const body = typeof content.body === 'string' ? content.body : '';
  const formattedBody =
    typeof content.formatted_body === 'string' ? content.formatted_body : undefined;

  if (hasToolTags(formattedBody)) {
    return content;
  }

  const toolTraceHtml = buildMindroomToolTraceHtml(content);
  if (!toolTraceHtml) {
    return content;
  }

  const safeBodyHtml =
    formattedBody ?? (body ? sanitizeText(body).replace(/\n/g, '<br/>') : undefined);

  return {
    ...content,
    formatted_body: safeBodyHtml ? `${safeBodyHtml}<br/>${toolTraceHtml}` : toolTraceHtml,
  };
};
