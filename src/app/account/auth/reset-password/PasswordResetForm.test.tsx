import React from 'react';
import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { PasswordResetForm } from './PasswordResetForm';

vi.mock('folds', () => ({
  Box: ({ as = 'div', children, ...props }: { as?: string; children?: React.ReactNode }) =>
    React.createElement(as, props, children),
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Dialog: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Overlay: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  OverlayBackdrop: () => null,
  OverlayCenter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Spinner: () => null,
  Text: ({ as = 'span', children, ...props }: { as?: string; children?: React.ReactNode }) =>
    React.createElement(as, props, children),
  color: { Critical: { Main: 'red' } },
  config: { space: { S400: '16px' } },
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
const resetError = vi.hoisted(() => ({ errcode: 'M_UNKNOWN' }));
const requestEmail = vi.hoisted(() => ({ fn: (): Promise<unknown> => Promise.resolve() }));
vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));
vi.mock('../../../matrix/client/matrixClientFactory', () => ({
  createMatrixClient: () => ({
    generateClientSecret: () => 'secret',
    loginFlows: async () => ({
      flows: [
        { type: 'm.login.password' },
        { type: 'm.login.sso', identity_providers: [{ id: 'idp', name: 'Example ID' }] },
      ],
    }),
  }),
}));
vi.mock('../../../matrix/hooks/useAutoDiscoveryInfo', () => ({
  useAutoDiscoveryInfo: () => ({ 'm.homeserver': { base_url: 'https://example.test' } }),
}));
vi.mock('../useAuthServer', () => ({ useAuthServer: () => 'example.test' }));
vi.mock('../../../lib/hooks/useAsyncCallback', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/hooks/useAsyncCallback')>(
    '../../../lib/hooks/useAsyncCallback'
  );
  return {
    ...actual,
    useAsyncCallback: () => [
      { status: actual.AsyncStatus.Error, error: { errcode: resetError.errcode, data: {} } },
      () => requestEmail.fn(),
    ],
  };
});
vi.mock('../../../ui/PasswordInput', () => ({
  PasswordInput: React.forwardRef((props, ref) => <input ref={ref} {...props} />),
}));
vi.mock('../FiledError', () => ({
  FieldError: ({ message }: { message: string }) => <div data-field-error={message} />,
}));

describe('PasswordResetForm', () => {
  it('updates the generic reset failure after a language change', async () => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: {
        en: {
          translation: {
            sharedUi: {
              passwordResetForm: { failedToResetPassword: 'Failed to reset password.' },
            },
          },
        },
        de: {
          translation: {
            sharedUi: {
              passwordResetForm: {
                failedToResetPassword: 'Passwort konnte nicht zurückgesetzt werden.',
              },
            },
          },
        },
      },
    });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <PasswordResetForm />
        </I18nextProvider>
      );
    });

    expect(
      renderer!.root.findByProps({
        'data-field-error': 'M_UNKNOWN: Failed to reset password.',
      })
    ).toBeDefined();
    await act(async () => {
      await language.changeLanguage('de');
    });
    expect(
      renderer!.root.findByProps({
        'data-field-error': 'M_UNKNOWN: Passwort konnte nicht zurückgesetzt werden.',
      })
    ).toBeDefined();
  });

  it('sends a server without email resets to its single sign-on', async () => {
    resetError.errcode = 'M_THREEPID_DENIED';
    requestEmail.fn = () => Promise.reject({ errcode: 'M_THREEPID_DENIED' });
    const language = createInstance();
    await language.init({
      lng: 'en',
      react: { useSuspense: false },
      resources: {
        en: {
          translation: {
            sharedUi: {
              passwordResetForm: {
                emailResetUnavailableSso:
                  'No email resets. If you used {{provider}}, <authLink>sign in with {{provider}}</authLink>.',
              },
            },
          },
        },
      },
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <PasswordResetForm loginLink="/login/example.test/" />
        </I18nextProvider>
      );
    });
    const form = renderer.root.findByType('form');
    await act(async () => {
      const fields = {
        emailInput: 'a@example.test',
        passwordInput: 'pw',
        confirmPasswordInput: 'pw',
      };
      const currentTarget = { elements: fields } as unknown as HTMLFormElement;
      vi.stubGlobal(
        'FormData',
        class {
          get = (name: keyof typeof fields) => fields[name];
        }
      );
      form.props.onSubmit({ preventDefault: () => undefined, currentTarget });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    vi.unstubAllGlobals();
    resetError.errcode = 'M_UNKNOWN';

    const alert = renderer.root.findByProps({ role: 'alert' });
    const text = (node: typeof alert): string =>
      node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('');
    expect(text(alert)).toBe('No email resets. If you used Example ID, sign in with Example ID.');
    expect(alert.findByType('a')).toBeDefined();
    expect(renderer.root.findAll((node) => node.props['data-field-error'])).toHaveLength(0);
  });
});
