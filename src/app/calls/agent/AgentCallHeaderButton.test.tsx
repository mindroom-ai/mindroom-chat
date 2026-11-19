// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { AgentCallHeaderButton } from './AgentCallHeaderButton';

const call = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../matrix/hooks/useRoom', () => ({
  useRoom: () => ({ roomId: '!room:example.org', isCallRoom: () => false }),
}));
vi.mock('./agentCaller', () => ({ useAgentCaller: () => ({ call, pending: false }) }));
vi.mock('../../ui/MenuEntry', () => ({
  MenuEntry: ({ label, onSelect }: { label: string; onSelect: () => void }) =>
    React.createElement('button', { 'data-entry': label, onClick: onSelect }),
}));

const candidates = [
  { userId: '@mindroom_code:example.org', displayName: 'Code' },
  { userId: '@mindroom_ops:example.org', displayName: 'Ops' },
];

it('lists the agents as entries of the room menu, where a narrow row left its button out', () => {
  const closeMenu = vi.fn();
  const menu = create(
    <AgentCallHeaderButton threadId="$thread" candidates={candidates} inMenu={closeMenu} />
  );
  const entries = menu.root.findAllByType('button');
  // One entry an agent, no button and no chooser of its own.
  expect(entries.map((entry) => entry.props['data-entry'])).toEqual(['Call Code', 'Call Ops']);
  expect(menu.root.findAllByProps({ 'data-agent-call-button': '' })).toHaveLength(0);
  act(() => {
    entries[1]!.props.onClick();
  });
  // The menu closes, and the call is about the open thread, as the button's is.
  expect(closeMenu).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith({
    agentUserId: '@mindroom_ops:example.org',
    displayName: 'Ops',
    roomId: '!room:example.org',
    threadId: '$thread',
  });
  menu.unmount();

  // Without the menu's part, it is the row's button.
  const row = create(<AgentCallHeaderButton threadId="$thread" candidates={candidates} />);
  expect(row.root.findAllByProps({ 'data-entry': 'Call Ops' })).toHaveLength(0);
  row.unmount();
});
