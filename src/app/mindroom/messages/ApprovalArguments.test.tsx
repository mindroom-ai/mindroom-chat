import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalArguments } from './ApprovalArguments';
import { parseToolApprovalContent } from './toolApproval';

const mocks = vi.hoisted(() => ({ download: vi.fn(), mx: {} }));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => mocks.mx }));
vi.mock('../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => true }));
vi.mock('./sidecarDownload', () => ({ downloadMindroomSidecarBlob: mocks.download }));
vi.mock('./MindroomToolApprovalCard.css', () => ({ Details: 'Details', JsonBlock: 'JsonBlock' }));
const approval = parseToolApprovalContent('io.mindroom.tool_approval', {
  approval_id: 'one',
  tool_name: 'invite',
  agent_name: 'assistant',
  status: 'approved',
  arguments: { preview: 'truncated' },
  arguments_truncated: true,
  full_arguments_url: 'mxc://example.org/args',
  requested_at: '2026-09-12T12:00:00Z',
  expires_at: '2026-09-12T12:30:00Z',
})!;
let renderer: ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
  mocks.download.mockReset();
});
const toggle = async (open: boolean) => {
  await act(async () => {
    renderer.root.findByType('details').props.onToggle({ currentTarget: { open } });
  });
};

describe('exact approval arguments', () => {
  it('loads on expansion, retries a failure, and retains the complete result after collapse', async () => {
    mocks.download
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(new Blob([JSON.stringify({ user: 'Jamie', room: 'Project' })]));
    act(() => {
      renderer = create(<ApprovalArguments approval={approval} />);
    });
    expect(mocks.download).not.toHaveBeenCalled();
    await toggle(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('Could not load complete arguments.');
    await act(async () => {
      renderer.root.findByType('button').props.onClick();
    });
    expect(renderer.root.findByType('pre').children.join('')).toContain('Jamie');
    await toggle(false);
    await toggle(true);
    expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByType('pre').children.join('')).toContain('Jamie');
  });
  it('does not expose another call’s loaded arguments while its attachment is pending', async () => {
    mocks.download
      .mockResolvedValueOnce(new Blob([JSON.stringify({ user: 'Jamie' })]))
      .mockImplementationOnce(() => new Promise(() => {}));
    act(() => {
      renderer = create(<ApprovalArguments approval={approval} />);
    });
    await toggle(true);
    await act(async () => {
      renderer.update(
        <ApprovalArguments
          approval={{ ...approval, argumentSource: { mxcUri: 'mxc://example.org/other' } }}
        />
      );
    });
    expect(renderer.root.findByType('pre').children.join('')).not.toContain('Jamie');
    expect(JSON.stringify(renderer.toJSON())).toContain('Loading complete arguments');
  });
});

it('keeps one in-flight download when the same attachment is reparsed during chat updates', async () => {
  let finish!: (blob: Blob) => void;
  mocks.download.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  act(() => {
    renderer = create(<ApprovalArguments approval={approval} />);
  });
  await toggle(true);
  await act(async () => {
    renderer.update(
      <ApprovalArguments
        approval={{ ...approval, argumentSource: { ...approval.argumentSource! } }}
      />
    );
  });
  expect(mocks.download).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(new Blob([JSON.stringify({ user: 'Jamie' })]));
  });
  expect(renderer.root.findByType('pre').children.join('')).toContain('Jamie');
});
