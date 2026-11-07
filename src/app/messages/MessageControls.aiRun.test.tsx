import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { AiRunControls, type AiRunControlsRenderProps } from './MessageControls';

vi.mock('../ui/ModalLayer', () => ({
  ModalLayer: ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
    open ? <div data-modal="">{children}</div> : null,
}));
vi.mock('./reply/ReplyDetails', () => ({ ReplyDetails: () => null }));
vi.mock('./MessageControls.css', () => ({ ReplyDetailsScroll: 'ReplyDetailsScroll' }));
vi.mock('../ui/styles/Glass.css', () => ({ glassDenseOverBackdrop: 'glass' }));

/** A row with state of its own, as an open tool-call list is. */
function Row({ controls }: { controls: AiRunControlsRenderProps | undefined }) {
  const [opened, setOpened] = useState(false);
  return (
    <button type="button" data-opened={opened} onClick={() => setOpened(true)}>
      {controls ? 'with details' : 'without details'}
    </button>
  );
}

const render = (info: { status: string } | undefined) => (
  <AiRunControls info={info}>{(controls) => <Row controls={controls} />}</AiRunControls>
);

describe('AiRunControls', () => {
  it('keeps the row and its state when the run details arrive with a later edit', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(render(undefined));
    });
    const row = () => renderer.root.findByType('button');
    expect(row().props.children).toBe('without details');
    act(() => row().props.onClick());
    expect(row().props['data-opened']).toBe(true);

    act(() => renderer.update(render({ status: 'completed' })));
    expect(row().props.children).toBe('with details');
    expect(row().props['data-opened']).toBe(true);

    act(() => renderer.update(render(undefined)));
    expect(row().props['data-opened']).toBe(true);
    renderer.unmount();
  });
});
