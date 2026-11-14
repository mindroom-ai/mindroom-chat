import React from 'react';
import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider, Trans } from 'react-i18next';
import { Link } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../i18n/englishResources';
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
const authServer = vi.hoisted(() => ({ name: 'example.test' }));
const identityProviders = vi.hoisted(() => ({ list: [{ id: 'idp', name: 'Example ID' }] }));
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
        { type: 'm.login.sso', identity_providers: identityProviders.list },
      ],
    }),
  }),
}));
vi.mock('../../../matrix/hooks/useAutoDiscoveryInfo', () => ({
  useAutoDiscoveryInfo: () => ({ 'm.homeserver': { base_url: 'https://example.test' } }),
}));
vi.mock('../useAuthServer', () => ({ useAuthServer: () => authServer.name }));
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

type Renderer = ReturnType<typeof create>;
type Node = Renderer['root'];

const textOf = (node: Node): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

/** Asks for the reset email, which the mocked server refuses with `resetError.errcode`. */
const submitResetRequest = async (renderer: Renderer) => {
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
};

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
    await submitResetRequest(renderer);
    resetError.errcode = 'M_UNKNOWN';

    const alert = renderer.root.findByProps({ role: 'alert' });
    expect(textOf(alert)).toBe('No email resets. If you used Example ID, sign in with Example ID.');
    expect(alert.findByType('a')).toBeDefined();
    expect(renderer.root.findAll((node) => node.props['data-field-error'])).toHaveLength(0);
  });
});

describe('PasswordResetForm with names from the server', () => {
  afterEach(() => {
    authServer.name = 'example.test';
    identityProviders.list = [{ id: 'idp', name: 'Example ID' }];
    resetError.errcode = 'M_UNKNOWN';
    requestEmail.fn = () => Promise.resolve();
  });

  // The app's English and its interpolation setting, which leaves values unescaped.
  const render = async (form: React.ReactElement) => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
      resources: { en: { translation: en } },
    });
    let renderer!: Renderer;
    await act(async () => {
      renderer = create(<I18nextProvider i18n={language}>{form}</I18nextProvider>);
    });
    return renderer;
  };
  /** What a sentence under `node` renders: its elements and components, without `Trans`. */
  const elementsIn = (node: Node) =>
    node.findAll((child) => child !== node && child.type !== Trans);

  it('shows a server name that holds markup as text, in one bold name with no added props', async () => {
    // A server name, read from the page's address, that would add an inline handler to the
    // bold name it fills, read as markup.
    authServer.name = '<strong is onclick="alert(1)">example.test</strong>';
    const renderer = await render(<PasswordResetForm />);

    const strong = renderer.root.findAll((node) => node.type === 'strong');
    expect(strong).toHaveLength(1);
    expect(Object.keys(strong[0]?.props ?? {})).toEqual(['children']);
    expect(strong[0]?.children).toEqual([authServer.name]);
    expect(strong[0]?.parent && textOf(strong[0].parent)).toBe(
      `Homeserver ${authServer.name} will send you an email to let you reset your password.`
    );
  });

  it.each([
    ['the sign-in link', '/login/example.test/', [Link, 'a'], ['children', 'to']],
    ['the plain name without a sign-in page', undefined, ['span'], ['children']],
  ])(
    'shows a provider name that holds markup as text, around %s',
    async (_case, loginLink, elements, authLinkProps) => {
      // A provider name from the server's sign-in flows that would add an inline handler to the
      // sign-in link it fills, read as markup.
      const name = '<authLink is onclick="alert(1)">Example</authLink>';
      identityProviders.list = [{ id: 'idp', name }];
      resetError.errcode = 'M_THREEPID_DENIED';
      requestEmail.fn = () => Promise.reject({ errcode: 'M_THREEPID_DENIED' });
      const renderer = await render(<PasswordResetForm loginLink={loginLink} />);
      await submitResetRequest(renderer);

      // Inside the alert's line, only the sign-in element and what it renders.
      const alert = renderer.root.findByProps({ role: 'alert' });
      const inside = elementsIn(alert).filter((node) => node.props.role !== 'alert');
      expect(inside.map((node) => node.type)).toEqual(elements);
      expect(Object.keys(inside[0]?.props ?? {}).sort()).toEqual(authLinkProps);
      expect(inside[0] && textOf(inside[0])).toBe(`sign in with ${name}`);
      expect(textOf(alert)).toBe(
        `This server can't reset passwords by email. If you signed up with ${name}, sign in with ${name} instead.`
      );
    }
  );
});
