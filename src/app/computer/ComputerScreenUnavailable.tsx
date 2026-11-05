import type { PartLoadRetry } from '../lib/lazyPart';
import { PartUnavailable } from '../ui/PartUnavailable';

/**
 * The computer screen when its chunk could not load: a deployment removed it while this page
 * still ran the old build (the new version notice then says so), or the device went offline
 * before the computer ever opened. The panel stays open with a message and Retry instead of the
 * app showing its crash screen.
 */
export function ComputerScreenUnavailable({ retryLoad }: PartLoadRetry) {
  return <PartUnavailable retryLoad={retryLoad} />;
}
