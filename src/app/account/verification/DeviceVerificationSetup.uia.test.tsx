import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { DeviceVerificationSetup } from './DeviceVerificationSetup';
import { stopPropagation } from '../../lib/keyboard';

type TrapOptions = { onDeactivate: () => void; escapeDeactivates: unknown };

const crypto = vi.hoisted(() => ({
  createRecoveryKeyFromPassphrase: vi.fn(async () => ({ encodedPrivateKey: 'EsTc 1234' })),
  bootstrapCrossSigning: vi.fn(
    async ({
      authUploadDeviceSigningKeys,
    }: {
      authUploadDeviceSigningKeys: (makeRequest: (auth: unknown) => Promise<void>) => Promise<void>;
    }) =>
      authUploadDeviceSigningKeys(async (auth) => {
        if (auth === null) {
          throw Object.assign(new Error('UIA'), {
            data: { flows: [{ stages: ['m.login.recaptcha'] }], session: 'session' },
          });
        }
      })
  ),
  userHasCrossSigningKeys: vi.fn(async () => true),
  bootstrapSecretStorage: vi.fn(async () => undefined),
}));

vi.mock('folds', () => {
  const passthrough =
    (tag: string) =>
    ({ as, children, ...props }: { as?: string; children?: React.ReactNode }) =>
      React.createElement(as ?? tag, props, children);
  const button = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  );
  return {
    Box: passthrough('div'),
    Button: ({
      before,
      children,
      ...props
    }: {
      before?: React.ReactNode;
      children?: React.ReactNode;
    }) => (
      <button type="button" {...props}>
        {before}
        {children}
      </button>
    ),
    Chip: button,
    Icon: () => null,
    IconButton: button,
    Icons: { Check: 'check', Cross: 'cross' },
    Overlay: ({ children }: { children?: React.ReactNode }) => (
      <section data-overlay>{children}</section>
    ),
    OverlayBackdrop: () => null,
    OverlayCenter: passthrough('div'),
    Spinner: () => <i data-spinner />,
    Text: passthrough('span'),
    color: { Critical: { Main: 'red' } },
    config: {
      borderWidth: { B300: '1px' },
      radii: { R400: '4px' },
      space: { S100: '4px', S200: '8px', S300: '12px', S400: '16px' },
    },
  };
});
vi.mock('focus-trap-react', () => ({
  default: ({
    children,
    focusTrapOptions,
  }: {
    children?: React.ReactNode;
    focusTrapOptions: TrapOptions;
  }) => React.createElement('div', { 'data-focus-trap': true, focusTrapOptions }, children),
}));
vi.mock('../../ui/glass/GlassPrimitives', () => ({
  Dialog: ({ children }: { children?: React.ReactNode }) => <div role="dialog">{children}</div>,
  Header: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
}));
vi.mock('../../ui/PasswordInput', () => ({
  PasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getCrypto: () => crypto,
    secretStorage: { hasKey: async () => false },
    getUserId: () => '@alice:example.org',
    getSafeUserId: () => '@alice:example.org',
  }),
}));
vi.mock('file-saver', () => ({ default: { saveAs: vi.fn() } }));
vi.mock('../../matrix/client/secretStorageKeys', () => ({ clearSecretStorageKeys: vi.fn() }));
// The server still has no encryption setup when Continue asks again.
vi.mock('../devices/serverEncryptionSetup', () => ({
  hasServerEncryptionSetup: vi.fn(async () => false),
}));
vi.mock('../../lib/dom', () => ({ copyToClipboard: vi.fn() }));
vi.mock('../../ui/styles/ContainerColor.css', () => ({ ContainerColor: () => '' }));

const UNSUPPORTED = 'Authentication steps to perform this action are not supported by client.';

const flush = () =>
  act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });

const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

const startSetupWithUnsupportedFlow = async (): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<DeviceVerificationSetup onCancel={vi.fn()} />);
  });
  const form = renderer.root.findByType('form');
  act(() => {
    form.props.onSubmit({
      preventDefault: vi.fn(),
      target: {
        recoveryPasswordInput: { value: 'a long recovery password' },
        recoveryPasswordConfirmInput: { value: 'a long recovery password' },
      },
    });
  });
  await flush();
  expect(renderer.root.findAllByProps({ 'data-overlay': true })).toHaveLength(1);
  expect(textOf(renderer.root)).toContain(UNSUPPORTED);
  expect(renderer.root.findAllByProps({ 'data-spinner': true })).toHaveLength(1);
  return renderer;
};

const expectSetupStopped = (renderer: ReactTestRenderer) => {
  expect(renderer.root.findAllByProps({ 'data-overlay': true })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ 'data-spinner': true })).toHaveLength(0);
  const error = renderer.root.findAllByType('b').at(-1);
  expect(error && textOf(error)).toBe('Unexpected Error!');
  // The cross-signing keys are published first, and their upload asks for the authentication;
  // the setup stops there, before any secret storage or key backup is made, and shows no key.
  expect(crypto.bootstrapCrossSigning).toHaveBeenCalled();
  expect(crypto.bootstrapSecretStorage).not.toHaveBeenCalled();
  expect(textOf(renderer.root)).not.toContain('EsTc 1234');
};

describe('DeviceVerificationSetup unsupported auth flow', () => {
  it('closes from the Cancel button and stops the setup', async () => {
    const renderer = await startSetupWithUnsupportedFlow();
    const overlay = renderer.root.findByProps({ 'data-overlay': true });
    const close = overlay.find((node) => node.type === 'button' && textOf(node) === 'Cancel');

    act(() => {
      close.props.onClick();
    });
    await flush();

    expectSetupStopped(renderer);
  });

  it('closes on Escape and stops the setup', async () => {
    const renderer = await startSetupWithUnsupportedFlow();
    const trap = renderer.root.findByProps({ 'data-focus-trap': true });
    const options = trap.props.focusTrapOptions as TrapOptions;
    expect(options.escapeDeactivates).toBe(stopPropagation);

    act(() => {
      options.onDeactivate();
    });
    await flush();

    expectSetupStopped(renderer);
  });
});

describe('DeviceVerificationSetup password fields', () => {
  it('asks password managers for a new secret, not the account password', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<DeviceVerificationSetup onCancel={vi.fn()} />);
    });

    const inputs = renderer.root.findAllByType('input');
    expect(inputs.map((input) => input.props.name)).toEqual([
      undefined,
      'recoveryPasswordInput',
      'recoveryPasswordConfirmInput',
    ]);
    // A username of its own keeps the recovery password apart from the saved login.
    expect(inputs.map((input) => input.props.autoComplete)).toEqual([
      'username',
      'new-password',
      'new-password',
    ]);
    expect(inputs[0]?.props.value).toBe('@alice:example.org recovery password');
  });
});
