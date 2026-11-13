// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { createSpaceModalAtom } from '../../navigation/createSpaceModal';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { CreateRoomAccess } from '../../matrix/createRoomTypes';
import { RoomType } from '../../matrix/types/room';
import { CreateSpaceModalRenderer } from './CreateSpaceModal';

const PARENT = '!parent:test';
const NEW_SPACE = '!new:test';

const mocks = vi.hoisted(() => ({
  createRoom: vi.fn(),
  navigateSpace: vi.fn(),
  parent: { roomId: '!parent:test' },
}));

vi.mock('../../matrix/createRoom', () => ({ createRoom: mocks.createRoom }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getRoom: (roomId: string) => (roomId === PARENT ? mocks.parent : null),
  }),
}));
vi.mock('../../matrix/waitForJoinedRoom', () => ({
  waitForJoinedRoom: () => Promise.resolve(),
}));
vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateSpace: mocks.navigateSpace }),
}));
vi.mock('../../ui/CreateDialogFrame', () => ({
  CreateDialogFrame: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}));

describe('Create Space dialog', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    mocks.createRoom.mockReset();
    mocks.navigateSpace.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const open = (spaceId?: string) => {
    const store = createStore();
    store.set(createSpaceModalAtom, { spaceId });
    act(() =>
      root.render(
        <ClientConfigProvider value={{} as ClientConfig}>
          <Provider store={store}>
            <CreateSpaceModalRenderer />
          </Provider>
        </ClientConfigProvider>
      )
    );
    return store;
  };

  const byText = (text: string) =>
    [...host.querySelectorAll('button')].find((button) => button.textContent === text);

  // jsdom has no named access to a form's fields (`form.someName`), which browsers give and the
  // form reads its values through.
  const nameFields = (form: HTMLFormElement) => {
    for (const field of [...form.elements] as HTMLInputElement[]) {
      if (field.name) Object.defineProperty(form, field.name, { value: field, configurable: true });
    }
  };

  const fill = (name: string, topic = '') => {
    nameFields(host.querySelector('form')!);
    const [nameInput] = host.querySelectorAll('input');
    nameInput!.value = name;
    host.querySelector('textarea')!.value = topic;
  };

  const settle = () => act(async () => undefined);

  it('creates an unencrypted top-level space and opens it', async () => {
    mocks.createRoom.mockResolvedValue(NEW_SPACE);
    const store = open();
    fill('Team', 'Our space');

    await act(async () => byText('Create')!.click());
    await settle();

    expect(mocks.createRoom).toHaveBeenCalledOnce();
    expect(mocks.createRoom.mock.calls[0]![1]).toMatchObject({
      type: RoomType.Space,
      name: 'Team',
      topic: 'Our space',
      access: CreateRoomAccess.Private,
      encryption: false,
      parent: undefined,
    });
    expect(store.get(createSpaceModalAtom)).toBeUndefined();
    expect(mocks.navigateSpace).toHaveBeenCalledWith(NEW_SPACE);
  });

  it('creates a subspace open to the parent space and stays in its lobby', async () => {
    mocks.createRoom.mockResolvedValue(NEW_SPACE);
    open(PARENT);
    fill('Sub');

    await act(async () => byText('Create')!.click());
    await settle();

    expect(mocks.createRoom.mock.calls[0]![1]).toMatchObject({
      type: RoomType.Space,
      access: CreateRoomAccess.Restricted,
      encryption: false,
      parent: mocks.parent,
    });
    expect(mocks.navigateSpace).not.toHaveBeenCalled();
  });

  it('names its option switches and offers no encryption', () => {
    open();
    const switches = [...host.querySelectorAll('[role="switch"]')].map((node) =>
      node.getAttribute('aria-label')
    );
    expect(switches).toEqual(['Knock to Join', 'Allow Federation']);
    expect(host.textContent).not.toContain('End-to-End Encryption');
    expect(host.textContent).toContain('Anyone can send request to join this space.');
  });

  it('creates once while the first request is still pending', async () => {
    let finish: (roomId: string) => void = () => undefined;
    mocks.createRoom.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      })
    );
    open();
    fill('Team');
    const form = host.querySelector('form')!;

    await act(async () => form.requestSubmit());
    await act(async () => form.requestSubmit());
    await act(async () => finish(NEW_SPACE));

    expect(mocks.createRoom).toHaveBeenCalledOnce();
  });

  it('announces a failure as an alert', async () => {
    mocks.createRoom.mockRejectedValue(new Error('nope'));
    open();
    fill('Team');

    await act(async () => byText('Create')!.click());
    await settle();

    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('opens the advanced options without creating the space', async () => {
    mocks.createRoom.mockResolvedValue(NEW_SPACE);
    open();
    fill('Team');
    const chip = byText('Advanced Options')!;
    expect(host.textContent).not.toContain('Version');

    await act(async () => chip.click());
    await settle();

    expect(mocks.createRoom).not.toHaveBeenCalled();
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('Version');
  });
});
