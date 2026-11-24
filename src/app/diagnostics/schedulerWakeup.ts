/**
 * Dispatched on the global object by `patches/scheduler+0.28.0.patch` when React
 * Scheduler replaces a MessageChannel whose wakeup did not arrive in time.
 * `detail.elapsedMs` is how long the replaced wakeup had been outstanding.
 */
export const SCHEDULER_WAKEUP_REPLACED_EVENT = 'mindroom:scheduler-wakeup-replaced';
