// @vitest-environment jsdom
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createRoot, Root } from 'react-dom/client';
import { act as domAct } from 'react-dom/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { ApprovalReviewCall } from './ApprovalReviewCall';
import { parseToolApprovalContent } from './toolApproval';
import { ThreadApprovalRecord } from './threadApprovalModel';

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  actions: new Map(),
}));
vi.mock('./ApprovalArguments', () => ({ ApprovalArguments: () => null }));
vi.mock('./ThreadApprovals.css', () => ({
  Call: 'Call',
  Actions: 'Actions',
  Stack: 'Stack',
}));
vi.mock('folds', () => ({
  Button: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    // The prop-types rule cannot infer native props on this typed test double.
    // eslint-disable-next-line react/prop-types
    ({ type, onClick, disabled, children }, ref) => (
      <button ref={ref} type={type ?? 'button'} onClick={onClick} disabled={disabled}>
        {children}
      </button>
    )
  ),
  Input: 'input',
  Text: 'span',
}));
const record = (id: string): ThreadApprovalRecord => ({
  eventId: id,
  sender: '@router:example.org',
  wireStatus: 'pending',
  approval: parseToolApprovalContent('io.mindroom.tool_approval', {
    approval_id: id,
    tool_name: 'invite',
    agent_name: 'assistant',
    arguments: { user: id },
    status: 'pending',
    requested_at: '2026-09-12T12:00:00Z',
    expires_at: '2999-09-12T12:00:00Z',
    approver_user_id: '@alice:example.org',
  })!,
});
let renderer: ReactTestRenderer;
let domRoot: Root | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  domAct(() => domRoot?.unmount());
  domRoot = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  mocks.submit.mockReset();
  mocks.actions.clear();
});

it('moves focus into the denial reason and restores the Deny trigger on cancel', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  domRoot = createRoot(container);
  domAct(() =>
    domRoot!.render(
      <ApprovalReviewCall
        record={record('$one')}
        index={0}
        userId="@alice:example.org"
        action={mocks.actions.get('$one')}
        now={Date.now()}
        submit={mocks.submit}
      />
    )
  );
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((item) => item.textContent === label)!;
  button('Deny').focus();
  domAct(() => button('Deny').click());
  expect(document.activeElement).toBe(container.querySelector('input'));
  button('Cancel').focus();
  domAct(() => button('Cancel').click());
  expect(document.activeElement).toBe(button('Deny'));
});
it('lets the same review approve one call and deny another with its own reason', () => {
  const one = record('$one');
  const two = record('$two');
  act(() => {
    renderer = create(
      <>
        <ApprovalReviewCall
          record={one}
          index={0}
          userId="@alice:example.org"
          action={mocks.actions.get('$one')}
          now={Date.now()}
          submit={mocks.submit}
        />
        <ApprovalReviewCall
          record={two}
          index={1}
          userId="@alice:example.org"
          action={mocks.actions.get('$two')}
          now={Date.now()}
          submit={mocks.submit}
        />
      </>
    );
  });
  const first = renderer.root.findByProps({ 'data-approval-id': '$one' });
  const second = renderer.root.findByProps({ 'data-approval-id': '$two' });
  act(() => {
    first.findAllByType('button')[0].props.onClick();
  });
  expect(mocks.submit).toHaveBeenNthCalledWith(1, one, { status: 'approved' });
  act(() => {
    second.findAllByType('button')[1].props.onClick();
  });
  act(() => {
    second.findByType('input').props.onChange({ currentTarget: { value: 'Wrong workspace' } });
  });
  act(() => {
    second.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
  });
  expect(mocks.submit).toHaveBeenNthCalledWith(2, two, {
    status: 'denied',
    reason: 'Wrong workspace',
  });
});
it('removes individual actions while the submitted call awaits its Matrix decision', () => {
  mocks.actions.set('$one', { kind: 'decision', status: 'submitted' });
  act(() => {
    renderer = create(
      <ApprovalReviewCall
        record={record('$one')}
        index={0}
        userId="@alice:example.org"
        action={mocks.actions.get('$one')}
        now={Date.now()}
        submit={mocks.submit}
      />
    );
  });
  expect(renderer.root.findAllByType('button')).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('submitted');
});
