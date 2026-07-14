import { Browser } from '@capacitor/browser';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isNativeIOS } from '../../mindroom/auth/authUi';
import {
  HOSTED_DEPLOYMENT_URL_KEY,
  HostedDeploymentButton,
  HostedDeploymentLauncher,
  normalizeHostedDeploymentUrl,
} from './HostedDeploymentLauncher';

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn(),
  },
}));

vi.mock('../../mindroom/auth/authUi', () => ({
  isNativeIOS: vi.fn(),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Box: ({ as = 'div', children, ...props }: { as?: string; children?: React.ReactNode }) =>
      reactModule.createElement(as, props, children),
    Button: ({ children, ...props }: { children?: React.ReactNode }) =>
      reactModule.createElement('button', props, children),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
      reactModule.createElement('input', props),
    Line: (props: React.HTMLAttributes<HTMLHRElement>) => reactModule.createElement('hr', props),
    Text: ({ as = 'span', children, ...props }: { as?: string; children?: React.ReactNode }) =>
      reactModule.createElement(as, props, children),
    color: {
      Critical: {
        Main: '#f00',
      },
    },
  };
});

const createStorage = (initialValue?: string) => {
  let value = initialValue;
  return {
    getItem: vi.fn((key: string) => (key === HOSTED_DEPLOYMENT_URL_KEY ? value ?? null : null)),
    setItem: vi.fn((key: string, nextValue: string) => {
      if (key === HOSTED_DEPLOYMENT_URL_KEY) value = nextValue;
    }),
    removeItem: vi.fn((key: string) => {
      if (key === HOSTED_DEPLOYMENT_URL_KEY) value = undefined;
    }),
  };
};

const findButtonByText = (renderer: ReturnType<typeof create>, text: string) =>
  renderer.root
    .findAllByType('button')
    .find((node) =>
      node.findAllByType('span').some((textNode) => textNode.children.join('') === text)
    );

const setDeploymentUrl = (renderer: ReturnType<typeof create>, value: string): void => {
  const input = renderer.root.findByProps({ 'aria-label': 'Organization deployment URL' });
  act(() => input.props.onChange({ currentTarget: { value } }));
};

const submitDeployment = async (renderer: ReturnType<typeof create>): Promise<void> => {
  const form = renderer.root.findByProps({ 'data-testid': 'hosted-deployment-form' });
  await act(async () => {
    await form.props.onSubmit({ preventDefault: vi.fn() });
  });
};

const createLauncher = (onBack = vi.fn()) => create(<HostedDeploymentLauncher onBack={onBack} />);

describe('normalizeHostedDeploymentUrl', () => {
  it('adds HTTPS when the user enters a bare host and preserves a deployment path', () => {
    expect(normalizeHostedDeploymentUrl(' chat.example.com/team ')).toBe(
      'https://chat.example.com/team'
    );
  });

  it('accepts a bare host with a non-default HTTPS port', () => {
    expect(normalizeHostedDeploymentUrl('chat.example.com:8443/team')).toBe(
      'https://chat.example.com:8443/team'
    );
  });

  it.each([
    'http://chat.example.com',
    'mailto:admin@example.com',
    'https://user:secret@chat.example.com',
    'not a host',
    '',
  ])('rejects unsafe deployment URL %j', (value) => {
    expect(() => normalizeHostedDeploymentUrl(value)).toThrow();
  });
});

describe('HostedDeploymentLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isNativeIOS).mockReturnValue(true);
    vi.mocked(Browser.open).mockResolvedValue();
    vi.stubGlobal('localStorage', createStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays hidden outside the native iOS app', () => {
    vi.mocked(isNativeIOS).mockReturnValue(false);

    const renderer = createLauncher();

    expect(renderer.toJSON()).toBeNull();
  });

  it('keeps the organization action hidden outside the native iOS app', () => {
    vi.mocked(isNativeIOS).mockReturnValue(false);

    const renderer = create(<HostedDeploymentButton onClick={vi.fn()} />);

    expect(renderer.toJSON()).toBeNull();
  });

  it('opens hosted mode from the compact organization action', () => {
    const onClick = vi.fn();
    const renderer = create(<HostedDeploymentButton onClick={onClick} />);

    act(() => findButtonByText(renderer, 'Organization')?.props.onClick());

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('returns to normal server sign-in', () => {
    const onBack = vi.fn();
    const renderer = createLauncher(onBack);

    act(() => findButtonByText(renderer, 'Back')?.props.onClick());

    expect(onBack).toHaveBeenCalledOnce();
  });

  it('opens a valid deployment in the full-screen native browser without URL secrets', async () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    const renderer = createLauncher();
    setDeploymentUrl(renderer, 'https://chat.example.com/team?invite=secret#login');

    await submitDeployment(renderer);

    expect(Browser.open).toHaveBeenCalledWith({
      url: 'https://chat.example.com/team',
      presentationStyle: 'fullscreen',
    });
    expect(storage.setItem).toHaveBeenCalledWith(
      HOSTED_DEPLOYMENT_URL_KEY,
      'https://chat.example.com/team'
    );
  });

  it.each(['http://chat.example.com', 'https://user:secret@chat.example.com'])(
    'rejects %s before opening the browser',
    async (value) => {
      const renderer = createLauncher();
      setDeploymentUrl(renderer, value);

      await submitDeployment(renderer);

      expect(Browser.open).not.toHaveBeenCalled();
      const alert = renderer.root.findAllByType('span').find((node) => node.props.role === 'alert');
      expect(alert?.children.join('')).toContain('valid HTTPS deployment URL');
    }
  );

  it('locks the form and prevents duplicate opens while the browser request is pending', async () => {
    let resolveOpen: (() => void) | undefined;
    vi.mocked(Browser.open).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveOpen = resolve;
      })
    );
    const renderer = createLauncher();
    setDeploymentUrl(renderer, 'https://chat.example.com');
    const form = renderer.root.findByProps({ 'data-testid': 'hosted-deployment-form' });
    const preventDefault = vi.fn();

    let firstOpen: Promise<void>;
    let secondOpen: Promise<void>;
    await act(async () => {
      firstOpen = form.props.onSubmit({ preventDefault });
      secondOpen = form.props.onSubmit({ preventDefault });
      await Promise.resolve();
    });

    expect(Browser.open).toHaveBeenCalledTimes(1);
    expect(
      renderer.root.findByProps({ 'aria-label': 'Organization deployment URL' }).props.disabled
    ).toBe(true);
    expect(findButtonByText(renderer, 'Back')?.props.disabled).toBe(true);
    expect(findButtonByText(renderer, 'Opening...')?.props.disabled).toBe(true);
    expect(findButtonByText(renderer, 'Clear URL')?.props.disabled).toBe(true);

    resolveOpen?.();
    await act(async () => {
      await Promise.all([firstOpen!, secondOpen!]);
    });

    expect(
      renderer.root.findByProps({ 'aria-label': 'Organization deployment URL' }).props.disabled
    ).toBe(false);
    expect(findButtonByText(renderer, 'Back')?.props.disabled).toBe(false);
    expect(findButtonByText(renderer, 'Open deployment')?.props.disabled).toBe(false);
    expect(findButtonByText(renderer, 'Clear URL')?.props.disabled).toBe(false);
  });

  it('still opens when device storage is unavailable', async () => {
    const storage = createStorage();
    storage.setItem.mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.stubGlobal('localStorage', storage);
    const renderer = createLauncher();
    setDeploymentUrl(renderer, 'https://chat.example.com');

    await submitDeployment(renderer);

    expect(Browser.open).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  });

  it('reports a native browser failure without remembering the URL', async () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    vi.mocked(Browser.open).mockRejectedValue(new Error('browser unavailable'));
    const renderer = createLauncher();
    setDeploymentUrl(renderer, 'https://chat.example.com');

    await submitDeployment(renderer);

    expect(storage.setItem).not.toHaveBeenCalled();
    const alert = renderer.root.findAllByType('span').find((node) => node.props.role === 'alert');
    expect(alert?.children.join('')).toBe('Unable to open this deployment.');
  });

  it('clears a previously saved deployment URL', () => {
    const storage = createStorage('https://saved.example.com/');
    vi.stubGlobal('localStorage', storage);
    const renderer = createLauncher();
    const forgetButton = findButtonByText(renderer, 'Clear URL');

    act(() => forgetButton?.props.onClick());

    expect(storage.removeItem).toHaveBeenCalledWith(HOSTED_DEPLOYMENT_URL_KEY);
    expect(
      renderer.root.findByProps({ 'aria-label': 'Organization deployment URL' }).props.value
    ).toBe('');
  });
});
