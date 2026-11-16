// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { getRoomCommands, useRoomCommands, type RoomCommand } from './roomCommands';

const command = (id: string): RoomCommand => ({ id, label: id, icon: {} as never, run: () => {} });

function Offer({ commands }: { commands: readonly RoomCommand[] }) {
  useRoomCommands(commands);
  return null;
}

const ids = () => getRoomCommands().map(({ id }) => id);
const mounted: ReactTestRenderer[] = [];
const mount = (commands: readonly RoomCommand[]) => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<Offer commands={commands} />);
  });
  if (!renderer) throw new Error('not mounted');
  mounted.push(renderer);
  return renderer;
};
const unmount = (renderer: ReactTestRenderer) => act(() => renderer.unmount());

afterEach(() => {
  for (const renderer of mounted.splice(0)) unmount(renderer);
});

describe('room commands', () => {
  it('are none while no component offers any', () => {
    expect(getRoomCommands()).toEqual([]);
  });

  it('are the latest commands of the mounted component', () => {
    const renderer = mount([command('a')]);
    expect(ids()).toEqual(['a']);
    act(() => renderer.update(<Offer commands={[command('b'), command('c')]} />));
    expect(ids()).toEqual(['b', 'c']);
  });

  it('are those of the component mounted last, and the earlier ones again once it unmounts', () => {
    const first = mount([command('first')]);
    const second = mount([command('second')]);
    expect(ids()).toEqual(['second']);
    unmount(second);
    expect(ids()).toEqual(['first']);
    unmount(first);
    expect(getRoomCommands()).toEqual([]);
  });
});
