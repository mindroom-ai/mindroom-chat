import { type ReactElement, useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { type PanelPresence, usePanelPresence, usePanelSlot } from './panelPresence';

let presence: PanelPresence | undefined;

/** A panel that moves: it registers with its slot and reports the slot's phase. */
function Mover({ name }: { name: string }) {
  presence = usePanelPresence();
  const register = presence?.register;
  useLayoutEffect(() => register?.(), [register]);
  return <span data-panel={name} />;
}

function Slot({ panel }: { panel?: ReactElement }) {
  return <>{usePanelSlot(panel)}</>;
}

const shown = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'span').map((node) => node.props['data-panel']);

const renderSlot = (panel?: ReactElement) => {
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(<Slot panel={panel} />);
  });
  const update = (next?: ReactElement) => act(() => renderer.update(<Slot panel={next} />));
  return { renderer: renderer!, update };
};

describe('usePanelSlot', () => {
  it('shows a panel that is there from the start without moving it in', () => {
    const { renderer } = renderSlot(<Mover key="members" name="members" />);
    expect(shown(renderer)).toEqual(['members']);
    expect(presence?.phase).toBe('shown');
  });

  it('opens, keeps a closing panel until it is done, and then removes it', () => {
    const { renderer, update } = renderSlot();
    expect(shown(renderer)).toEqual([]);
    update(<Mover key="members" name="members" />);
    expect(presence?.phase).toBe('enter');
    update(undefined);
    expect(shown(renderer)).toEqual(['members']);
    expect(presence?.phase).toBe('exit');
    act(() => presence?.done());
    expect(shown(renderer)).toEqual([]);
  });

  it('turns a closing panel around when it is asked for again', () => {
    const { renderer, update } = renderSlot(<Mover key="members" name="members" />);
    update(undefined);
    update(<Mover key="members" name="members" />);
    expect(presence?.phase).toBe('enter');
    act(() => presence?.done());
    expect(shown(renderer)).toEqual(['members']);
  });

  it('swaps one panel for another without closing first', () => {
    const { renderer, update } = renderSlot(<Mover key="members" name="members" />);
    update(<Mover key="computer" name="computer" />);
    expect(shown(renderer)).toEqual(['computer']);
    expect(presence?.phase).toBe('swap');
  });

  it('removes content that does not move at once', () => {
    const { renderer, update } = renderSlot(<span key="plain" data-panel="plain" />);
    update(undefined);
    expect(shown(renderer)).toEqual([]);
  });
});
