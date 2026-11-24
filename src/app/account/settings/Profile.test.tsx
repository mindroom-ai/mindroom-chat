// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Profile } from './Profile';

const mocks = vi.hoisted(() => ({
  displayName: 'Alice',
  setDisplayName: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@alice:example.org',
    setDisplayName: mocks.setDisplayName,
    getUser: () => ({ displayName: mocks.displayName }),
    store: { storeUser: vi.fn() },
    emit: mocks.emit,
  }),
}));
vi.mock('../../members/useUserProfile', () => ({
  useUserProfile: () => ({ displayName: mocks.displayName, avatarUrl: undefined }),
}));
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));
vi.mock('../../matrix/hooks/useCapabilities', () => ({
  useCapabilities: () => ({}),
}));

afterEach(() => {
  cleanup();
  mocks.displayName = 'Alice';
  vi.clearAllMocks();
});

describe('Profile DisplayNameTile', () => {
  it('disables Save while pending, keeps the draft on error, and hides the error on retry', async () => {
    let rejectFirst!: (reason: unknown) => void;
    let resolveSecond!: () => void;
    mocks.setDisplayName
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirst = reject;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSecond = resolve;
          })
      );

    const view = render(<Profile />);
    const input = view.container.querySelector('input')!;
    const form = view.container.querySelector('form')!;
    const save = view.container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'Alice B' } });
    expect(save.disabled).toBe(false);

    await act(async () => {
      form.requestSubmit();
    });
    expect(save.disabled).toBe(true);

    await act(async () => {
      rejectFirst(new Error('network'));
    });
    expect(input.value).toBe('Alice B');
    expect(screen.getByRole('alert').textContent).toBeTruthy();

    await act(async () => {
      form.requestSubmit();
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(save.disabled).toBe(true);

    await act(async () => {
      resolveSecond();
    });
    expect(mocks.setDisplayName).toHaveBeenNthCalledWith(1, 'Alice B');
    expect(mocks.setDisplayName).toHaveBeenNthCalledWith(2, 'Alice B');
  });
});
