import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddCustomEmoji } from './AddCustomEmoji';

const mx = vi.hoisted(() => ({
  getAccountData: vi.fn(),
  setAccountData: vi.fn(),
  uploadContent: vi.fn(),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mx,
}));
vi.mock('../../../hooks/useObjectURL', () => ({
  useObjectURL: () => 'blob:preview',
}));
vi.mock('../../../utils/dom', () => ({
  loadImageElement: vi.fn(async () => ({ width: 32, height: 24 })),
}));
vi.mock('./styles.css', () => ({ AddCustomEmoji: 'form', AddCustomEmojiPreview: 'preview' }));

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
});

const renderForm = () => {
  const onAdd = vi.fn();
  const file = new File(['gif'], 'party parrot.gif', { type: 'image/gif' });
  act(() => {
    renderer = create(<AddCustomEmoji file={file} onCancel={vi.fn()} onAdd={onAdd} />);
  });
  const submit = () =>
    act(async () => {
      renderer!.root
        .findByType('form')
        .props.onSubmit({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    });
  return { file, onAdd, submit };
};

describe('AddCustomEmoji', () => {
  it('uploads the image to the personal pack under a free shortcode and selects it', async () => {
    const existing = { url: 'mxc://example.org/old' };
    mx.getAccountData.mockReturnValue({
      getContent: () => ({ images: { 'party-parrot': existing } }),
    });
    mx.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.org/new' });
    mx.setAccountData.mockResolvedValue({});
    const { file, onAdd, submit } = renderForm();

    expect(renderer!.root.findByType('input').props.value).toBe('party-parrot');
    await submit();

    expect(mx.uploadContent).toHaveBeenCalledWith(file, {
      name: 'party parrot.gif',
      type: 'image/gif',
    });
    expect(mx.setAccountData).toHaveBeenCalledWith('im.ponies.user_emotes', {
      images: {
        'party-parrot': existing,
        'party-parrot1': {
          url: 'mxc://example.org/new',
          info: { w: 32, h: 24, mimetype: 'image/gif', size: 3 },
        },
      },
    });
    expect(onAdd).toHaveBeenCalledWith('mxc://example.org/new', 'party-parrot1');
  });

  it('keeps the form with an error when the upload fails', async () => {
    mx.uploadContent.mockRejectedValue(new Error('too large'));
    const { onAdd, submit } = renderForm();

    await submit();

    expect(mx.setAccountData).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
    expect(
      renderer!.root.findAllByProps({ children: "Couldn't add the emoji. Try again." })
    ).not.toHaveLength(0);
  });
});
