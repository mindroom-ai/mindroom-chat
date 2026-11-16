import type { ThreadStatusSnapshot } from './types';

/**
 * Whether a thread is working: an agent streams a reply in it, the user's message to it is still
 * on its way, or an agent runs a background job in it (`hasBackgroundJob`), which goes on after
 * the reply that started it ended. The sidebar's Sections, the Compact room's Sections and the
 * Threads page's Working group all ask this.
 */
export const isThreadWorking = (
  status: Pick<ThreadStatusSnapshot, 'isStreaming' | 'hasPendingSend'>,
  hasBackgroundJob: boolean
): boolean => status.isStreaming || status.hasPendingSend === true || hasBackgroundJob;
