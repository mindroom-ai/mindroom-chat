// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceSettings } from './Devices';

const mocks = vi.hoisted(() => {
  const getDevices = vi.fn();
  const setDeviceDetails = vi.fn();
  return {
    devices: [{ device_id: 'DEV1', display_name: 'Laptop' }],
    getDevices,
    setDeviceDetails,
    client: {
      getDeviceId: () => 'DEV1',
      getUserId: () => '@alice:example.org',
      getDevices,
      setDeviceDetails,
      on: vi.fn(),
      off: vi.fn(),
    },
  };
});

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => mocks.client,
}));
vi.mock('../../matrix/ServerConfigsLoader', () => ({
  useServerConfigs: () => ({}),
}));
vi.mock('../uia/useAuthenticatedAction', () => ({
  AuthenticationCancelled: class extends Error {},
  useAuthenticatedAction: () => ({ run: vi.fn(), prompt: null }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DeviceSettings RenameForm', () => {
  it('renames a device, keeps the draft on error, disables while pending, and ignores double-submit', async () => {
    mocks.getDevices.mockResolvedValue({ devices: mocks.devices });
    let rejectFirst!: (reason: unknown) => void;
    let resolveSecond!: () => void;
    mocks.setDeviceDetails
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

    const view = render(<DeviceSettings trust={undefined} />);
    const edit = await screen.findByRole('button', { name: 'Edit Laptop' });
    fireEvent.click(edit);

    const input = view.container.querySelector('input')!;
    const form = view.container.querySelector('form')!;
    const save = view.container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const cancel = screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' });

    fireEvent.change(input, { target: { value: 'Work Laptop' } });
    await act(async () => {
      form.requestSubmit();
    });
    expect(save.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);

    await act(async () => {
      rejectFirst(new Error('network'));
    });
    expect(input.value).toBe('Work Laptop');
    expect(screen.getByRole('alert').textContent).toBeTruthy();

    await act(async () => {
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(save.disabled).toBe(true);

    await act(async () => {
      resolveSecond();
    });
    expect(mocks.setDeviceDetails).toHaveBeenCalledTimes(2);
    expect(mocks.setDeviceDetails).toHaveBeenLastCalledWith('DEV1', {
      display_name: 'Work Laptop',
    });
    expect(view.container.querySelector('form')).toBeNull();
  });
});
