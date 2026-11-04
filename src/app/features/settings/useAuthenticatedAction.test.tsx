import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthDict, IAuthData } from 'matrix-js-sdk';
import { AuthenticationCancelled, useAuthenticatedAction } from './useAuthenticatedAction';

// The one user-interactive authentication loop of the app: account deactivation, signing out
// devices and the cross-signing setup all run their request through it.

vi.mock('folds', () => {
  const tag =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(name, props, children);
  return {
    Box: tag('div'),
    Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    Text: tag('span'),
    config: { space: { S400: '16px' } },
  };
});
vi.mock('../../components/glass/GlassPrimitives', () => ({
  Dialog: ({ children }: { children?: React.ReactNode }) => (
    <div role="alertdialog">{children}</div>
  ),
}));
vi.mock('./SettingsOverlay', () => ({
  SettingsOverlay: ({
    children,
    onDismiss,
  }: {
    children: React.ReactNode;
    onDismiss: () => void;
  }) => (
    <section data-overlay data-dismiss={onDismiss}>
      {children}
    </section>
  ),
}));
// The password stage, reduced to the answer it gives.
vi.mock('../../components/ActionUIA', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/ActionUIA')>()),
  ActionUIA: ({ authData, action }: { authData: IAuthData; action: (auth: AuthDict) => void }) => (
    <button
      type="button"
      data-stage-answer
      onClick={() => action({ type: 'm.login.password', session: authData.session })}
    />
  ),
}));

type Action = ReturnType<typeof useAuthenticatedAction>;

const uiaError = (stages: string[], session = 'session-1') =>
  Object.assign(new Error('Unauthorized'), {
    httpStatus: 401,
    data: { session, flows: [{ stages }], params: {} },
  });

const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

const flush = () =>
  act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });

describe('useAuthenticatedAction', () => {
  let renderer: ReactTestRenderer | undefined;
  let action: Action;

  const mount = () => {
    function Host() {
      action = useAuthenticatedAction();
      return <>{action.prompt}</>;
    }
    act(() => {
      renderer = create(<Host />);
    });
  };
  const overlays = () => renderer!.root.findAll((node) => node.props['data-overlay'] === true);
  const answerStage = () =>
    act(() => {
      renderer!.root.findByProps({ 'data-stage-answer': true }).props.onClick();
    });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('runs a request that needs no authentication without asking', async () => {
    mount();
    const request = vi.fn(async () => 'done');

    await expect(action.run(request)).resolves.toBe('done');
    expect(request).toHaveBeenCalledWith(undefined);
    expect(overlays()).toHaveLength(0);
  });

  it('asks for each stage the server wants and retries with the answer', async () => {
    mount();
    const request = vi
      .fn<(auth?: AuthDict) => Promise<string>>()
      .mockRejectedValueOnce(uiaError(['m.login.password'], 'first'))
      .mockRejectedValueOnce(uiaError(['m.login.password'], 'second'))
      .mockResolvedValueOnce('signed out');

    const result = action.run(request);
    await flush();
    expect(overlays()).toHaveLength(1);
    answerStage();
    await flush();
    expect(overlays()).toHaveLength(1);
    answerStage();

    await expect(result).resolves.toBe('signed out');
    const sessionOf = (auth?: AuthDict) =>
      auth && 'session' in auth ? (auth.session as string) : undefined;
    expect(request.mock.calls.map(([auth]) => sessionOf(auth))).toEqual([
      undefined,
      'first',
      'second',
    ]);
    await flush();
    expect(overlays()).toHaveLength(0);
  });

  it('stops with AuthenticationCancelled when the prompt is dismissed', async () => {
    mount();
    const request = vi.fn(async () => {
      throw uiaError(['m.login.password']);
    });

    const result = action.run(request);
    await flush();
    act(() => {
      overlays()[0].props['data-dismiss']();
    });

    await expect(result).rejects.toBeInstanceOf(AuthenticationCancelled);
    expect(request).toHaveBeenCalledTimes(1);
    expect(overlays()).toHaveLength(0);
  });

  it('says so when no flow has only stages it can do, and Cancel stops', async () => {
    mount();
    const result = action.run(async () => {
      throw uiaError(['m.login.recaptcha']);
    });
    await flush();
    const dialog = renderer!.root.find((node) => node.props.role === 'alertdialog');
    expect(textOf(dialog)).toContain(
      'Authentication steps to perform this action are not supported by client.'
    );

    act(() => {
      dialog.find((node) => node.type === 'button').props.onClick();
    });

    await expect(result).rejects.toBeInstanceOf(AuthenticationCancelled);
  });

  it('passes on a failure that is not a request for authentication', async () => {
    mount();
    const refused = Object.assign(new Error('Forbidden'), { httpStatus: 403 });

    await expect(
      action.run(async () => {
        throw refused;
      })
    ).rejects.toBe(refused);
    expect(overlays()).toHaveLength(0);
  });
});
