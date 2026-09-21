/** Keep mount measurements synchronous; scan detached nodes once after React removes them. */
export const createBatchedMeasurementRef = <T extends Element>(
  measure: (node: T | null) => void
) => {
  let cleanupQueued = false;
  return (node: T | null) => {
    if (node !== null) {
      measure(node);
      return;
    }
    // virtual-core's null ref scans every cached element. React detaches refs
    // before DOM deletion, so per-row scans are both repeated and premature.
    if (cleanupQueued) return;
    cleanupQueued = true;
    queueMicrotask(() => {
      cleanupQueued = false;
      measure(null);
    });
  };
};
