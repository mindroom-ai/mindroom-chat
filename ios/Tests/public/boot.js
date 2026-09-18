window.routingBootId = crypto.randomUUID();
document.querySelector('#app').append(` at ${location.pathname}`);

// Native UI tests read the real plugin, including after terminating the host.
const read = document.createElement('button');
read.textContent = 'Read native diagnostics';
read.style.cssText = 'position:fixed;top:8px;left:8px';
const result = document.createElement('button');
result.style.cssText = 'position:fixed;top:40px;left:8px;width:40px;height:24px;overflow:hidden';
const refresh = async () => {
  result.textContent = 'Reading native diagnostics';
  let snapshot;
  try {
    snapshot = window.Capacitor.isPluginAvailable('MindRoomDiagnostics')
      ? await window.Capacitor.nativePromise('MindRoomDiagnostics', 'read', {})
      : { status: 'unsupported', events: [] };
  } catch {
    snapshot = { status: 'unavailable', events: [] };
  }
  result.textContent = `Native diagnostics ${JSON.stringify({
    status: snapshot.status,
    currentSessionId: snapshot.currentSessionId,
    events: snapshot.events
      .filter(({ name }) => ['app.launch', 'scene.background', 'scene.active'].includes(name))
      .slice(-24)
      .map(({ name, sessionId, sequence }) => ({ name, sessionId, sequence })),
  })}`;
};
read.addEventListener('click', refresh);
document.body.append(read, result);
void refresh();
