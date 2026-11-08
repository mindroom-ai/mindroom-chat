import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixError } from 'matrix-js-sdk';
import { LocalKeyBackup } from './LocalKeyBackup';
import { encryptRoomKeyExport } from '../encryption/roomKeyExport';

// How a failed key import or export reads: the file's own problems in words, anything else as
// a translated sentence with the error's text beside it.

const crypto = vi.hoisted(() => ({
  exportRoomKeysAsJson: vi.fn(),
  importRoomKeysAsJson: vi.fn(),
}));

vi.mock('folds', () => {
  const Passthrough = ({
    as = 'div',
    children,
    before: _before,
    after: _after,
    ...props
  }: {
    as?: string;
    children?: React.ReactNode;
    before?: React.ReactNode;
    after?: React.ReactNode;
  }) => React.createElement(as, props, children);
  return {
    Box: Passthrough,
    Button: ({ children, before: _before, after: _after, ...props }: Record<string, unknown>) =>
      React.createElement('button', props, children as React.ReactNode),
    Icon: () => null,
    Icons: {},
    Spinner: () => null,
    Text: ({ as = 'span', children, ...props }: { as?: string; children?: React.ReactNode }) =>
      React.createElement(as, props, children),
    color: { Critical: { Main: 'red' }, Success: { Main: 'green' } },
  };
});
vi.mock('../../ui/SettingTile', () => ({
  SettingTile: ({ title, after }: Record<string, React.ReactNode>) => (
    <div>
      {title}
      {after}
    </div>
  ),
}));
vi.mock('../../ui/PasswordInput', () => ({
  PasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('../../ui/settings/SettingsCard', () => ({
  SettingsCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getCrypto: () => crypto }),
}));
vi.mock('file-saver', () => ({ default: { saveAs: vi.fn() } }));
const saveFile = vi.hoisted(() => vi.fn());
vi.mock('../../native/nativeFileSave', () => ({ saveFile }));

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
});

const render = () => {
  act(() => {
    renderer = create(<LocalKeyBackup />);
  });
  if (!renderer) throw new Error('not rendered');
  return renderer.root;
};

const expandButton = (root: ReactTestInstance, title: string) =>
  root.find(
    (node) =>
      node.type === 'button' &&
      typeof node.props['aria-label'] === 'string' &&
      node.props['aria-label'].endsWith(title)
  );

/** The alert under a form: its sentence and the quieter detail line. */
const outcomeOf = (root: ReactTestInstance) => {
  const alert = root.findByProps({ role: 'alert' });
  const line = alert.findByType('span');
  const sentence = line.children.filter((child) => typeof child === 'string').join('');
  const detail = line.findAllByType('bdi');
  return { sentence, detail: detail[0]?.children.join('') };
};

const importFile = async (contents: string, password: string) => {
  const root = render();
  act(() => {
    expandButton(root, 'Import Messages Data').props.onClick();
  });
  const [form] = root.findAllByType('form').slice(-1);
  if (!form) throw new Error('no import form');
  const file = new File([contents], 'keys.txt');
  act(() => {
    form.findByProps({ type: 'file' }).props.onChange({ target: { files: [file] } });
  });
  act(() => {
    form.findByProps({ name: 'importPassword' }).props.onChange({ target: { value: password } });
  });
  // The form starts the import without returning it; the key derivation takes a moment.
  act(() => {
    form.props.onSubmit({ preventDefault: vi.fn() });
  });
  await act(async () => {
    await vi.waitFor(() => root.findByProps({ role: 'alert' }), { timeout: 20_000 });
  });
  return outcomeOf(root);
};

describe('LocalKeyBackup failures', () => {
  it('says a file that is not a key export is not one, in words', async () => {
    const outcome = await importFile('just some notes', 'a long enough password');

    expect(outcome).toEqual({ sentence: "This file isn't a room key export.", detail: undefined });
    expect(crypto.importRoomKeysAsJson).not.toHaveBeenCalled();
  });

  it("translates the server's refusal of an import and keeps its code and explanation", async () => {
    const file = await encryptRoomKeyExport('[]', 'a long enough password');
    crypto.importRoomKeysAsJson.mockRejectedValue(
      new MatrixError({ errcode: 'M_LIMIT_EXCEEDED', error: 'Slow down' }, 429)
    );

    const outcome = await importFile(file, 'a long enough password');

    expect(outcome).toEqual({
      sentence: 'Too many requests. Wait a moment and try again.',
      detail: 'M_LIMIT_EXCEEDED: Slow down',
    });
    // Encrypting and decrypting the file derive a key twice, slowly by design.
  }, 30_000);
});

describe('LocalKeyBackup export', () => {
  const exportWith = async (password: string) => {
    crypto.exportRoomKeysAsJson.mockResolvedValue('[]');
    const root = render();
    act(() => {
      expandButton(root, 'Export Messages Data').props.onClick();
    });
    const [form] = root.findAllByType('form').slice(0, 1);
    if (!form) throw new Error('no export form');
    act(() => {
      form.findByProps({ name: 'exportPassword' }).props.onChange({ target: { value: password } });
    });
    act(() => {
      form
        .findByProps({ name: 'exportPasswordConfirmation' })
        .props.onChange({ target: { value: password } });
    });
    // The form found before the typing still holds the empty password; take the current one.
    const [current] = root.findAllByType('form').slice(0, 1);
    act(() => {
      current?.props.onSubmit({ preventDefault: vi.fn() });
    });
    // The form starts the export without returning it; encrypting the file takes a moment.
    await act(async () => {
      await vi.waitFor(() => expect(saveFile).toHaveBeenCalled(), { timeout: 20_000 });
    });
    await act(async () => {
      await Promise.resolve();
    });
    return root;
  };

  it("saves the file through the platform's save, which is the save sheet in the iOS app", async () => {
    saveFile.mockResolvedValue(true);
    const root = await exportWith('a long enough password');

    expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'mindroom-room-keys.txt');
    expect(root.findAllByProps({ role: 'status' }).length).toBeGreaterThan(0);
  }, 30_000);

  it('says nothing was exported when the person closes the save sheet', async () => {
    saveFile.mockResolvedValue(false);
    const root = await exportWith('a long enough password');

    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(root.findAllByProps({ role: 'status' })).toHaveLength(0);
  }, 30_000);
});
