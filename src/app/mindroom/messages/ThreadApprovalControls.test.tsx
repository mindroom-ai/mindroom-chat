// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { ThreadApprovalPermissions, ThreadApprovalQueue } from './ThreadApprovalControls';
import { ThreadApprovals } from './ThreadApprovalProvider';
import { parseToolApprovalContent } from './toolApproval';

let current: ThreadApprovals;
vi.mock('./ThreadApprovalProvider', () => ({ useThreadApprovals: () => current }));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@alice:example.org' }),
}));
vi.mock('./ApprovalArguments', () => ({ ApprovalArguments: () => null }));
vi.mock('./ThreadApprovals.css', () => ({
  Bar: 'Bar',
  Chip: 'Chip',
  Receipt: 'Receipt',
  ReceiptTool: 'ReceiptTool',
  ReceiptBody: 'ReceiptBody',
  Stack: 'Stack',
  HistoryBody: 'HistoryBody',
  DialogBody: 'DialogBody',
  Group: 'Group',
  Actions: 'Actions',
  Call: 'Call',
  CallHeader: 'CallHeader',
}));
vi.mock('focus-trap-react', async (importOriginal) => {
  const { default: FocusTrap } = await importOriginal<typeof import('focus-trap-react')>();
  return {
    // JSDOM has no layout; keep the real trap and focus handoffs.
    default: (props: React.ComponentProps<typeof FocusTrap>) => (
      <FocusTrap
        {...props}
        focusTrapOptions={{
          ...props.focusTrapOptions,
          tabbableOptions: { displayCheck: 'none' },
        }}
      />
    ),
  };
});

it.each(['review', 'permissions'] as const)(
  'focuses the %s dialog on open and restores the composer when its trigger disappears',
  async (mode) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    const composer = document.createElement('input');
    document.body.append(container, composer);
    const root = createRoot(container);
    const Controls = mode === 'review' ? ThreadApprovalQueue : ThreadApprovalPermissions;
    current = {
      roomId: '!room:example.org',
      threadId: '$thread',
      records: [
        {
          eventId: '$approval',
          sender: '@router:example.org',
          wireStatus: mode === 'review' ? 'pending' : 'approved',
          approval: parseToolApprovalContent('io.mindroom.tool_approval', {
            approval_id: 'one',
            tool_name: 'search',
            agent_name: 'assistant',
            status: mode === 'review' ? 'pending' : 'approved',
            approver_user_id: '@alice:example.org',
            arguments: {},
            requested_at: '2026-09-12T12:00:00Z',
            expires_at: '2999-09-12T12:00:00Z',
            auto_approval:
              mode === 'permissions'
                ? {
                    grant_id: 'grant',
                    expires_at: '2999-09-12T12:00:00Z',
                    revoked_at: null,
                  }
                : undefined,
          })!,
        },
      ],
      now: Date.now(),
      pendingEventIds: new Set(mode === 'review' ? ['$approval'] : []),
      loading: false,
      refresh: () => undefined,
      ingestTimeline: () => undefined,
      actions: new Map(),
      submit: async () => undefined,
      focusConversation: () => composer.focus(),
    };
    try {
      await act(async () => root.render(<Controls />));
      const trigger = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === (mode === 'review' ? 'Review 1' : '1 active permission')
      )!;
      trigger.focus();
      await act(async () => trigger.click());
      const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
      await vi.waitFor(() => expect(document.activeElement).toBe(close));
      current = {
        ...current,
        pendingEventIds: new Set(),
        records: current.records.map((record) => ({
          ...record,
          wireStatus: 'approved',
          approval: { ...record.approval, status: 'approved', autoApproval: null },
        })),
      };
      await act(async () => root.render(<Controls />));
      await act(async () => close.click());
      await vi.waitFor(() => expect(document.activeElement).toBe(composer));
      expect(trigger.isConnected).toBe(false);
    } finally {
      act(() => root.unmount());
      document.body.replaceChildren();
      vi.unstubAllGlobals();
    }
  }
);
