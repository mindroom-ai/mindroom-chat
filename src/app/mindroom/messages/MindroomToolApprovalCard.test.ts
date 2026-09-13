/* eslint-disable react/prop-types */
import React from 'react';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MindroomToolApprovalCard } from './MindroomToolApprovalCard';
import { MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT, ToolApprovalData } from './toolApproval';

const sendEventMock = vi.fn();

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
    React.createElement(
      'button',
      { ...props, onClick, ref, type: props.type ?? 'button' },
      children
    )
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
  Text: ({ as: Tag = 'span', children, ...props }: any) =>
    React.createElement(Tag, props, children),
}));

vi.mock('./MindroomToolApprovalCard.css.ts', () => ({
  Card: 'Card',
  CardApproved: 'CardApproved',
  CardDenied: 'CardDenied',
  CardExpired: 'CardExpired',
  ResolvedInline: 'ResolvedInline',
  ResolvedInlineApproved: 'ResolvedInlineApproved',
  ResolvedInlineDenied: 'ResolvedInlineDenied',
  ResolvedInlineExpired: 'ResolvedInlineExpired',
  Header: 'Header',
  ToolName: 'ToolName',
  ResolvedToolName: 'ResolvedToolName',
  StatusLabel: 'StatusLabel',
  Meta: 'Meta',
  MetaDot: 'MetaDot',
  Details: 'Details',
  DetailsSummary: 'DetailsSummary',
  DetailsSummaryLabel: 'DetailsSummaryLabel',
  JsonBlock: 'JsonBlock',
  Actions: 'Actions',
  DenyForm: 'DenyForm',
}));

vi.mock('../../hooks/useRelativeTime', () => ({
  useRelativeTime: (ts?: number) => (typeof ts === 'number' ? `relative-${ts}` : ''),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    sendEvent: (...args: unknown[]) => sendEventMock(...args),
  }),
}));

const pendingApproval: ToolApprovalData = {
  approvalId: 'approval-1',
  toolName: 'web_search',
  toolCallId: 'approval-1',
  arguments: { query: 'release date' },
  agentName: 'research',
  requesterId: '@alice:example.org',
  status: 'pending',
  requestedAt: '2026-04-10T12:00:00Z',
  expiresAt: '2999-04-17T12:00:00Z',
  threadId: '$thread-root',
  resolvedAt: null,
  resolvedBy: null,
  resolutionReason: null,
};

const approvalContext = {
  roomId: '!room:example.org',
  eventId: '$approval',
  threadId: '$thread-root',
};

const renderCard = (
  approval: ToolApprovalData = pendingApproval,
  props: Partial<typeof approvalContext> = {}
) =>
  create(
    React.createElement(MindroomToolApprovalCard, {
      approval,
      ...approvalContext,
      ...props,
    })
  );

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
    sendEventMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders an already-expired pending approval in the live timestamp format without actions', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-04-26T02:46:30Z');

    const renderer = renderCard({
      ...pendingApproval,
      expiresAt: '2026-04-26T02:46:29.899252+00:00',
    });
    const text = getNodeText(renderer.root);
    const buttonLabels = renderer.root.findAllByType('button').map((node) => getNodeText(node));

    expect(text).toContain('Approval expired');
    expect(buttonLabels.some((label) => label.includes('Approve'))).toBe(false);
    expect(buttonLabels.some((label) => label.includes('Deny'))).toBe(false);

    renderer.unmount();
  });

  it('keeps a future pending approval in the live timestamp format actionable', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-04-26T02:46:29Z');

    const renderer = renderCard({
      ...pendingApproval,
      expiresAt: '2026-04-26T02:46:29.899252+00:00',
    });
    const text = getNodeText(renderer.root);

    expect(text).toContain('Pending approval');
    expect(findButtonByText(renderer.root, 'Approve')).toBeDefined();
    expect(findButtonByText(renderer.root, 'Deny')).toBeDefined();

    renderer.unmount();
  });

  it('expires a mounted pending approval when its deadline passes', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-04-17T11:59:59Z');

    let renderer!: ReturnType<typeof renderCard>;
    act(() => {
      renderer = renderCard({
        ...pendingApproval,
        expiresAt: '2026-04-17T12:00:00Z',
      });
    });

    expect(getNodeText(renderer.root)).toContain('Pending approval');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const text = getNodeText(renderer.root);
    const buttonLabels = renderer.root.findAllByType('button').map((node) => getNodeText(node));

    expect(text).toContain('Approval expired');
    expect(buttonLabels.some((label) => label.includes('Approve'))).toBe(false);
    expect(buttonLabels.some((label) => label.includes('Deny'))).toBe(false);

    renderer.unmount();
  });

  it.each([
    ['approved', 'Approved by @ops:example.org'],
    ['denied', 'Denied by @ops:example.org'],
  ] as const)('keeps the terminal %s server state authoritative', (status, expectedText) => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-04-17T12:00:00Z');

    const renderer = renderCard({
      ...pendingApproval,
      status,
      expiresAt: '2026-04-17T11:00:00Z',
      resolvedAt: '2026-04-17T11:30:00Z',
      resolvedBy: '@ops:example.org',
    });
    const text = getNodeText(renderer.root);

    expect(text).toContain(expectedText);
    expect(text).not.toContain('Approval expired');

    renderer.unmount();
  });

  it('keeps the terminal expired server state authoritative before the deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-04-17T12:00:00Z');

    const renderer = renderCard({
      ...pendingApproval,
      status: 'expired',
      expiresAt: '2026-04-17T13:00:00Z',
    });
    const buttonLabels = renderer.root.findAllByType('button').map((node) => getNodeText(node));

    expect(getNodeText(renderer.root)).toContain('Approval expired');
    expect(buttonLabels.some((label) => label.includes('Approve'))).toBe(false);
    expect(buttonLabels.some((label) => label.includes('Deny'))).toBe(false);

    renderer.unmount();
  });

  it('does not submit when an action is clicked after effective expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-04-17T11:59:59Z');

    const renderer = renderCard({
      ...pendingApproval,
      expiresAt: '2026-04-17T12:00:00Z',
    });
    const approveClick = findButtonByText(renderer.root, 'Approve').props.onClick;

    vi.setSystemTime('2026-04-17T12:00:00Z');
    act(() => {
      approveClick();
    });

    expect(sendEventMock).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it.each(['not-a-timestamp', '0', '2026-02-30T12:00:00Z'])(
    'keeps a pending approval with invalid expiry timestamp %s actionable',
    (expiresAt) => {
      const renderer = renderCard({
        ...pendingApproval,
        expiresAt,
      });

      expect(getNodeText(renderer.root)).toContain('Pending approval');
      expect(findButtonByText(renderer.root, 'Approve')).toBeDefined();
      expect(findButtonByText(renderer.root, 'Deny')).toBeDefined();

      renderer.unmount();
    }
  );

  it('renders pending approvals with action buttons', () => {
    const renderer = renderCard();
    const text = getNodeText(renderer.root);

    expect(text).toContain('web_search');
    expect(text).toContain('Pending approval');
    expect(text).toContain('Arguments');
    expect(text).toContain('Approve');
    expect(text).toContain('Deny');

    renderer.unmount();
  });

  it('sends approval responses as Matrix events in the source thread', async () => {
    sendEventMock.mockResolvedValue(undefined);
    const renderer = renderCard();

    await act(async () => {
      findButtonByText(renderer.root, 'Approve').props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendEventMock).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
      {
        status: 'approved',
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: '$thread-root',
          is_falling_back: true,
          'm.in_reply_to': {
            event_id: '$approval',
          },
        },
      }
    );

    renderer.unmount();
  });

  it('ignores rapid duplicate approve clicks before loading state re-renders', async () => {
    const deferred = createDeferred();
    sendEventMock.mockImplementation(() => deferred.promise);
    const renderer = renderCard();

    await act(async () => {
      const approveButton = findButtonByText(renderer.root, 'Approve');
      approveButton.props.onClick();
      approveButton.props.onClick();
      await Promise.resolve();
    });

    expect(sendEventMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    renderer.unmount();
  });

  it('collects an optional deny reason before submitting', async () => {
    sendEventMock.mockResolvedValue(undefined);
    const renderer = renderCard();

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

    expect(sendEventMock).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
      {
        status: 'denied',
        reason: 'Needs approval from ops',
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: '$thread-root',
          is_falling_back: true,
          'm.in_reply_to': {
            event_id: '$approval',
          },
        },
      }
    );

    renderer.unmount();
  });

  it('sends null as the deny reason when the input is blank', async () => {
    sendEventMock.mockResolvedValue(undefined);
    const renderer = renderCard();

    act(() => {
      findButtonByText(renderer.root, 'Deny').props.onClick();
    });

    await act(async () => {
      renderer.root.findByProps({ className: 'DenyForm' }).props.onSubmit({
        preventDefault: vi.fn(),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendEventMock).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
      expect.objectContaining({
        status: 'denied',
        reason: null,
      })
    );

    renderer.unmount();
  });

  it('ignores rapid duplicate deny submissions before loading state disables the form', async () => {
    const deferred = createDeferred();
    sendEventMock.mockImplementation(() => deferred.promise);
    const renderer = renderCard();

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

    expect(sendEventMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    renderer.unmount();
  });

  it('falls back to the parsed approval thread id when no thread id prop is provided', async () => {
    sendEventMock.mockResolvedValue(undefined);
    const renderer = renderCard(pendingApproval, { threadId: undefined });

    await act(async () => {
      findButtonByText(renderer.root, 'Approve').props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendEventMock).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-root',
        }),
      })
    );

    renderer.unmount();
  });

  it('falls back to the approval event id when no thread root is available anywhere', async () => {
    sendEventMock.mockResolvedValue(undefined);
    const renderer = renderCard(
      {
        ...pendingApproval,
        threadId: null,
      },
      { threadId: undefined }
    );

    await act(async () => {
      findButtonByText(renderer.root, 'Approve').props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendEventMock).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$approval',
        }),
      })
    );

    renderer.unmount();
  });

  it('keeps pending approvals submitted until the event edit arrives', async () => {
    sendEventMock.mockResolvedValue(undefined);
    const renderer = renderCard();

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

  it('renders resolved denied approvals as compact inline summaries', () => {
    const renderer = renderCard({
      ...pendingApproval,
      status: 'denied',
      resolvedAt: '2026-04-10T12:05:00Z',
      resolvedBy: '@ops:example.org',
      resolutionReason: 'Missing justification',
    });

    const text = getNodeText(renderer.root);

    expect(text).toContain('web_search');
    expect(text).toContain('Denied by @ops:example.org');
    expect(text).not.toContain('Arguments');
    expect(text).not.toContain('Approve');
    expect(text).not.toContain('Confirm Deny');
    expect(renderer.root.findByProps({ title: 'Reason: Missing justification' })).toBeDefined();

    renderer.unmount();
  });

  it('moves focus into the deny form and restores it to the deny trigger on cancel', () => {
    const nodeMocks: {
      cancelButton?: { focus: ReturnType<typeof vi.fn> };
      confirmDenyButton?: { focus: ReturnType<typeof vi.fn> };
      denyInput?: { focus: ReturnType<typeof vi.fn> };
      denyTrigger?: { focus: ReturnType<typeof vi.fn> };
    } = {};

    const createNodeMock = (element: { props: { [key: string]: unknown }; type: string }) => {
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

      if (element.type === 'input' && element.props['aria-label'] === 'Deny reason (optional)') {
        const node = { focus: vi.fn() };
        nodeMocks.denyInput = node;
        return node;
      }

      return null;
    };

    const renderer = create(
      React.createElement(MindroomToolApprovalCard, {
        approval: pendingApproval,
        ...approvalContext,
      }),
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

  it('clears stale local errors after the approval resolves via props', async () => {
    sendEventMock.mockRejectedValueOnce(new Error('Matrix send failed'));
    const renderer = renderCard();

    await act(async () => {
      findButtonByText(renderer.root, 'Approve').props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getNodeText(renderer.root)).toContain('Matrix send failed');

    await act(async () => {
      renderer.update(
        React.createElement(MindroomToolApprovalCard, {
          approval: {
            ...pendingApproval,
            status: 'approved',
            resolvedAt: '2026-04-10T12:05:00Z',
            resolvedBy: '@ops:example.org',
          },
          ...approvalContext,
        })
      );
      await Promise.resolve();
    });

    const text = getNodeText(renderer.root);

    expect(text).toContain('Approved');
    expect(text).not.toContain('Matrix send failed');

    renderer.unmount();
  });
});
