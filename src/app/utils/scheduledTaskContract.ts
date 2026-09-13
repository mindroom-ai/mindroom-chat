import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';

type ScheduledTaskStateEventContent = {
  status?: unknown;
  workflow?: unknown;
  thread_id?: unknown;
  new_thread?: unknown;
};

type ScheduledTaskWorkflow = {
  thread_id?: unknown;
  new_thread?: unknown;
  execute_at?: unknown;
};

type ParsedWorkflow = {
  threadId?: string | null;
  newThread?: boolean;
  executeAt?: string | null;
};

export type ParsedScheduledTask = {
  taskId: string;
  status: string;
  threadId: string | null;
  newThread: boolean;
  executeAt: string | null;
};

const parseThreadId = (value: unknown): string | null | undefined => {
  if (typeof value === 'string') return value;
  if (value === null) return null;
  return undefined;
};

const parseNewThread = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const parseWorkflow = (workflow: unknown): ParsedWorkflow | null => {
  if (workflow === undefined) return {};

  let parsedWorkflow: unknown = workflow;

  if (typeof workflow === 'string') {
    try {
      parsedWorkflow = JSON.parse(workflow);
    } catch {
      return null;
    }
  }

  if (!parsedWorkflow || typeof parsedWorkflow !== 'object' || Array.isArray(parsedWorkflow)) {
    return null;
  }

  const { thread_id: threadIdValue, new_thread: newThreadValue, execute_at: executeAtValue } =
    parsedWorkflow as ScheduledTaskWorkflow;

  return {
    threadId: parseThreadId(threadIdValue),
    newThread: parseNewThread(newThreadValue),
    executeAt: typeof executeAtValue === 'string' ? executeAtValue : null,
  };
};

export const parseScheduledTaskStateEvent = (event: MatrixEvent): ParsedScheduledTask | null => {
  const taskId = event.getStateKey();
  if (typeof taskId !== 'string') return null;

  const content = event.getContent<ScheduledTaskStateEventContent>();
  if (!content || typeof content !== 'object') return null;

  const { status, thread_id: topLevelThreadId, new_thread: topLevelNewThread, workflow } = content;
  if (typeof status !== 'string') return null;

  const parsedWorkflow = parseWorkflow(workflow);
  const parsedTopLevelThreadId = parseThreadId(topLevelThreadId);
  const parsedTopLevelNewThread = parseNewThread(topLevelNewThread);

  if (
    workflow !== undefined &&
    parsedWorkflow === null &&
    (parsedTopLevelThreadId === undefined || parsedTopLevelNewThread === undefined)
  ) {
    return null;
  }

  return {
    taskId,
    status,
    threadId: parsedTopLevelThreadId ?? parsedWorkflow?.threadId ?? null,
    newThread: parsedTopLevelNewThread ?? parsedWorkflow?.newThread ?? false,
    executeAt: parsedWorkflow?.executeAt ?? null,
  };
};
