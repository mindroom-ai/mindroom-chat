import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { create } from 'react-test-renderer';
import { WelcomePage } from './WelcomePage';
import { useClientConfig } from '../../hooks/useClientConfig';

vi.mock('../../hooks/useClientConfig', () => ({
  useClientConfig: vi.fn(),
}));

const useClientConfigMock = vi.mocked(useClientConfig);

describe('WelcomePage', () => {
  it('renders docs button when docsUrl is set and icons are safe', () => {
    useClientConfigMock.mockReturnValue({
      welcome: {
        docsUrl: 'https://docs.example.test',
        docsLabel: 'Docs',
        sourceUrl: 'https://source.example.test',
        sourceLabel: 'Source',
      },
    });

    const renderer = create(<WelcomePage />);

    const docsLinks = renderer.root.findAll(
      (node) => node.props?.href === 'https://docs.example.test'
    );
    expect(docsLinks.length).toBeGreaterThan(0);

    const iconNodes = renderer.root.findAll((node) => node.props?.src && node.props?.size);
    expect(iconNodes.length).toBeGreaterThan(0);
    iconNodes.forEach((node) => {
      expect(typeof node.props.src).toBe('function');
    });
  });

  it('does not render docs button when docsUrl is empty', () => {
    useClientConfigMock.mockReturnValue({
      welcome: {
        docsUrl: '',
        docsLabel: 'Docs',
        sourceUrl: 'https://source.example.test',
      },
    });

    const renderer = create(<WelcomePage />);

    const docsLinks = renderer.root.findAll(
      (node) => node.props?.href === 'https://docs.example.test'
    );
    expect(docsLinks.length).toBe(0);

    const emptyDocsLinks = renderer.root.findAll((node) => node.props?.href === '');
    expect(emptyDocsLinks.length).toBe(0);
  });
});
