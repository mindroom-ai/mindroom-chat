// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AuthType, type IAuthData } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionUIA, ActionUIAFlowsLoader, pickUIAFlow } from './ActionUIA';

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getFallbackAuthUrl: (stage: string, session: string) =>
      `https://hs.example/fallback/${stage}?session=${session}`,
  }),
}));

// What Tuwunel answers an OIDC session that replaces its cross-signing keys (MSC4312).
const RESET_URL = 'https://hs.example/_tuwunel/oidc/account?action=org.matrix.cross_signing_reset';
const OAUTH: IAuthData = {
  session: 'oauth-session',
  flows: [{ stages: [AuthType.OAuth] }],
  params: { [AuthType.OAuth]: { url: RESET_URL } },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('m.oauth stage', () => {
  it('is a flow this client can complete', () => {
    const unsupported = vi.fn(() => null);
    const children = vi.fn(() => null);
    render(
      <ActionUIAFlowsLoader authData={OAUTH} unsupported={unsupported}>
        {children}
      </ActionUIAFlowsLoader>
    );
    expect(unsupported).not.toHaveBeenCalled();
    expect(children).toHaveBeenCalledWith({ stages: [AuthType.OAuth] });
    expect(pickUIAFlow(OAUTH.flows ?? [])).toEqual({ stages: [AuthType.OAuth] });
  });

  it('opens the account page the server names, then continues with the session only', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const action = vi.fn();
    render(
      <ActionUIA
        authData={OAUTH}
        ongoingFlow={{ stages: [AuthType.OAuth] }}
        action={action}
        onCancel={vi.fn()}
      />
    );

    expect(screen.queryByText(/not supported by client/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open account page' }));
    });
    expect(open).toHaveBeenCalledWith(RESET_URL, '_blank', 'noopener');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    expect(action).toHaveBeenCalledWith({ session: 'oauth-session' });
  });

  it('falls back to the fallback page when the server names no URL', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <ActionUIA
        authData={{ ...OAUTH, params: {} }}
        ongoingFlow={{ stages: [AuthType.OAuth] }}
        action={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open account page' }));
    });
    expect(open).toHaveBeenCalledWith(
      'https://hs.example/fallback/m.oauth?session=oauth-session',
      '_blank',
      'noopener'
    );
  });
});
