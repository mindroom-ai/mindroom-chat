// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadsTab } from './ThreadsTab';

const waiting = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../activity/useActivityRows', () => ({ useThreadsNeedsYouCount: () => waiting.count }));

const renderTab = () =>
  render(
    <MemoryRouter initialEntries={['/home/']}>
      <ThreadsTab />
    </MemoryRouter>
  );

afterEach(() => {
  cleanup();
  waiting.count = 0;
});

describe('the rail Threads button', () => {
  it('counts the threads that wait for the user', () => {
    waiting.count = 2;
    renderTab();
    expect(screen.getByRole('button', { name: 'Threads, 2 wait for you' })).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows no count while nothing waits', () => {
    renderTab();
    expect(screen.getByRole('button', { name: 'Threads' })).toBeTruthy();
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });
});
