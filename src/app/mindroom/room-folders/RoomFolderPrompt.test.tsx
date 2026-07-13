import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { DeleteRoomFolderPrompt, RoomFolderPrompt } from './RoomFolderPrompt';

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  return {
    ...actual,
    Overlay: ({ children }: { children: React.ReactNode }) => children,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));

const findDialog = (renderer: ReactTestRenderer) => renderer.root.findByProps({ role: 'dialog' });

describe('room folder prompts accessibility', () => {
  it('names the create dialog, close button, and folder-name input', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<RoomFolderPrompt onSubmit={vi.fn()} onCancel={vi.fn()} />);
    });

    const dialog = findDialog(renderer!);
    expect(dialog.props['aria-modal']).toBe('true');
    expect(renderer!.root.findByProps({ id: dialog.props['aria-labelledby'] })).toBeTruthy();
    const inputLabelId = renderer!.root.findByProps({ name: 'folderName' }).props[
      'aria-labelledby'
    ];
    expect(renderer!.root.findByProps({ id: inputLabelId })).toBeTruthy();
    expect(renderer!.root.findByProps({ 'aria-label': 'nav.close' })).toBeTruthy();
  });

  it('names and describes the delete confirmation dialog', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        <DeleteRoomFolderPrompt folderName="Work" onDelete={vi.fn()} onCancel={vi.fn()} />
      );
    });

    const dialog = findDialog(renderer!);
    expect(dialog.props['aria-modal']).toBe('true');
    expect(renderer!.root.findByProps({ id: dialog.props['aria-labelledby'] })).toBeTruthy();
    expect(renderer!.root.findByProps({ id: dialog.props['aria-describedby'] })).toBeTruthy();
    expect(renderer!.root.findByProps({ 'aria-label': 'nav.close' })).toBeTruthy();
  });

  it('announces an asynchronous save failure', async () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        <RoomFolderPrompt
          onSubmit={vi.fn().mockRejectedValue(new Error('offline'))}
          onCancel={vi.fn()}
        />
      );
    });

    await act(async () => {
      await renderer!.root.findByType('form').props.onSubmit({
        preventDefault: vi.fn(),
        currentTarget: {
          elements: { namedItem: () => ({ value: 'Work' }) },
        },
      });
    });

    expect(renderer!.root.findByProps({ role: 'alert' })).toBeTruthy();
  });
});
