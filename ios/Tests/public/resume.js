// Test fixture only. A cold launch seeds storage; a recovered room URL must read
// the existing values, so reinitialization cannot mask lost session data.
const token = new URLSearchParams(location.search).get('resumeProbe');
const roomPath = '/!space%3Amindroom.chat/!room%3Amindroom.chat';
const status = document.createElement('button');
const check = document.createElement('button');
status.style.cssText = 'display:block;font-size:10px;max-width:100%;overflow-wrap:anywhere';
check.textContent = 'Check resume';
document.querySelector('#app').replaceChildren(check, status);
let checks = 0;

const db = await new Promise((resolve, reject) => {
  const request = indexedDB.open('background-resume-probe', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('session');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function storedToken(write) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('session', write ? 'readwrite' : 'readonly');
    const store = transaction.objectStore('session');
    const request = write ? store.put(token, 'token') : store.get('token');
    transaction.oncomplete = () => resolve(write ? token : request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

if (location.pathname === '/') {
  localStorage.setItem('background-resume-token', token);
  await storedToken(true);
  history.replaceState(
    {},
    '',
    `${roomPath}?resumeProbe=${token}&threadId=%24thread%3Amindroom.chat`
  );
}

async function report() {
  status.textContent = 'Checking resume';
  try {
    const plugins = await Promise.all(
      [
        ['MindRoomAuth', 'authenticate'],
        ['MindRoomFileSave', 'beginSave'],
      ].map(async ([plugin, method]) => {
        try {
          await window.Capacitor.nativePromise(plugin, method, {});
          return 'unexpected success';
        } catch (error) {
          return error.code;
        }
      })
    );
    status.textContent = `Probe ready ${JSON.stringify({
      bootId: window.routingBootId,
      checks: ++checks,
      path: location.pathname,
      threadId: new URLSearchParams(location.search).get('threadId'),
      visible: document.visibilityState === 'visible',
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      token,
      localToken: localStorage.getItem('background-resume-token'),
      databaseToken: await storedToken(false),
      plugins,
    })}`;
  } catch (error) {
    status.textContent = `Probe error ${error.message}`;
  }
}

check.addEventListener('click', report);
await report();
