// @vitest-environment jsdom
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PasswordLoginForm } from './PasswordLoginForm';

vi.mock('./loginUtil', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./loginUtil')>()),
  useLoginComplete: vi.fn(),
  login: vi.fn(async () => {
    const { LoginError, LoginFailure } = await import('./loginUtil');
    throw new LoginFailure(LoginError.Forbidden);
  }),
}));
vi.mock('../../../config/useClientConfig', () => ({ useClientConfig: () => ({}) }));

describe('PasswordLoginForm', () => {
  it('offers the password reset as "Forgot Password?"', () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <MemoryRouter>
          <PasswordLoginForm baseUrl="https://matrix.example.org" server="example.org" />
        </MemoryRouter>
      );
    });
    const texts = renderer.root
      .findAll((node) => typeof node.type === 'string')
      .flatMap((node) => node.children.filter((child) => typeof child === 'string'));
    expect(texts).toContain('Forgot Password?');
  });

  it('points a rejected password at the single sign-on the page offers', async () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <MemoryRouter>
          <PasswordLoginForm
            baseUrl="https://matrix.example.org"
            server="example.org"
            ssoProviderNames="Example ID"
          />
        </MemoryRouter>
      );
    });
    const form = renderer.root.find((node) => node.type === 'form');
    await act(async () => {
      form.props.onSubmit({
        preventDefault: () => undefined,
        target: { usernameInput: { value: 'alice' }, passwordInput: { value: 'wrong' } },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const texts = renderer.root
      .findAll((node) => typeof node.type === 'string')
      .flatMap((node) => node.children.filter((child) => typeof child === 'string'));
    expect(texts).toContain(
      'This account may use Example ID sign-in. Use the Example ID button above.'
    );
  });
});
