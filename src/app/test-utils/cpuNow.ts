/**
 * The CPU time this thread has used, in milliseconds: the clock of tests that guard against slow
 * algorithms. Unlike `performance.now()` it stands still while the test waits for a CPU, so a
 * loaded machine does not fail them; their bounds stay as they were.
 */
export const cpuNow = (): number => {
  const { user, system } = process.threadCpuUsage();
  return (user + system) / 1000;
};
