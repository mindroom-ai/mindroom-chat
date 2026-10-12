import React from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../locales/en.json';
import { ApprovalArguments } from './ApprovalArguments';
import { parseToolApprovalContent } from './toolApproval';

const mocks = vi.hoisted(() => ({ download: vi.fn(), mx: {} }));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => mocks.mx }));
vi.mock('../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => true }));
vi.mock('./sidecarDownload', () => ({ downloadMindroomSidecarBlob: mocks.download }));
vi.mock('./ApprovalArgumentFields.css', () => ({
  Arguments: 'Arguments',
  Fields: 'Fields',
  Key: 'Key',
  Value: 'Value',
  Clamped: 'Clamped',
  Scalar: 'Scalar',
  Code: 'Code',
  Toggle: 'Toggle',
  Count: 'Count',
}));
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
  const button = renderer.root.find((node) => node.props['aria-expanded'] !== undefined);
  if (button.props['aria-expanded'] === open) return;
  await act(async () => {
    button.props.onClick();
  });
};
const rendered = () => JSON.stringify(renderer.toJSON());

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
      renderer.root
        .findAll((node) => node.type === 'button' && node.children.includes('Retry'))[0]
        .props.onClick();
    });
    expect(rendered()).toContain('Jamie');
    await toggle(false);
    await toggle(true);
    expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(rendered()).toContain('Jamie');
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
    expect(rendered()).not.toContain('Jamie');
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
  expect(rendered()).toContain('Jamie');
});

it('translates a retained failure without downloading again on language changes', async () => {
  const language = createInstance();
  await language.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      de: {
        translation: {
          mindroomUi: {
            messages: {
              approvalArguments: {
                loadFailed: 'Vollständige Argumente konnten nicht geladen werden.',
              },
            },
          },
        },
      },
    },
  });
  mocks.download.mockRejectedValueOnce(new Error('Offline'));
  act(() => {
    renderer = create(
      <I18nextProvider i18n={language}>
        <ApprovalArguments approval={approval} />
      </I18nextProvider>
    );
  });
  await toggle(true);
  expect(JSON.stringify(renderer.toJSON())).toContain('Could not load complete arguments.');
  await act(async () => {
    await language.changeLanguage('de');
  });
  expect(JSON.stringify(renderer.toJSON())).toContain(
    'Vollständige Argumente konnten nicht geladen werden.'
  );
  expect(mocks.download).toHaveBeenCalledTimes(1);
});

it('previews the first three arguments as fields and reveals the rest on request', async () => {
  const email = parseToolApprovalContent('io.mindroom.tool_approval', {
    approval_id: 'email',
    tool_name: 'send_email',
    agent_name: 'research',
    status: 'pending',
    arguments: { to: 'grace@example.org', subject: 'Notes', body: 'Hi Grace', cc: [] },
    requested_at: '2026-09-12T12:00:00Z',
    expires_at: '2026-09-12T12:30:00Z',
  })!;
  act(() => {
    renderer = create(<ApprovalArguments approval={email} />);
  });
  const keys = () => renderer.root.findAllByType('dt').map((node) => node.children.join(''));
  expect(keys()).toEqual(['to', 'subject', 'body']);
  expect(rendered()).toContain('Show all arguments');
  expect(rendered()).toContain('"4"');
  await toggle(true);
  expect(keys()).toEqual(['to', 'subject', 'body', 'cc']);
  expect(rendered()).toContain('Hide arguments');
  expect(mocks.download).not.toHaveBeenCalled();
});
