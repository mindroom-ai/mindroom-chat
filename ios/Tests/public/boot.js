// Boot script of the iOS test host's page (index.html beside it). Plain browser JavaScript: the
// folder is copied into the app as it is, without a build step.

// A new id on every JavaScript boot: once the id changes, a test knows that a load, a reload or
// a restarted web content process has booted the page again.
window.routingBootId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
  byte.toString(16).padStart(2, '0')
).join('');

const PLUGIN = 'MindRoomDiagnostics';

// The plugin's snapshot, or a status that says why there is none.
const readNativeDiagnostics = async () => {
  const bridge = window.Capacitor;
  if (!bridge?.isPluginAvailable?.(PLUGIN)) return { status: 'unsupported', events: [] };
  try {
    const snapshot = await bridge.nativePromise(PLUGIN, 'read', {});
    if (snapshot && typeof snapshot === 'object') return snapshot;
  } catch {
    // A failed read is reported as unavailable, like an answer that is not a snapshot.
  }
  return { status: 'unavailable', events: [] };
};

const result = document.getElementById('native-diagnostics-result');
let readCount = 0;

// ios/Tests/UI/NativeDiagnosticsTests.swift decodes the label after "Native diagnostics " as JSON,
// so the label goes in one step from one complete snapshot to the next. The JSON can be long:
// it stays in the label, and the visible text stays short, clear of the centre of the view.
const show = (snapshot) => {
  readCount += 1;
  const shown = { ...snapshot, readCount };
  result.setAttribute('aria-label', `Native diagnostics ${JSON.stringify(shown)}`);
  result.textContent = `Diagnostics: ${shown.status}, read ${readCount}`;
  result.hidden = false;
};

// One read at a time, so each answer carries a count one higher than the one before.
let reads = Promise.resolve();
const refresh = () => {
  reads = reads.then(readNativeDiagnostics).then(show);
};

document.getElementById('native-diagnostics-read').addEventListener('click', refresh);
refresh();
