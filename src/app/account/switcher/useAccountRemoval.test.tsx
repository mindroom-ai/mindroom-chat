import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { StoredSession } from '../../matrix/session/sessions';
import { removeStoredSession } from '../lifecycle/initMatrix';
import { useAccountRemoval } from './useAccountRemoval';

vi.mock('../lifecycle/initMatrix', () => ({ removeStoredSession: vi.fn() }));

const bob = { sessionId: 'session-bob', userId: '@bob:example.org' } as StoredSession;

const mount = (onRemoved = vi.fn(), onFailed = vi.fn()) => {
  const seen: { current?: ReturnType<typeof useAccountRemoval> } = {};
  function Probe() {
    seen.current = useAccountRemoval(onRemoved, onFailed);
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return { seen, onRemoved, onFailed };
};

describe('useAccountRemoval', () => {
  it('removes an account once while clicks repeat, and shows it busy meanwhile', async () => {
    let finish!: () => void;
    vi.mocked(removeStoredSession).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    const { seen, onRemoved } = mount();

    let first!: Promise<void>;
    await act(async () => {
      first = seen.current!.remove(bob);
      await seen.current!.remove(bob);
    });
    expect(removeStoredSession).toHaveBeenCalledTimes(1);
    expect(seen.current?.removingSessionId).toBe('session-bob');

    await act(async () => {
      finish();
      await first;
    });
    expect(seen.current?.removingSessionId).toBeUndefined();
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('reports a failed removal and allows another try', async () => {
    vi.mocked(removeStoredSession).mockClear();
    vi.mocked(removeStoredSession).mockRejectedValueOnce(new Error('blocked write'));
    const { seen, onFailed, onRemoved } = mount();

    await act(async () => {
      await seen.current!.remove(bob);
    });
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(seen.current?.removingSessionId).toBeUndefined();

    vi.mocked(removeStoredSession).mockResolvedValueOnce(undefined);
    await act(async () => {
      await seen.current!.remove(bob);
    });
    expect(removeStoredSession).toHaveBeenCalledTimes(2);
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });
});
