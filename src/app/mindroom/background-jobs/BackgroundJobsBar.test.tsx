// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import type { BackgroundJob } from './backgroundJobsContract';
import { BackgroundJobsBar } from './BackgroundJobsBar';

const state = vi.hoisted(() => ({ jobs: [] as BackgroundJob[], send: vi.fn() }));
vi.mock('./useBackgroundJobs', () => ({ useBackgroundJobs: () => state.jobs }));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ sendEvent: state.send }),
}));
vi.mock('./backgroundJobsBar.css', () => ({
  Bar: 'Bar',
  Status: 'Status',
  Items: 'Items',
  Item: 'Item',
  Chip: 'Chip',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}${values ? JSON.stringify(values) : ''}`,
  }),
}));

const job = (jobId: string, overrides: Partial<BackgroundJob> = {}): BackgroundJob => ({
  jobId,
  agentId: '@mindroom_code:example.org',
  threadId: '$thread',
  kind: 'tool',
  tool: `tool_${jobId}`,
  status: 'running',
  requesterId: '@alice:example.org',
  startedAt: '2026-10-11T00:00:00+00:00',
  ...overrides,
});

const room = { roomId: '!room:example.org' } as Room;
let container: HTMLDivElement;
let root: Root;

const render = () =>
  act(() => {
    root.render(<BackgroundJobsBar room={room} threadId="$thread" />);
  });
const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (item) => item.getAttribute('aria-label') === label || item.textContent === label
  );

beforeEach(() => {
  state.jobs = [];
  state.send = vi.fn().mockResolvedValue({ event_id: '$sent' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('renders nothing without jobs', () => {
  render();
  expect(container.innerHTML).toBe('');
});

it('shows Stopping until the job leaves the state', async () => {
  state.jobs = [job('a')];
  render();
  await act(async () => {
    button('mindroomUi.backgroundJobs.cancel{"tool":"tool_a"}')?.click();
  });
  expect(container.textContent).toContain('mindroomUi.backgroundJobs.stopping');
  state.jobs = [];
  render();
  expect(container.innerHTML).toBe('');
});

it('restores the button and shows an error when the send fails', async () => {
  state.jobs = [job('a')];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await act(async () => {
    button('mindroomUi.backgroundJobs.cancel{"tool":"tool_a"}')?.click();
  });
  expect(container.textContent).not.toContain('mindroomUi.backgroundJobs.stopping');
  expect(button('mindroomUi.backgroundJobs.cancel{"tool":"tool_a"}')).toBeDefined();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('cancelFailed');
});

it('stop all sends one event for the view and marks every job stopping', async () => {
  state.jobs = [job('a'), job('b', { agentId: '@mindroom_research:example.org' })];
  render();
  await act(async () => {
    button('mindroomUi.backgroundJobs.stopAll')?.click();
  });
  expect(state.send).toHaveBeenCalledTimes(1);
  expect(
    container.querySelectorAll('button[aria-label^="mindroomUi.backgroundJobs.cancel"]')
  ).toHaveLength(0);
});
