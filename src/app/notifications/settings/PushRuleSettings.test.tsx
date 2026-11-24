// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MatrixEvent, PushRuleActionName, PushRuleKind, type IPushRules } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllMessagesNotifications, KeywordNotifications } from './PushRuleSettings';

const mocks = vi.hoisted(() => ({
  pushRules: undefined as MatrixEvent | undefined,
  addPushRule: vi.fn(),
  setPushRuleActions: vi.fn(),
  setPushRuleEnabled: vi.fn(),
  deletePushRule: vi.fn(),
}));

vi.mock('../../matrix/hooks/useAccountData', () => ({
  useAccountData: () => mocks.pushRules,
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@alice:example.org',
    addPushRule: mocks.addPushRule,
    setPushRuleActions: mocks.setPushRuleActions,
    setPushRuleEnabled: mocks.setPushRuleEnabled,
    deletePushRule: mocks.deletePushRule,
  }),
}));
vi.mock('../../ui/settings/ChoiceButton', () => ({
  ChoiceButton: ({
    label,
    value,
    choices,
    onChoose,
  }: {
    label: string;
    value: string;
    choices: Array<{ value: string; label: string }>;
    onChoose: (next: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChoose(event.target.value)}>
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  ),
}));

const rulesEvent = (global: IPushRules['global']) =>
  new MatrixEvent({ type: 'm.push_rules', content: { global } });

afterEach(() => {
  cleanup();
  mocks.pushRules = undefined;
  vi.clearAllMocks();
});

describe('PushRuleSettings actions', () => {
  it('shows loudness changes optimistically and snaps back with an alert when saving fails', async () => {
    mocks.pushRules = rulesEvent({
      underride: [
        {
          rule_id: '.m.rule.message',
          default: true,
          enabled: true,
          actions: [PushRuleActionName.Notify],
        },
      ],
    });
    let rejectWrite!: (reason: unknown) => void;
    mocks.setPushRuleActions.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite = reject;
        })
    );

    render(<AllMessagesNotifications />);
    const select = screen.getByLabelText<HTMLSelectElement>('Rooms');
    expect(select.value).toBe('silent');

    await act(async () => {
      fireEvent.change(select, { target: { value: 'loud' } });
    });
    expect(select.value).toBe('loud');

    await act(async () => {
      rejectWrite(new Error('network'));
    });
    expect(select.value).toBe('silent');
    expect(screen.getByRole('alert').textContent).toBeTruthy();
  });

  it('adds a keyword via form action, keeps the draft on failure, and clears it on success', async () => {
    mocks.pushRules = rulesEvent({ content: [] });
    let rejectFirst!: (reason: unknown) => void;
    let resolveSecond!: () => void;
    mocks.addPushRule
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirst = reject;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSecond = resolve;
          })
      );

    const view = render(<KeywordNotifications />);
    const input = view.container.querySelector('input')!;
    const form = view.container.querySelector('form')!;
    const submit = view.container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

    fireEvent.change(input, { target: { value: 'deploy' } });
    expect(submit.disabled).toBe(false);

    await act(async () => {
      form.requestSubmit();
    });
    expect(submit.disabled).toBe(true);

    await act(async () => {
      rejectFirst(new Error('offline'));
    });
    expect(input.value).toBe('deploy');
    expect(screen.getByRole('alert').textContent).toBeTruthy();

    await act(async () => {
      form.requestSubmit();
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(submit.disabled).toBe(true);

    await act(async () => {
      resolveSecond();
    });
    expect(input.value).toBe('');
    expect(mocks.addPushRule).toHaveBeenCalledWith(
      'global',
      PushRuleKind.ContentSpecific,
      'deploy',
      expect.objectContaining({ pattern: 'deploy' })
    );
  });
});
