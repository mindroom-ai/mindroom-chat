type LockCallback = (lock: { name: string } | null) => unknown;

/**
 * The Web Locks API for exclusive locks, shared by every tab of a browser: one holder per name
 * with a queue behind it, `ifAvailable`, and `query`. Requests are answered after the current
 * task, as the browser's lock manager answers them.
 */
export const fakeWebLocks = () => {
  const held = new Set<string>();
  const queued: { name: string; grant: () => void }[] = [];
  const grantNext = (name: string) => {
    const index = queued.findIndex((entry) => entry.name === name);
    if (index >= 0) queued.splice(index, 1)[0]?.grant();
  };
  const request = (
    name: string,
    ...args: [LockCallback] | [{ ifAvailable?: boolean }, LockCallback]
  ): Promise<unknown> => {
    const [options, callback] = args.length === 1 ? [{}, args[0]] : args;
    return new Promise((resolve, reject) => {
      const grant = () => {
        held.add(name);
        Promise.resolve()
          .then(() => callback({ name }))
          .finally(() => {
            held.delete(name);
            grantNext(name);
          })
          .then(resolve, reject);
      };
      setTimeout(() => {
        if (!held.has(name) && !queued.some((entry) => entry.name === name)) grant();
        else if (options.ifAvailable) Promise.resolve(callback(null)).then(resolve, reject);
        else queued.push({ name, grant });
      }, 0);
    });
  };
  return {
    request,
    query: async () => ({
      held: [...held].map((name) => ({ name })),
      pending: queued.map(({ name }) => ({ name })),
    }),
  };
};

export type FakeWebLocks = ReturnType<typeof fakeWebLocks>;

/**
 * Another tab holding a lock from its own page, such as a tab of the same session in a call.
 * `release` resolves once the lock manager let the lock go.
 */
export const holdLockInOtherTab = (locks: FakeWebLocks, name: string) => {
  let release: () => void = () => undefined;
  const done = locks.request(
    name,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  return {
    release: async () => {
      release();
      await done;
    },
  };
};

/** Lets every queued lock request and promise step run. */
export const settleLocks = () => new Promise((resolve) => setTimeout(resolve, 5));
