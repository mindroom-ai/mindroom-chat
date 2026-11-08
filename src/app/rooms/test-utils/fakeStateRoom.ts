type Content = Record<string, unknown>;

/**
 * A room stand-in whose live state answers `getStateEvents` from `state` (event type, then state
 * key, then content); a joined chat room unless told otherwise.
 */
export const fakeStateRoom = (
  state: Record<string, Record<string, Content>>,
  membership = 'join',
  space = false
) => ({
  getMyMembership: () => membership,
  isSpaceRoom: () => space,
  getLiveTimeline: () => ({
    getState: () => ({
      getStateEvents: (type: string, stateKey?: string) => {
        const byKey = state[type] ?? {};
        const event = (key: string) => ({ getContent: () => byKey[key], getStateKey: () => key });
        if (stateKey === undefined) return Object.keys(byKey).map(event);
        return byKey[stateKey] ? event(stateKey) : null;
      },
    }),
  }),
});
