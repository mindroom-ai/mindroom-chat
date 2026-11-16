import { describe, expect, it } from 'vitest';
import { isThreadWorking } from './threadWorking';

describe('isThreadWorking', () => {
  it('is working while an agent streams, the message is on its way, or a job runs in it', () => {
    expect(isThreadWorking({ isStreaming: true }, false)).toBe(true);
    expect(isThreadWorking({ isStreaming: false, hasPendingSend: true }, false)).toBe(true);
    expect(isThreadWorking({ isStreaming: false }, true)).toBe(true);
  });

  it('is not working when nothing streams, sends or runs in it', () => {
    expect(isThreadWorking({ isStreaming: false }, false)).toBe(false);
    expect(isThreadWorking({ isStreaming: false, hasPendingSend: false }, false)).toBe(false);
  });
});
