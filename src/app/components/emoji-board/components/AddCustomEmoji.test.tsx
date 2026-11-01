import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddCustomEmoji } from './AddCustomEmoji';

const mx = vi.hoisted(() => ({
  getAccountData: vi.fn(),
  getSafeUserId: vi.fn(() => '@alice:example.org'),
  setAccountData: vi.fn(),
  uploadContent: vi.fn(),
}));
const server = vi.hoisted(() => ({
  addToServerPack: vi.fn(),
  canAddServerEmoji: vi.fn(),
  useServerEmojiRoom: vi.fn(),
}));
const dom = vi.hoisted(() => ({
  getThumbnail: vi.fn(),
  loadImageElement: vi.fn(),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mx,
}));
vi.mock('../../../mindroom/server-emoji/useServerEmojiRoom', () => ({
  useServerEmojiRoom: server.useServerEmojiRoom,
}));
vi.mock('../../../mindroom/server-emoji/addToServerPack', () => ({
  addToServerPack: server.addToServerPack,
  canAddServerEmoji: server.canAddServerEmoji,
}));
vi.mock('../../../hooks/useObjectURL', () => ({
  useObjectURL: () => 'blob:preview',
}));
vi.mock('../../../utils/dom', () => dom);
vi.mock('../../../utils/user-agent', () => ({ mobileOrTablet: () => false }));
vi.mock('./styles.css', () => ({ AddCustomEmoji: 'form', AddCustomEmojiPreview: 'preview' }));

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  // Without a server emoji room the form adds to the personal pack, as before.
  server.useServerEmojiRoom.mockReturnValue(undefined);
  server.canAddServerEmoji.mockReturnValue(false);
  dom.loadImageElement.mockResolvedValue({ width: 32, height: 24 });
  mx.getAccountData.mockReturnValue(undefined);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
});

const renderForm = (file = new File(['gif'], 'party parrot.gif', { type: 'image/gif' })) => {
  const onAdd = vi.fn();
  const form = () => <AddCustomEmoji file={file} onCancel={vi.fn()} onAdd={onAdd} />;
  act(() => {
    renderer = create(form());
  });
  const rerender = () => act(() => renderer!.update(form()));
  const submit = () =>
    act(async () => {
      renderer!.root
        .findByType('form')
        .props.onSubmit({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    });
  return { file, onAdd, rerender, submit };
};

const textNodes = (text: string) => renderer!.root.findAllByProps({ children: text });

const serverRoom = { roomId: '!emoji' };
const personalDescription = 'It is saved to your Personal Pack, so you can use it in every room.';

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

  it('adds to the server pack when the user may, and says everyone can use it', async () => {
    server.useServerEmojiRoom.mockReturnValue(serverRoom);
    server.canAddServerEmoji.mockReturnValue(true);
    server.addToServerPack.mockResolvedValue('party-parrot');
    mx.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.org/new' });
    const { onAdd, submit } = renderForm();

    expect(textNodes('Everyone on example.org can use it in every room.')).not.toHaveLength(0);
    expect(textNodes(personalDescription)).toHaveLength(0);
    await submit();

    expect(server.canAddServerEmoji).toHaveBeenCalledWith(mx, serverRoom);
    expect(server.addToServerPack).toHaveBeenCalledWith(mx, serverRoom, 'party-parrot', {
      url: 'mxc://example.org/new',
      info: { w: 32, h: 24, mimetype: 'image/gif', size: 3 },
    });
    expect(mx.setAccountData).not.toHaveBeenCalled();
    expect(onAdd).toHaveBeenCalledWith('mxc://example.org/new', 'party-parrot');
  });

  it('selects the shortcode the server pack gave the emoji', async () => {
    server.useServerEmojiRoom.mockReturnValue(serverRoom);
    server.canAddServerEmoji.mockReturnValue(true);
    server.addToServerPack.mockResolvedValue('party-parrot1');
    mx.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.org/new' });
    const { onAdd, submit } = renderForm();

    await submit();

    expect(onAdd).toHaveBeenCalledWith('mxc://example.org/new', 'party-parrot1');
  });

  it('falls back to the personal pack when the user may not add server emoji', async () => {
    const existing = { url: 'mxc://example.org/old' };
    server.useServerEmojiRoom.mockReturnValue(serverRoom);
    server.canAddServerEmoji.mockReturnValue(false);
    mx.getAccountData.mockReturnValue({
      getContent: () => ({ images: { 'party-parrot': existing } }),
    });
    mx.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.org/new' });
    mx.setAccountData.mockResolvedValue({});
    const { onAdd, submit } = renderForm();

    expect(textNodes(personalDescription)).not.toHaveLength(0);
    expect(textNodes('Everyone on example.org can use it in every room.')).toHaveLength(0);
    await submit();

    expect(server.addToServerPack).not.toHaveBeenCalled();
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

  it('submits to the pack its description names, as set when the form last rendered', async () => {
    server.addToServerPack.mockResolvedValue('party-parrot');
    mx.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.org/new' });
    const { rerender, submit } = renderForm();
    expect(textNodes(personalDescription)).not.toHaveLength(0);

    // The user joins the server emoji room while the form is open.
    server.useServerEmojiRoom.mockReturnValue(serverRoom);
    server.canAddServerEmoji.mockReturnValue(true);
    rerender();
    expect(textNodes('Everyone on example.org can use it in every room.')).not.toHaveLength(0);
    // A power level change after that render does not redirect the submit.
    server.canAddServerEmoji.mockReturnValue(false);
    await submit();

    expect(server.addToServerPack).toHaveBeenCalledTimes(1);
    expect(mx.setAccountData).not.toHaveBeenCalled();
  });

  it('refuses a GIF over 256 KB without uploading it', async () => {
    const gif = new File([new Uint8Array(300 * 1024)], 'party parrot.gif', { type: 'image/gif' });
    const { onAdd, submit } = renderForm(gif);

    await submit();

    expect(mx.uploadContent).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
    expect(textNodes('Animated GIFs must be under 256 KB.')).not.toHaveLength(0);
  });

  it('uploads a large still image drawn at 128 pixels as a PNG', async () => {
    const resized = new Blob(['resized'], { type: 'image/png' });
    dom.loadImageElement.mockResolvedValue({ width: 512, height: 256 });
    dom.getThumbnail.mockResolvedValue(resized);
    mx.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.org/new' });
    mx.setAccountData.mockResolvedValue({});
    const { onAdd, submit } = renderForm(
      new File(['jpeg'], 'party parrot.jpg', { type: 'image/jpeg' })
    );

    await submit();

    const [uploaded, options] = mx.uploadContent.mock.calls[0];
    expect([uploaded.name, uploaded.type, uploaded.size]).toEqual([
      'party parrot.png',
      'image/png',
      resized.size,
    ]);
    expect(options).toEqual({ name: 'party parrot.png', type: 'image/png' });
    expect(mx.setAccountData).toHaveBeenCalledWith('im.ponies.user_emotes', {
      images: {
        'party-parrot': {
          url: 'mxc://example.org/new',
          info: { w: 128, h: 64, mimetype: 'image/png', size: resized.size },
        },
      },
    });
    expect(onAdd).toHaveBeenCalledWith('mxc://example.org/new', 'party-parrot');
  });
});
