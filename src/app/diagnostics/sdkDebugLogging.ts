import { logger } from 'matrix-js-sdk/lib/logger';

// matrix-js-sdk logs through loglevel and sets every logger it makes to the debug level, and some
// of its modules bind `logger.log` once when they load (the timeline set logs each duplicate event
// it replaces), so setting a level later silences nothing. What the SDK does support is a method
// factory on its root logger: every child logger copies the factory of its parent when it is
// made. This module therefore has to run before the rest of the SDK loads, which is why
// `src/index.tsx` imports it first.

type LogMethod = (...message: unknown[]) => void;

/** The loglevel parts of the SDK's root logger that its typings leave out. */
type ExtensibleLogger = {
  methodFactory: (methodName: string, level: number, loggerName: string | symbol) => LogMethod;
  rebuild: () => void;
};

/** loglevel's method names below info; its `log` method is the debug one. */
const DEBUG_METHODS = new Set(['trace', 'debug']);

const discard: LogMethod = () => undefined;

/**
 * Drops the SDK's trace and debug lines (loggers made from now on, and the root logger itself);
 * info, warnings and errors still reach the console. Returns a function that brings them back,
 * for loggers made after it runs.
 */
export const quietSdkDebugLogging = (): (() => void) => {
  const root = logger as unknown as ExtensibleLogger;
  const consoleFactory = root.methodFactory;
  root.methodFactory = (methodName, level, loggerName) =>
    DEBUG_METHODS.has(methodName) ? discard : consoleFactory(methodName, level, loggerName);
  root.rebuild();
  return () => {
    root.methodFactory = consoleFactory;
    root.rebuild();
  };
};

// Development builds keep the SDK's debug lines.
if (import.meta.env.PROD) quietSdkDebugLogging();
