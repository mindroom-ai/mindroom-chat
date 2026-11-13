// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { createRoomModalAtom } from '../../navigation/createRoomModal';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { CreateRoomAccess } from '../../matrix/createRoomTypes';
import { CreateRoomModalRenderer } from './CreateRoomModal';

const NEW_ROOM = '!new:test';

const mocks = vi.hoisted(() => ({ createRoom: vi.fn(), navigateRoom: vi.fn() }));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../matrix/createRoom', () => ({ createRoom: mocks.createRoom }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getRoom: () => null }),
}));
vi.mock('../../matrix/waitForJoinedRoom', () => ({
  waitForJoinedRoom: () => Promise.resolve(),
}));
vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: mocks.navigateRoom }),
}));
vi.mock('../../ui/CreateDialogFrame', () => ({
  CreateDialogFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('Create Room dialog', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    mocks.createRoom.mockReset();
    mocks.navigateRoom.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const open = () => {
    const store = createStore();
    store.set(createRoomModalAtom, {});
    act(() =>
      root.render(
        <ClientConfigProvider value={{} as ClientConfig}>
          <Provider store={store}>
            <CreateRoomModalRenderer />
          </Provider>
        </ClientConfigProvider>
      )
    );
    // jsdom has no named access to a form's fields (`form.someName`), which browsers give and the
    // form reads its values through.
    const form = host.querySelector('form')!;
    for (const field of [...form.elements] as HTMLInputElement[]) {
      if (field.name) Object.defineProperty(form, field.name, { value: field, configurable: true });
    }
    host.querySelector('input')!.value = 'Lounge';
  };

  const byText = (text: string) =>
    [...host.querySelectorAll('button')].find((button) => button.textContent === text)!;

  it('creates an encrypted room and opens it', async () => {
    mocks.createRoom.mockResolvedValue(NEW_ROOM);
    open();
    expect(host.textContent).toContain('Anyone can send request to join this room.');

    await act(async () => byText('Create').click());
    await act(async () => undefined);

    expect(mocks.createRoom.mock.calls[0]![1]).toMatchObject({
      name: 'Lounge',
      access: CreateRoomAccess.Private,
      encryption: true,
    });
    expect(mocks.createRoom.mock.calls[0]![1].type).toBeUndefined();
    expect(mocks.navigateRoom).toHaveBeenCalledWith(NEW_ROOM);
  });

  it('opens the advanced options without creating the room', async () => {
    open();

    await act(async () => byText('Advanced Options').click());

    expect(mocks.createRoom).not.toHaveBeenCalled();
  });
});
