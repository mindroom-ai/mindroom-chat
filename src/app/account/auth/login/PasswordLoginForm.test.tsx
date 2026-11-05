// @vitest-environment jsdom
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PasswordLoginForm } from './PasswordLoginForm';

vi.mock('./loginUtil', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./loginUtil')>()),
  useLoginComplete: vi.fn(),
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
});
