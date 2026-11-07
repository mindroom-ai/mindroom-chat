import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { AuthFooter } from './AuthFooter';

vi.mock('./styles.css', () => ({ AuthFooter: 'auth-footer' }));
vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <footer>{children}</footer>,
  Text: ({ children, dir }: { children?: React.ReactNode; dir?: string }) => (
    <p dir={dir}>{children}</p>
  ),
}));

const renderFooter = (config: ClientConfig) =>
  renderToStaticMarkup(
    <ClientConfigProvider value={config}>
      <AuthFooter />
    </ClientConfigProvider>
  );

describe('AuthFooter branding', () => {
  it('shows the footer text as plain text before the credits, and its links after them', () => {
    const html = renderFooter({
      auth: { supportUrl: 'https://example.test/support' },
      branding: {
        footer: {
          text: '<b>Example Co</b> team chat',
          links: [
            { label: 'Imprint', url: 'https://example.test/imprint' },
            { label: 'Help desk', url: 'mailto:help@example.test' },
          ],
        },
      },
    });
    expect(html).toContain('<p dir="auto">&lt;b&gt;Example Co&lt;/b&gt; team chat</p>');
    expect(html).not.toContain('<b>');
    const order = ['team chat', 'Powered by', 'Support', 'Imprint', 'Help desk'].map((text) =>
      html.indexOf(text)
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain(
      '<a href="https://example.test/imprint" target="_blank" rel="noreferrer">Imprint</a>'
    );
    expect(html).toContain(
      '<a href="mailto:help@example.test" target="_blank" rel="noreferrer">Help desk</a>'
    );
  });

  it('shows a footer text list as one line with its links inside', () => {
    const html = renderFooter({
      branding: {
        footer: {
          text: [
            { label: 'Example', url: 'https://example.test/source' },
            ' by ',
            { label: 'Example Co', url: 'https://example.test' },
          ],
        },
      },
    });
    expect(html).toContain(
      '<p dir="auto"><a href="https://example.test/source" target="_blank" rel="noreferrer">Example</a> by <a href="https://example.test" target="_blank" rel="noreferrer">Example Co</a></p>'
    );
  });

  it('never links a script address from the credits, policy pages or footer links', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const html = renderFooter({
      auth: {
        poweredBy: [{ label: 'Bad credit', url: 'javascript:alert(1)' }],
        privacyUrl: 'javascript:alert(2)',
      },
      branding: {
        footer: {
          text: [{ label: 'Bad text link', url: 'javascript:alert(4)' }],
          links: [{ label: 'Bad link', url: 'javascript:alert(3)' }],
        },
      },
    });
    expect(html).toContain('<p dir="auto">Bad text link</p>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('Bad credit');
    expect(html).not.toContain('Bad link');
    expect(html).not.toContain('Privacy');
  });
});
