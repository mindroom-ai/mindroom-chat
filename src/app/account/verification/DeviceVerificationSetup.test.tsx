import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceVerificationSetup } from './DeviceVerificationSetup';
import { englishCatalog } from '../../i18n/englishResources';

const mocks = vi.hoisted(() => ({
  error: new Error(),
  retry: vi.fn(),
  // The retained-error tests fix the setup's state; the others run the real one.
  fixedState: true,
  setUpRecovery: vi.fn(),
  hasServerEncryptionSetup: vi.fn(),
}));

vi.mock('folds', () => ({
  Box: ({ as = 'div', children, ...props }: { as?: string; children?: React.ReactNode }) =>
    React.createElement(as, props, children),
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Checkbox: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input type="checkbox" {...props} />
  ),
  Chip: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Dialog: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Header: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
  Icon: () => null,
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Icons: { Cross: 'cross' },
  Spinner: () => null,
  Text: ({ as = 'span', children, ...props }: { as?: string; children?: React.ReactNode }) =>
    React.createElement(as, props, children),
  color: { Critical: { Main: 'red' } },
  config: {
    borderWidth: { B300: '1px' },
    radii: { R400: '4px' },
    space: { S100: '4px', S200: '8px', S300: '12px', S400: '16px' },
  },
}));
vi.mock('file-saver', () => ({ default: { saveAs: vi.fn() } }));
vi.mock('../../ui/PasswordInput', () => ({
  PasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('../uia/ActionUIA', () => ({
  ActionUIA: () => null,
  ActionUIAFlowsLoader: () => null,
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@alice:example.org' }),
}));
vi.mock('../../lib/hooks/useAlive', () => ({ useAlive: () => () => true }));
vi.mock('../../lib/hooks/useAsyncCallback', async () => {
  const actual = await vi.importActual<typeof import('../../lib/hooks/useAsyncCallback')>(
    '../../lib/hooks/useAsyncCallback'
  );
  return {
    ...actual,
    useAsyncCallback: (callback: Parameters<typeof actual.useAsyncCallback>[0]) =>
      mocks.fixedState
        ? [{ status: actual.AsyncStatus.Error, error: mocks.error }, mocks.retry]
        : actual.useAsyncCallback(callback),
  };
});
vi.mock('../encryption/recoveryPassword', async () => ({
  ...(await vi.importActual<typeof import('../encryption/recoveryPassword')>(
    '../encryption/recoveryPassword'
  )),
  setUpRecovery: mocks.setUpRecovery,
}));
vi.mock('../../matrix/client/secretStorageKeys', () => ({ clearSecretStorageKeys: vi.fn() }));
vi.mock('../devices/serverEncryptionSetup', () => ({
  hasServerEncryptionSetup: mocks.hasServerEncryptionSetup,
}));
vi.mock('../../lib/dom', () => ({ copyToClipboard: vi.fn() }));
vi.mock('../../ui/styles/ContainerColor.css', () => ({ ContainerColor: () => '' }));

const internalErrors = [
  'Unexpected Error! UIA action is perform without data.',
  'Authentication failed! Failed to setup device verification.',
  'Unexpected Error! Crypto module not found!',
  'Unexpected Error! Failed to create recovery key.',
];

const createLanguage = async () => {
  const language = createInstance();
  await language.init({
    lng: 'en',
    fallbackLng: 'en',
    react: { useSuspense: false },
    resources: {
      en: {
        translation: {
          sharedUi: { deviceVerificationSetup: { unexpectedError: 'Unexpected Error!' } },
        },
      },
      de: {
        translation: {
          sharedUi: { deviceVerificationSetup: { unexpectedError: 'Unerwarteter Fehler!' } },
        },
      },
    },
  });
  return language;
};

describe('DeviceVerificationSetup retained errors', () => {
  beforeEach(() => {
    mocks.fixedState = true;
    mocks.retry.mockClear();
  });

  it.each(internalErrors)(
    'updates the internal failure after a language change without retrying: %s',
    async (message) => {
      mocks.error = new Error(message);
      const language = await createLanguage();
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <I18nextProvider i18n={language}>
            <DeviceVerificationSetup onCancel={vi.fn()} />
          </I18nextProvider>
        );
      });

      expect(renderer.root.findByType('b').children.join('')).toBe('Unexpected Error!');
      await act(async () => {
        await language.changeLanguage('de');
      });
      expect(renderer.root.findByType('b').children.join('')).toBe('Unerwarteter Fehler!');
      expect(mocks.retry).not.toHaveBeenCalled();
    }
  );

  it('preserves an unrelated setup error', () => {
    mocks.error = new Error('Homeserver unavailable');
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<DeviceVerificationSetup onCancel={vi.fn()} />);
    });

    expect(renderer.root.findAllByType('b').at(-1)?.children.join('')).toBe(
      'Homeserver unavailable'
    );
  });
});

type Fields = { recoveryPasswordInput: string; recoveryPasswordConfirmInput: string };

const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

const buttonNamed = (renderer: ReactTestRenderer, name: string) =>
  renderer.root.findAll((node) => node.type === 'button' && textOf(node) === name)[0];

const flush = () =>
  act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });

describe('DeviceVerificationSetup recovery password', () => {
  const renderSetup = async (
    onCancel = vi.fn(),
    props: Partial<React.ComponentProps<typeof DeviceVerificationSetup>> = {}
  ) => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      react: { useSuspense: false },
      resources: { en: { translation: englishCatalog } },
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <DeviceVerificationSetup onCancel={onCancel} {...props} />
        </I18nextProvider>
      );
    });
    return renderer;
  };

  const submit = async (renderer: ReactTestRenderer, fields: Fields) => {
    const target = Object.fromEntries(
      Object.entries(fields).map(([name, value]) => [name, { value }])
    );
    act(() => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn(), target });
    });
    await flush();
  };

  const same = (password: string): Fields => ({
    recoveryPasswordInput: password,
    recoveryPasswordConfirmInput: password,
  });

  beforeEach(() => {
    mocks.fixedState = false;
    mocks.setUpRecovery.mockReset();
    mocks.setUpRecovery.mockResolvedValue('EsTc 1234');
    mocks.hasServerEncryptionSetup.mockReset();
    mocks.hasServerEncryptionSetup.mockResolvedValue(false);
  });

  it('refuses a password shorter than 12 characters', async () => {
    const renderer = await renderSetup();
    await submit(renderer, same('too short'));

    expect(textOf(renderer.root)).toContain('Use at least 12 characters.');
    expect(mocks.setUpRecovery).not.toHaveBeenCalled();
  });

  it('refuses passwords that do not match', async () => {
    const renderer = await renderSetup();
    await submit(renderer, {
      recoveryPasswordInput: 'a long recovery password',
      recoveryPasswordConfirmInput: 'a long recovery passwore',
    });

    expect(textOf(renderer.root)).toContain("The passwords don't match.");
    expect(mocks.setUpRecovery).not.toHaveBeenCalled();
  });

  it('runs the setup with the trimmed password', async () => {
    const renderer = await renderSetup();
    await submit(renderer, same(' a long recovery password '));

    expect(mocks.setUpRecovery).toHaveBeenCalledTimes(1);
    expect(mocks.setUpRecovery.mock.calls[0]?.[1]).toBe('a long recovery password');
  });

  it('Done stays disabled until the saved box is ticked', async () => {
    const renderer = await renderSetup();
    await submit(renderer, same('a long recovery password'));

    expect(buttonNamed(renderer, 'Done')?.props.disabled).toBe(true);
    act(() => {
      renderer.root.findByType('input').props.onClick();
    });
    expect(buttonNamed(renderer, 'Done')?.props.disabled).toBe(false);
  });

  it('shows the recovery key only after asking for it', async () => {
    const renderer = await renderSetup();
    await submit(renderer, same('a long recovery password'));

    expect(textOf(renderer.root)).not.toContain('EsTc 1234');
    act(() => {
      buttonNamed(renderer, 'Recovery key for other apps')?.props.onClick();
    });
    expect(textOf(renderer.root)).toContain('EsTc 1234');
    expect(buttonNamed(renderer, 'Copy')).toBeDefined();
    expect(buttonNamed(renderer, 'Download')).toBeDefined();
  });

  it('Not now closes before the setup starts and is gone while it runs', async () => {
    const onCancel = vi.fn();
    const renderer = await renderSetup(onCancel);
    act(() => {
      buttonNamed(renderer, 'Not now')?.props.onClick();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);

    mocks.setUpRecovery.mockReturnValue(new Promise(() => undefined));
    await submit(renderer, same('a long recovery password'));
    expect(buttonNamed(renderer, 'Not now')).toBeUndefined();
  });

  it('asks the server again at Continue and sets nothing up over a setup made meanwhile', async () => {
    mocks.hasServerEncryptionSetup.mockResolvedValue(true);
    const onCancel = vi.fn();
    const onExistingSetup = vi.fn();
    const renderer = await renderSetup(onCancel, { onExistingSetup });
    await submit(renderer, same('a long recovery password'));

    expect(mocks.hasServerEncryptionSetup).toHaveBeenCalledTimes(1);
    expect(mocks.setUpRecovery).not.toHaveBeenCalled();
    expect(onExistingSetup).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('closes without setting up when no one takes a setup found meanwhile', async () => {
    mocks.hasServerEncryptionSetup.mockResolvedValue(true);
    const onCancel = vi.fn();
    const renderer = await renderSetup(onCancel);
    await submit(renderer, same('a long recovery password'));

    expect(mocks.setUpRecovery).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('sets nothing up and says so when the check at Continue fails', async () => {
    mocks.hasServerEncryptionSetup.mockRejectedValue(new Error('offline'));
    const onExistingSetup = vi.fn();
    const renderer = await renderSetup(vi.fn(), { onExistingSetup });
    await submit(renderer, same('a long recovery password'));

    expect(mocks.setUpRecovery).not.toHaveBeenCalled();
    expect(onExistingSetup).not.toHaveBeenCalled();
    expect(textOf(renderer.root)).toContain("Couldn't check your encryption setup.");

    // Continue asks again.
    mocks.hasServerEncryptionSetup.mockResolvedValue(false);
    await submit(renderer, same('a long recovery password'));
    expect(mocks.setUpRecovery).toHaveBeenCalledTimes(1);
  });

  it('sets up without asking again once a reset was confirmed', async () => {
    mocks.hasServerEncryptionSetup.mockResolvedValue(true);
    const renderer = await renderSetup(vi.fn(), { confirmFresh: false });
    await submit(renderer, same('a long recovery password'));

    expect(mocks.hasServerEncryptionSetup).not.toHaveBeenCalled();
    expect(mocks.setUpRecovery).toHaveBeenCalledTimes(1);
  });
});
