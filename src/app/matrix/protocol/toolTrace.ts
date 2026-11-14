export type ToolTraceEvent = {
  type?: unknown;
  tool_name?: unknown;
  args_preview?: unknown;
  result_preview?: unknown;
  truncated?: unknown;
  // The latest output a running call reported; only live frames carry it.
  progress?: unknown;
};

export type ToolMetadataStatus = 'loading' | 'unavailable';

type ToolTraceContent = {
  version?: unknown;
  events?: unknown;
};

export const MINDROOM_TOOL_TRACE_KEY = 'io.mindroom.tool_trace';

const asToolTrace = (trace: unknown): ToolTraceContent | undefined =>
  trace && typeof trace === 'object' ? (trace as ToolTraceContent) : undefined;

const getToolTraceEvents = (
  trace: ToolTraceContent | undefined
): ToolTraceEvent[] | undefined => {
  const eventsRaw = trace?.events;
  if (!Array.isArray(eventsRaw) || eventsRaw.length === 0) return undefined;

  const events = eventsRaw.filter(
    (event): event is ToolTraceEvent => !!event && typeof event === 'object'
  );

  return events.length > 0 ? events : undefined;
};

export const isToolTraceV2 = (content: Record<string, unknown>): boolean =>
  asToolTrace(content[MINDROOM_TOOL_TRACE_KEY])?.version === 2;

export const getContentToolTraceEvents = (
  content: Record<string, unknown>
): ToolTraceEvent[] | undefined =>
  getToolTraceEvents(asToolTrace(content[MINDROOM_TOOL_TRACE_KEY]));

/** The events of a tool trace value (`content['io.mindroom.tool_trace']`) when it is version 2. */
export const getToolTraceV2Events = (
  trace: unknown
): ToolTraceEvent[] | undefined => {
  const toolTrace = asToolTrace(trace);
  return toolTrace?.version === 2 ? getToolTraceEvents(toolTrace) : undefined;
};
