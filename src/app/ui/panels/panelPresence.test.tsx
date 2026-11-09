import { createContext, type ReactElement, useContext, useLayoutEffect, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { type PanelPresence, usePanelForm, usePanelPresence, usePanelSlot } from './panelPresence';

let presence: PanelPresence | undefined;

/** A panel that moves: it registers with its slot and reports the slot's phase. */
function Mover({ name }: { name: string }) {
  presence = usePanelPresence();
  const register = presence?.register;
  useLayoutEffect(() => register?.(), [register]);
  return <span data-panel={name} />;
}

let slotRenders = 0;
let slotCommits = 0;

function Slot({ panel }: { panel?: ReactElement }) {
  slotRenders += 1;
  useLayoutEffect(() => {
    slotCommits += 1;
  });
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

  it('ends no later exit with the done of a panel that has gone', () => {
    const { renderer, update } = renderSlot(<Mover key="members" name="members" />);
    update(undefined);
    const gone = presence?.done;
    // Another panel takes the closing one's place and closes too, before the first one's motion ends.
    update(<Mover key="computer" name="computer" />);
    update(undefined);
    act(() => gone?.());
    expect(shown(renderer)).toEqual(['computer']);
    act(() => presence?.done());
    expect(shown(renderer)).toEqual([]);
  });

  it('ends no later exit with a done that a finished motion queued before its panel went', async () => {
    const { renderer, update } = renderSlot(<Mover key="members" name="members" />);
    update(undefined);
    const finished = Promise.resolve();
    void finished.then(presence?.done);
    update(<Mover key="computer" name="computer" />);
    update(undefined);
    await act(async () => {
      await finished;
    });
    expect(shown(renderer)).toEqual(['computer']);
  });

  it('ends the exit when its moving panel goes before it is done, such as for a failure', () => {
    const { renderer, update } = renderSlot();
    update(<Failing key="card" />);
    update(undefined);
    expect(presence?.phase).toBe('exit');
    act(() => fail?.());
    expect(shown(renderer)).toEqual([]);
  });

  it('keeps an open panel whose moving panel goes', () => {
    const { renderer, update } = renderSlot();
    update(<Failing key="card" />);
    act(() => fail?.());
    expect(shown(renderer)).toEqual(['failed']);
  });

  it('waits for a moving panel that registers again as it starts to close', () => {
    const { renderer, update } = renderSlot();
    update(<PhaseMover key="card" />);
    update(undefined);
    expect(shown(renderer)).toEqual(['card']);
    act(() => presence?.done());
    expect(shown(renderer)).toEqual([]);
  });

  it('renders once as its moving panel finishes closing', () => {
    const { update } = renderSlot();
    update(<Mover key="members" name="members" />);
    update(undefined);
    slotRenders = 0;
    act(() => presence?.done());
    expect(slotRenders).toBe(1);
  });

  it('changes only as it closes and as it is done, when its moving panel stays still', () => {
    const { renderer, update } = renderSlot(<StillMover key="members" />);
    slotCommits = 0;
    update(undefined);
    expect(shown(renderer)).toEqual([]);
    expect(slotCommits).toBe(2);
  });
});

/** A moving panel that stays still (such as one that fills the room): done as soon as it closes. */
function StillMover() {
  const own = usePanelPresence();
  const register = own?.register;
  useLayoutEffect(() => register?.(), [register]);
  const closing = own?.phase === 'exit';
  const done = own?.done;
  useLayoutEffect(() => {
    if (closing) done?.();
  }, [closing, done]);
  return <span data-panel="still" />;
}

/** A moving panel that registers anew with each phase it gets. */
function PhaseMover() {
  const own = usePanelPresence();
  presence = own;
  useLayoutEffect(() => own?.register(), [own]);
  return <span data-panel="card" />;
}

let fail: (() => void) | undefined;

/** A moving panel that something else (a failure) can take the place of while it shows. */
function Failing() {
  const [failed, setFailed] = useState(false);
  fail = () => setFailed(true);
  return failed ? <span data-panel="failed" /> : <Mover name="card" />;
}

/** The form the layout asks panels for: beside the content or over it. */
const LayoutForm = createContext<'beside' | 'over'>('beside');

/** Every form a FormedMover was committed in, in order. */
let committedForms: string[] = [];

/** A moving panel that shows in the form the layout asks for, and reports the form it took. */
function FormedMover({ name }: { name: string }) {
  presence = usePanelPresence();
  const form = usePanelForm(useContext(LayoutForm));
  const register = presence?.register;
  useLayoutEffect(() => register?.(), [register]);
  useLayoutEffect(() => {
    committedForms.push(form);
  });
  return <span data-panel={name} data-form={form} />;
}

const forms = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'span').map((node) => node.props['data-form']);

const renderFormedSlot = (form: 'beside' | 'over', open: boolean) => {
  const tree = (nextForm: 'beside' | 'over', nextOpen: boolean) => (
    <LayoutForm.Provider value={nextForm}>
      <Slot panel={nextOpen ? <FormedMover key="members" name="members" /> : undefined} />
    </LayoutForm.Provider>
  );
  committedForms = [];
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(tree(form, open));
  });
  const update = (nextForm: 'beside' | 'over', nextOpen: boolean) =>
    act(() => renderer.update(tree(nextForm, nextOpen)));
  return { renderer: renderer!, update };
};

describe('usePanelForm', () => {
  it('follows the layout while the panel is open', () => {
    const { renderer, update } = renderFormedSlot('beside', true);
    expect(forms(renderer)).toEqual(['beside']);
    update('over', true);
    expect(forms(renderer)).toEqual(['over']);
  });

  it('lets a closing panel move out in the form it had', () => {
    const { renderer, update } = renderFormedSlot('over', true);
    update('over', false);
    expect(presence?.phase).toBe('exit');
    expect(forms(renderer)).toEqual(['over']);
    act(() => presence?.done());
    expect(forms(renderer)).toEqual([]);
  });

  it('removes a closing panel at once, in the form it had, when the layout changes', () => {
    const { renderer, update } = renderFormedSlot('beside', true);
    // The window narrows: the layout asks for the over form and closes the panel together.
    update('over', false);
    expect(forms(renderer)).toEqual([]);
    expect(committedForms).not.toContain('over');
  });

  it('removes a panel at once when the layout changes while it closes', () => {
    const { renderer, update } = renderFormedSlot('beside', true);
    update('beside', false);
    expect(forms(renderer)).toEqual(['beside']);
    update('over', false);
    expect(forms(renderer)).toEqual([]);
    expect(committedForms).not.toContain('over');
  });
});
