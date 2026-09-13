type RuntimeConfig = {
  __ENABLE_SERVICE_WORKER__?: boolean | string;
};

export const isServiceWorkerEnabled = (): boolean => {
  if (typeof globalThis === 'undefined') return false;
  const value = (globalThis as RuntimeConfig).__ENABLE_SERVICE_WORKER__;
  if (value === true) return true;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
};
