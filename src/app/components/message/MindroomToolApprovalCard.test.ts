/* eslint-disable react/prop-types */
import React from 'react';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MindroomToolApprovalCard } from './MindroomToolApprovalCard';
import { ToolApprovalData } from './mindroomToolApproval';

const approveRequestMock = vi.fn();
const denyRequestMock = vi.fn();

vi.mock('folds', () => ({
  Box: ({
    as: Tag = 'div',
    children,
    ...props
  }: {
    as?: keyof JSX.IntrinsicElements;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement(Tag, props, children),
  Button: React.forwardRef<
    HTMLButtonElement,
    {
      children?: React.ReactNode;
      onClick?: () => void;
      [key: string]: unknown;
    }
  >(({ children, onClick, ...props }, ref) =>
    React.createElement('button', { ...props, onClick, ref, type: props.type ?? 'button' }, children)
  ),
  Icon: ({ src }: { src?: string }) => React.createElement('span', null, src ?? 'icon'),
  Icons: {
    Check: 'Check',
    CheckTwice: 'CheckTwice',
    ChevronBottom: 'ChevronBottom',
    Code: 'Code',
    Cross: 'Cross',
    Warning: 'Warning',
  },
  Input: React.forwardRef<
    HTMLInputElement,
    {
      onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
      [key: string]: unknown;
    }
  >(({ onChange, ...props }, ref) => React.createElement('input', { ...props, onChange, ref })),
  Spinner: () => React.createElement('span', null, 'spinner'),
  Text: ({ as: Tag = 'span', children, ...props }: any) => React.createElement(Tag, props, children),
}));

vi.mock('./MindroomToolApprovalCard.css.ts', () => ({
  Card: 'Card',
  CardApproved: 'CardApproved',
  CardDenied: 'CardDenied',
  CardExpired: 'CardExpired',
  Header: 'Header',
  ToolName: 'ToolName',
  StatusLabel: 'StatusLabel',
  Meta: 'Meta',
  MetaDot: 'MetaDot',
  Details: 'Details',
  DetailsSummary: 'DetailsSummary',
  DetailsSummaryLabel: 'DetailsSummaryLabel',
  JsonBlock: 'JsonBlock',
  Actions: 'Actions',
  DenyForm: 'DenyForm',
  ReasonText: 'ReasonText',
}));

vi.mock('../../hooks/useRelativeTime', () => ({
  useRelativeTime: (ts?: number) => (typeof ts === 'number' ? `relative-${ts}` : ''),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getAccessToken: () => 'matrix-token-123',
  }),
}));

vi.mock('../../features/approvals/api', () => ({
  approveRequest: (approvalId: string, accessToken?: string) =>
    approveRequestMock(approvalId, accessToken),
  denyRequest: (approvalId: string, reason?: string, accessToken?: string) =>
    denyRequestMock(approvalId, reason, accessToken),
}));

const pendingApproval: ToolApprovalData = {
  approvalId: 'approval-1',
  toolName: 'web_search',
  arguments: { query: 'release date' },
  agentName: 'research',
  status: 'pending',
  createdAt: '2026-04-10T12:00:00Z',
  expiresAt: '2026-04-17T12:00:00Z',
  resolvedAt: null,
  resolvedBy: null,
  resolutionReason: null,
};

const getNodeText = (value: ReactTestInstance | string): string => {
  if (typeof value === 'string') return value;
  return value.children.map((child) => getNodeText(child as ReactTestInstance | string)).join('');
};

const findButtonByText = (root: ReactTestInstance, label: string): ReactTestInstance =>
  root.findAllByType('button').find((node) => {
    const text = getNodeText(node);
    return text.includes(label);
  }) as ReactTestInstance;

const getReactNodeText = (node: React.ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return `${node}`;
  if (Array.isArray(node)) return node.map((child) => getReactNodeText(child)).join('');
  if (!React.isValidElement(node)) return '';

  return getReactNodeText((node.props as { children?: React.ReactNode }).children);
};

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

describe('MindroomToolApprovalCard', () => {
  beforeEach(() => {
    approveRequestMock.mockReset();
    denyRequestMock.mockReset();
  });

  it('renders pending approvals with action buttons', () => {
    const renderer = create(React.createElement(MindroomToolApprovalCard, { approval: pendingApproval }));
    const text = getNodeText(renderer.root);

    expect(text).toContain('web_search');
    expect(text).toContain('Pending approval');
    expect(text).toContain('Arguments');
    expect(text).toContain('Approve');
    expect(text).toContain('Deny');

    renderer.unmount();
  });

  it('submits approval requests directly from the card', async () => {
    approveRequestMock.mockResolvedValue(undefined);
    const renderer = create(React.createElement(MindroomToolApprovalCard, { approval: pendingApproval }));

    await act(async () => {
      findButtonByText(renderer.root, 'Approve').props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(approveRequestMock).toHaveBeenCalledWith('approval-1', 'matrix-token-123');

    renderer.unmount();
  });

  it('ignores rapid duplicate approve clicks before loading state re-renders', async () => {
    const deferred = createDeferred();
    approveRequestMock.mockImplementation(() => deferred.promise);
    const renderer = create(React.createElement(MindroomToolApprovalCard, { approval: pendingApproval }));

    await act(async () => {
      const approveButton = findButtonByText(renderer.root, 'Approve');
      approveButton.props.onClick();
      approveButton.props.onClick();
      await Promise.resolve();
    });

    expect(approveRequestMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    renderer.unmount();
  });

  it('collects an optional deny reason before submitting', async () => {
    denyRequestMock.mockResolvedValue(undefined);
    const renderer = create(React.createElement(MindroomToolApprovalCard, { approval: pendingApproval }));

    act(() => {
      findButtonByText(renderer.root, 'Deny').props.onClick();
    });

    const input = renderer.root.findByType('input');
    expect(input.props['aria-label']).toBe('Deny reason (optional)');

    act(() => {
      input.props.onChange({ currentTarget: { value: 'Needs approval from ops' } });
    });

    await act(async () => {
      renderer.root.findByProps({ className: 'DenyForm' }).props.onSubmit({
        preventDefault: vi.fn(),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(denyRequestMock).toHaveBeenCalledWith(
      'approval-1',
      'Needs approval from ops',
      'matrix-token-123'
    );

    renderer.unmount();
  });

  it('ignores rapid duplicate deny submissions before loading state disables the form', async () => {
    const deferred = createDeferred();
    denyRequestMock.mockImplementation(() => deferred.promise);
    const renderer = create(React.createElement(MindroomToolApprovalCard, { approval: pendingApproval }));

    act(() => {
      findButtonByText(renderer.root, 'Deny').props.onClick();
    });

    const input = renderer.root.findByType('input');

    act(() => {
      input.props.onChange({ currentTarget: { value: 'Needs approval from ops' } });
    });

    await act(async () => {
      const denyForm = renderer.root.findByProps({ className: 'DenyForm' });
      denyForm.props.onSubmit({ preventDefault: vi.fn() });
      denyForm.props.onSubmit({ preventDefault: vi.fn() });
      await Promise.resolve();
    });

    expect(denyRequestMock).toHaveBeenCalledTimes(1);
    expect(denyRequestMock).toHaveBeenCalledWith(
      'approval-1',
      'Needs approval from ops',
      'matrix-token-123'
    );

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    renderer.unmount();
  });

  it('keeps pending approvals submitted until the event edit arrives', async () => {
    approveRequestMock.mockResolvedValue(undefined);
    const renderer = create(React.createElement(MindroomToolApprovalCard, { approval: pendingApproval }));

    await act(async () => {
      findButtonByText(renderer.root, 'Approve').props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = getNodeText(renderer.root);
    const buttonLabels = renderer.root.findAllByType('button').map((node) => getNodeText(node));

    expect(text).toContain('Submitted');
    expect(text).toContain('Submitted. Waiting for room update.');
    expect(text).not.toContain('Pending approval');
    expect(buttonLabels.some((label) => label.includes('Approve'))).toBe(false);
    expect(buttonLabels.some((label) => label.includes('Deny'))).toBe(false);

    renderer.unmount();
  });

  it('renders resolved denied approvals without action buttons', () => {
    const renderer = create(
      React.createElement(MindroomToolApprovalCard, {
        approval: {
          ...pendingApproval,
          status: 'denied',
          resolvedAt: '2026-04-10T12:05:00Z',
          resolvedBy: '@ops:example.org',
          resolutionReason: 'Missing justification',
        },
      })
    );

    const text = getNodeText(renderer.root);

    expect(text).toContain('Denied');
    expect(text).toContain('Denied by @ops:example.org');
    expect(text).toContain('Missing justification');
    expect(text).not.toContain('Approve');
    expect(text).not.toContain('Confirm Deny');

    renderer.unmount();
  });

  it('moves focus into the deny form and restores it to the deny trigger on cancel', () => {
    const nodeMocks: {
      cancelButton?: { focus: ReturnType<typeof vi.fn> };
      confirmDenyButton?: { focus: ReturnType<typeof vi.fn> };
      denyInput?: { focus: ReturnType<typeof vi.fn> };
      denyTrigger?: { focus: ReturnType<typeof vi.fn> };
    } = {};

    const createNodeMock = (element: {
      props: { [key: string]: unknown };
      type: string;
    }) => {
      if (element.type === 'button') {
        const label = getReactNodeText(element.props.children as React.ReactNode);
        const node = { focus: vi.fn() };

        if (label.includes('Confirm Deny')) {
          nodeMocks.confirmDenyButton = node;
        } else if (label.includes('Cancel')) {
          nodeMocks.cancelButton = node;
        } else if (label.includes('Deny')) {
          nodeMocks.denyTrigger = node;
        }

        return node;
      }

      if (
        element.type === 'input' &&
        element.props['aria-label'] === 'Deny reason (optional)'
      ) {
        const node = { focus: vi.fn() };
        nodeMocks.denyInput = node;
        return node;
      }

      return null;
    };

    const renderer = create(
      React.createElement(MindroomToolApprovalCard, { approval: pendingApproval }),
      { createNodeMock }
    );

    act(() => {
      findButtonByText(renderer.root, 'Deny').props.onClick();
    });

    expect(nodeMocks.denyInput?.focus).toHaveBeenCalledTimes(1);
    expect(nodeMocks.confirmDenyButton?.focus).not.toHaveBeenCalled();

    act(() => {
      findButtonByText(renderer.root, 'Cancel').props.onClick();
    });

    expect(nodeMocks.denyTrigger?.focus).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });

  it('clears stale local API errors after the approval resolves via props', async () => {
    approveRequestMock.mockRejectedValueOnce(new Error('Approval API unavailable'));
    const renderer = create(React.createElement(MindroomToolApprovalCard, { approval: pendingApproval }));

    await act(async () => {
      findButtonByText(renderer.root, 'Approve').props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getNodeText(renderer.root)).toContain('Approval API unavailable');

    await act(async () => {
      renderer.update(
        React.createElement(MindroomToolApprovalCard, {
          approval: {
            ...pendingApproval,
            status: 'approved',
            resolvedAt: '2026-04-10T12:05:00Z',
            resolvedBy: '@ops:example.org',
          },
        })
      );
      await Promise.resolve();
    });

    const text = getNodeText(renderer.root);

    expect(text).toContain('Approved');
    expect(text).not.toContain('Approval API unavailable');

    renderer.unmount();
  });
});
