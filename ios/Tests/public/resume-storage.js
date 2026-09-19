// Throwaway synthetic IndexedDB workload; no production instrumentation changes.
const state = {
  bootId: window.routingBootId,
  reads: 0,
  ticks: 0,
  writes: 0,
  closed: false,
  error: null,
  lifecycle: [],
};
let database;
let writing = false;
const request = indexedDB.open('mindroom-resume-storage-probe', 1);
request.onupgradeneeded = () => request.result.createObjectStore('values');
const recordError = (error) => {
  state.error = { name: error?.name ?? 'unknown', message: error?.message ?? String(error) };
};
request.onerror = () => recordError(request.error);
request.onsuccess = () => {
  database = request.result;
  database.onclose = () => {
    state.closed = true;
  };
};
setInterval(() => {
  state.ticks += 1;
}, 250);
setInterval(() => {
  if (!database || writing || state.error) return;
  writing = true;
  try {
    const tx = database.transaction('values', 'readwrite');
    // Keep each transaction comparable to the real recorder's 50-event batch.
    for (let index = 0; index < 50; index += 1) {
      tx.objectStore('values').put({ at: Date.now(), value: 'synthetic' }, index);
    }
    tx.oncomplete = () => {
      state.writes += 1;
      writing = false;
    };
    tx.onabort = () => {
      recordError(tx.error);
      writing = false;
    };
    tx.onerror = () => {
      recordError(tx.error);
      writing = false;
    };
  } catch (error) {
    recordError(error);
    writing = false;
  }
}, 100);
document.addEventListener('visibilitychange', () => {
  state.lifecycle.push({ at: Date.now(), state: document.visibilityState });
});
const button = document.createElement('button');
button.textContent = 'Read storage probe';
button.style.cssText = 'position:fixed;top:208px;left:8px;min-height:44px';
const output = document.createElement('button');
output.style.cssText = 'position:fixed;top:264px;left:8px;width:44px;height:44px;overflow:hidden';
button.addEventListener('click', async () => {
  const native = await window.Capacitor.nativePromise('MindRoomDiagnostics', 'read', {});
  state.reads += 1;
  output.textContent = `Storage probe ${JSON.stringify({
    ...state,
    nativeSession: native.currentSessionId,
    nativeEvents: native.events
      .filter((event) => event.sessionId === native.currentSessionId)
      .map(({ name, sequence }) => ({ name, sequence })),
  })}`;
});
document.body.append(button, output);
