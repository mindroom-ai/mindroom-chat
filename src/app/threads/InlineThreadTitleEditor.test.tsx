import type { Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineThreadTitleEditor } from './InlineThreadTitleEditor';

const state = vi.hoisted(() => ({
  save: vi.fn(),
  actionError: undefined as string | undefined,
  client: {} as object | undefined,
}));
vi.mock('./summary/threadSummaryActions', async (original) => ({
  ...(await original<typeof import('./summary/threadSummaryActions')>()),
  saveThreadSummary: state.save,
  getThreadSummaryActionError: () => state.actionError,
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useOptionalMatrixClient: () => state.client,
}));
vi.mock('./ThreadContextBanner.css', () => ({ TitleInput: 'TitleInput' }));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

const ROOT = '$root:test';
const room = (roomId = '!room:test') => ({ roomId } as unknown as Room);

const editor = (text: string, rootId = ROOT, roomValue = room()) => (
  <InlineThreadTitleEditor room={roomValue} rootId={rootId} text={text}>
    {({ onDoubleClick, hint }) => (
      <span data-title="" title={hint} onDoubleClick={onDoubleClick}>
        {text}
      </span>
    )}
  </InlineThreadTitleEditor>
);

const focus = vi.fn();
const createNodeMock = () => ({
  focus,
  select: vi.fn(),
  ownerDocument: { activeElement: null, body: {} },
});

const render = (text = 'image.png') => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(editor(text), {
      createNodeMock,
    });
  });
  return renderer;
};

const title = (renderer: ReactTestRenderer) => renderer.root.findByProps({ 'data-title': '' });
const input = (renderer: ReactTestRenderer) => renderer.root.findByType('input');
const startEditing = (renderer: ReactTestRenderer) =>
  act(() => {
    (title(renderer).props.onDoubleClick as () => void)();
  });
const type = (renderer: ReactTestRenderer, value: string) =>
  act(() => {
    input(renderer).props.onChange({ target: { value } });
  });
const press = async (renderer: ReactTestRenderer, key: string) => {
  const event = {
    key,
    nativeEvent: { isComposing: false },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  await act(async () => {
    input(renderer).props.onKeyDown(event);
    await Promise.resolve();
  });
  return event;
};
const alerts = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => typeof node.type === 'string' && node.props.role === 'alert');

describe('InlineThreadTitleEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actionError = undefined;
    state.client = {};
    state.save.mockResolvedValue(undefined);
  });

  it('turns the title into a field holding its whole text on double-click', () => {
    const renderer = render('image.png and the rest of the first message');
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    expect(title(renderer).props.title).toBe('Double-click to rename');
    startEditing(renderer);
    expect(renderer.root.findAllByProps({ 'data-title': '' })).toHaveLength(0);
    expect(input(renderer).props.value).toBe('image.png and the rest of the first message');
    expect(input(renderer).props['aria-label']).toBe('Summary');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('saves the new title on Enter and goes back to the title', async () => {
    const renderer = render();
    startEditing(renderer);
    type(renderer, '  Screenshot   of the header ');
    const event = await press(renderer, 'Enter');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(state.save).toHaveBeenCalledWith(
      state.client,
      expect.objectContaining({ roomId: '!room:test' }),
      ROOT,
      'Screenshot of the header'
    );
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    expect(title(renderer)).toBeDefined();
  });

  it('disables the field while the title saves', async () => {
    let finish!: () => void;
    state.save.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const renderer = render();
    startEditing(renderer);
    type(renderer, 'New title');
    await press(renderer, 'Enter');
    expect(input(renderer).props.disabled).toBe(true);
    await act(async () => {
      input(renderer).props.onBlur();
      finish();
      await Promise.resolve();
    });
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
  });

  it('saves on blur', async () => {
    const renderer = render();
    startEditing(renderer);
    type(renderer, 'New title');
    await act(async () => {
      input(renderer).props.onBlur();
      await Promise.resolve();
    });
    expect(state.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ROOT,
      'New title'
    );
  });

  it('cancels on Escape without saving or letting the key leave the field', async () => {
    const renderer = render();
    startEditing(renderer);
    type(renderer, 'Something else');
    const event = await press(renderer, 'Escape');
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    expect(title(renderer).children).toEqual(['image.png']);
  });

  it('sends nothing for an unchanged or empty title', async () => {
    const renderer = render();
    startEditing(renderer);
    type(renderer, ' image.png ');
    await press(renderer, 'Enter');
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    startEditing(renderer);
    type(renderer, '   ');
    await press(renderer, 'Enter');
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    expect(state.save).not.toHaveBeenCalled();
  });

  it('keeps editing an over-long title and shows its length', async () => {
    const renderer = render();
    startEditing(renderer);
    type(renderer, 'x'.repeat(301));
    await press(renderer, 'Enter');
    expect(state.save).not.toHaveBeenCalled();
    expect(input(renderer).props.value).toBe('x'.repeat(301));
    expect(alerts(renderer)[0]?.children).toEqual(['301 / 300 characters']);
  });

  it('keeps editing after a failed save and says it failed', async () => {
    state.save.mockRejectedValueOnce(new Error('Offline'));
    const renderer = render();
    startEditing(renderer);
    type(renderer, 'New title');
    await press(renderer, 'Enter');
    expect(input(renderer).props.value).toBe('New title');
    expect(input(renderer).props.disabled).toBe(false);
    expect(alerts(renderer)).toHaveLength(1);
    // Once on opening, and again when the save that disabled the field fails.
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it('leaves the title alone where the user may not set it', () => {
    state.actionError = 'You cannot send messages in this room.';
    const renderer = render();
    expect(title(renderer).props.onDoubleClick).toBeUndefined();
    expect(title(renderer).props.title).toBeUndefined();
  });

  it('leaves the title alone before the thread root is confirmed', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(editor('image.png', '~local-echo'));
    });
    expect(title(renderer).props.onDoubleClick).toBeUndefined();
  });

  it('stops editing when another thread opens', () => {
    const renderer = render();
    startEditing(renderer);
    act(() => renderer.update(editor('Other thread', '$other:test')));
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    act(() => renderer.update(editor('image.png')));
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
  });
});
