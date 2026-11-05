import { transferableAbortController } from 'node:util';
import { afterAll, beforeAll } from 'vitest';

// Each navigation of a data router builds a Request with an AbortController's signal. Under
// jsdom the controller is jsdom's and Request is Node's, and Node 24 rejects the foreign signal
// ("Expected signal to be an instance of AbortSignal"), so every redirect failed there. A browser
// has one of each. This Request follows the given signal with a Node one instead.
const NodeRequest = globalThis.Request;
const followWithNodeSignal = (signal: AbortSignal): AbortSignal => {
  const controller = transferableAbortController();
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  return controller.signal;
};
class SameRealmSignalRequest extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init?.signal ? { ...init, signal: followWithNodeSignal(init.signal) } : init);
  }
}

/** Lets a data router navigate under jsdom in the calling test file. */
export const followRouterSignalsInNode = (): void => {
  beforeAll(() => {
    globalThis.Request = SameRealmSignalRequest;
  });
  afterAll(() => {
    globalThis.Request = NodeRequest;
  });
};
