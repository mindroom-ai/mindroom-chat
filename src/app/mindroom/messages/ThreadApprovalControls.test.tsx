// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { ThreadApprovalQueue } from './ThreadApprovalControls';
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

it('returns focus to the composer when the last acknowledgement removes the review trigger', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const composer = document.createElement('input');
  document.body.append(container, composer);
  const root = createRoot(container);
  current = {
    records: [
      {
        eventId: '$approval',
        sender: '@router:example.org',
        wireStatus: 'pending',
        approval: parseToolApprovalContent('io.mindroom.tool_approval', {
          approval_id: 'one',
          tool_name: 'search',
          agent_name: 'assistant',
          status: 'pending',
          arguments: {},
          requested_at: '2026-09-12T12:00:00Z',
          expires_at: '2999-09-12T12:00:00Z',
        })!,
      },
    ],
    now: Date.now(),
    pendingEventIds: new Set(['$approval']),
    loading: false,
    refresh: () => undefined,
    ingest: () => undefined,
    actions: new Map(),
    submit: async () => undefined,
    focusConversation: () => composer.focus(),
  };
  try {
    await act(async () => root.render(<ThreadApprovalQueue />));
    const trigger = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Review 1'
    )!;
    trigger.focus();
    await act(async () => trigger.click());
    current = {
      ...current,
      pendingEventIds: new Set(),
      records: current.records.map((record) => ({
        ...record,
        wireStatus: 'approved',
        approval: { ...record.approval, status: 'approved' },
      })),
    };
    await act(async () => root.render(<ThreadApprovalQueue />));
    expect(trigger.isConnected).toBe(false);
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    close.focus();
    await act(async () => close.click());
    await vi.waitFor(() => expect(document.activeElement).toBe(composer));
  } finally {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  }
});
