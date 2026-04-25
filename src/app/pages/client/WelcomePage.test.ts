import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { create } from 'react-test-renderer';
import { WelcomePage } from './WelcomePage';
import { useClientConfig } from '../../hooks/useClientConfig';

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Box: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => reactModule.createElement('div', props, children),
    Button: ({
      before,
      children,
      ...props
    }: {
      before?: React.ReactNode;
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => reactModule.createElement('a', props, before, children),
    config: {
      space: {
        S400: '16px',
        S700: '28px',
      },
    },
    Icon: (props: { [key: string]: unknown }) => reactModule.createElement('icon', props),
    Icons: {
      Code: () => null,
      Info: () => null,
    },
    Text: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => reactModule.createElement('span', props, children),
    toRem: (value: number) => `${value / 16}rem`,
  };
});

vi.mock('../../components/page', async () => {
  const reactModule = await import('react');
  const passthrough = ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => reactModule.createElement('section', props, children);

  return {
    Page: passthrough,
    PageHero: passthrough,
    PageHeroSection: passthrough,
  };
});

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

    const renderer = create(React.createElement(WelcomePage));

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

    const renderer = create(React.createElement(WelcomePage));

    const docsLinks = renderer.root.findAll(
      (node) => node.props?.href === 'https://docs.example.test'
    );
    expect(docsLinks.length).toBe(0);

    const emptyDocsLinks = renderer.root.findAll((node) => node.props?.href === '');
    expect(emptyDocsLinks.length).toBe(0);
  });
});
