import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { AiRunInfo } from '../matrix/protocol/aiRun';
import {
  AiRunControls,
  useMessageControls,
  type AiRunControlsRenderProps,
} from './MessageControls';

vi.mock('../ui/ModalLayer', () => ({
  ModalLayer: ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
    open ? <div data-modal="">{children}</div> : null,
}));
vi.mock('./reply/ReplyDetails', () => ({ ReplyDetails: () => null }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@viewer:example.org' }),
}));

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
    act(() => {
      row().props.onClick();
    });
    expect(row().props['data-opened']).toBe(true);

    act(() => renderer.update(render({ status: 'completed' })));
    expect(row().props.children).toBe('with details');
    expect(row().props['data-opened']).toBe(true);

    act(() => renderer.update(render(undefined)));
    expect(row().props['data-opened']).toBe(true);
    renderer.unmount();
  });
});

describe('useMessageControls', () => {
  const content = {
    msgtype: 'm.text',
    body: 'Reviewed.',
    'io.mindroom.ai_run': {
      version: 1,
      status: 'completed',
      cost: { usd: '0.0125', subagents_usd: '0.375' },
    },
  };
  const infoFrom = (sender: string, runContent: Record<string, unknown> = content) => {
    let info: AiRunInfo | undefined;
    function Probe() {
      info = useMessageControls(
        runContent,
        false,
        new MatrixEvent({ type: 'm.room.message', sender, content: runContent })
      ).aiRunInfo;
      return null;
    }
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Probe />);
    });
    renderer.unmount();
    return info;
  };

  it("keeps a MindRoom agent's costs", () => {
    const info = infoFrom('@mindroom_code:example.org');
    expect(info?.costUsd).toBe(0.0125);
    expect(info?.subagentsCostUsd).toBe(0.375);
  });

  it('drops both costs from anyone else, a subagents cost alone included', () => {
    const info = infoFrom('@someone:example.org');
    expect(info?.costUsd).toBeUndefined();
    expect(info?.subagentsCostUsd).toBeUndefined();
    const subagentsOnly = {
      ...content,
      'io.mindroom.ai_run': { version: 1, status: 'completed', cost: { subagents_usd: '0.375' } },
    };
    expect(infoFrom('@someone:example.org', subagentsOnly)?.subagentsCostUsd).toBeUndefined();
  });
});
