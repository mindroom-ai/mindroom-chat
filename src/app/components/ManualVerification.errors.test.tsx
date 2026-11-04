import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionError, MatrixError } from 'matrix-js-sdk';
import { ManualVerificationTile } from './ManualVerification';

// A failed unlock that this client recognizes reads in the app's language, with the server's
// own words beside it; ManualVerification.test.tsx covers the unlock's own failures.

const mocks = vi.hoisted(() => ({ error: undefined as unknown }));

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Chip: ({ children }: { children?: React.ReactNode }) => <button type="button">{children}</button>,
  Icon: () => null,
  Icons: { ChevronBottom: 'chevron-bottom' },
  Spinner: () => null,
  Text: ({ as = 'span', children, ...props }: { as?: string; children?: React.ReactNode }) =>
    React.createElement(as, props, children),
  color: { Critical: { Main: 'red' }, Success: { Main: 'green' } },
  config: { space: { S100: '4px' } },
}));
vi.mock('./directional', () => ({ PopOut: () => null }));
vi.mock('./glass/GlassPrimitives', () => ({ Menu: () => null, MenuItem: () => null }));
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./setting-tile', () => ({
  SettingTile: ({ title, after }: Record<string, React.ReactNode>) => (
    <div>
      {title}
      {after}
    </div>
  ),
}));
vi.mock('./SecretStorage', () => ({
  SecretStorageRecoveryKey: () => null,
  SecretStorageRecoveryPassphrase: () => null,
}));
vi.mock('../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../hooks/useAsyncCallback', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useAsyncCallback')>(
    '../hooks/useAsyncCallback'
  );
  return {
    ...actual,
    useAsyncCallback: () => [{ status: actual.AsyncStatus.Error, error: mocks.error }, vi.fn()],
  };
});

const renderFailure = (error: unknown) => {
  mocks.error = error;
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <ManualVerificationTile secretStorageKeyId="key" secretStorageKeyContent={{}} />
    );
  });
  const status = renderer.root.findByType('b');
  const details = renderer.root.findAll(
    (node) => node.props.dir === 'auto' && node.type === 'span'
  );
  return { text: status.children.join(''), detail: details[0]?.children.join('') };
};

describe('ManualVerification failures this client recognizes', () => {
  it('says what a server refusal means and keeps its code and explanation', () => {
    const failure = renderFailure(
      new MatrixError({ errcode: 'M_FORBIDDEN', error: 'Not allowed to read secrets.' }, 403)
    );

    expect(failure.text).toBe("You don't have permission to do this.");
    expect(failure.detail).toBe('M_FORBIDDEN: Not allowed to read secrets.');
  });

  it('says the server was out of reach, with nothing to add', () => {
    const failure = renderFailure(new ConnectionError('fetch failed', new TypeError('x')));

    expect(failure.text).toBe("Couldn't reach the server. Check your connection and try again.");
    expect(failure.detail).toBeUndefined();
  });
});
