// Plain module-level registry (never a Jotai atom) so account switches can abort active jobs
// and evict placeholder upload atoms without pulling useMediaCompression into the initial chunk.
type ActiveCompressionJob = {
  controller: AbortController;
  onAbort?: () => void;
};

const activeJobs = new Set<ActiveCompressionJob>();
let abortGeneration = 0;

/** Returns the current session abort generation for in-flight media compression jobs. */
export const getMediaCompressionGeneration = (): number => abortGeneration;

/** Registers an active compression job and returns an unregister callback. */
export const registerMediaCompressionJob = (
  controller: AbortController,
  onAbort?: () => void
): (() => void) => {
  const job: ActiveCompressionJob = { controller, onAbort };
  activeJobs.add(job);
  return () => {
    activeJobs.delete(job);
  };
};

/** Aborts all active media compression jobs and runs their cleanup callbacks (session switch/logout). */
export const abortAllMediaCompressions = (): void => {
  abortGeneration += 1;
  const jobs = [...activeJobs];
  activeJobs.clear();
  jobs.forEach(({ controller, onAbort }) => {
    controller.abort();
    onAbort?.();
  });
};
