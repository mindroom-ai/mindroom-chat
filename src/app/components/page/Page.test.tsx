import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { PageRoot } from './Page';

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  return {
    ...actual,
    Box: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    Line: () => React.createElement('hr', { 'data-testid': 'page-nav-divider' }),
  };
});

vi.mock('../../styles/ContainerColor.css', () => ({
  ContainerColor: () => '',
}));

vi.mock('./style.css', () => ({
  PageContent: '',
  PageContentCenter: '',
  PageHeader: () => '',
  PageHeroEmpty: '',
  PageHeroSection: '',
  PageNav: () => '',
  PageNavContent: '',
  PageNavHeader: () => '',
}));

vi.mock('../../hooks/useScreenSize', () => ({
  ScreenSize: {
    Desktop: 'Desktop',
    Mobile: 'Mobile',
  },
  useScreenSizeContext: () => 'Desktop',
}));

describe('PageRoot', () => {
  it('removes the desktop navigation divider when navigation is absent', () => {
    const visible = create(
      <PageRoot nav={<nav data-testid="page-nav" />}>
        <main data-testid="page-content" />
      </PageRoot>
    );

    expect(visible.root.findAllByProps({ 'data-testid': 'page-nav' })).toHaveLength(1);
    expect(visible.root.findAllByProps({ 'data-testid': 'page-nav-divider' })).toHaveLength(1);

    const absent = create(
      <PageRoot nav={null}>
        <main data-testid="page-content" />
      </PageRoot>
    );

    expect(absent.root.findAllByProps({ 'data-testid': 'page-nav' })).toHaveLength(0);
    expect(absent.root.findAllByProps({ 'data-testid': 'page-nav-divider' })).toHaveLength(0);
    expect(absent.root.findAllByProps({ 'data-testid': 'page-content' })).toHaveLength(1);
  });
});
