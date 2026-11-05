import { describe, expect, it, vi } from 'vitest';
import { retryPart } from './partRetry';

describe('retryPart', () => {
  const run = (overrides: Partial<Parameters<typeof retryPart>[0]>) => {
    const reload = vi.fn();
    const outcome = retryPart({
      retryLoad: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
      online: () => true,
      wouldLoseWork: () => false,
      reload,
      ...overrides,
    });
    return { outcome, reload };
  };

  it('is done when the part loads again, without a reload', async () => {
    const { outcome, reload } = run({ retryLoad: () => Promise.resolve() });
    await expect(outcome).resolves.toBe('loaded');
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the page when the load fails online and nothing would be lost', async () => {
    const { outcome, reload } = run({});
    await expect(outcome).resolves.toBe('reloading');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('asks for a reload instead when one would lose something', async () => {
    const { outcome, reload } = run({ wouldLoseWork: () => true });
    await expect(outcome).resolves.toBe('reloadNeeded');
    expect(reload).not.toHaveBeenCalled();
  });

  it('stays on the page while offline, where a reload would not load it either', async () => {
    const wouldLoseWork = vi.fn(() => false);
    const { outcome, reload } = run({ online: () => false, wouldLoseWork });
    await expect(outcome).resolves.toBe('offline');
    expect(reload).not.toHaveBeenCalled();
    expect(wouldLoseWork).not.toHaveBeenCalled();
  });
});
