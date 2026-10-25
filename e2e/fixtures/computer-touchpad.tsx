import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { configClass, varsClass } from 'folds';
import 'folds/dist/style.css';
import '../../src/index.css';
import { lightTheme } from '../../src/colors.css';
import { ComputerScreen } from '../../src/app/mindroom/computer/ComputerScreen';

const params = new URLSearchParams(window.location.search);
const initialMode = params.get('mode') === 'control' ? 'control' : 'view';
document.documentElement.className = `${configClass} ${varsClass} ${lightTheme}`;

// noVNC accepts a socket only if `send`, `close`, `binaryType` and the `on*` handlers are on
// the socket itself or on its own prototype. Playwright's routed WebSocket is a subclass of
// its mock, which has them one prototype further up, so they are copied down. A real
// WebSocket has them on WebSocket.prototype and is left alone.
const socketPrototype = window.WebSocket.prototype;
const mockPrototype: object = Object.getPrototypeOf(socketPrototype);
if (mockPrototype !== EventTarget.prototype) {
  Object.getOwnPropertyNames(mockPrototype).forEach((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(mockPrototype, name);
    if (descriptor && !Object.prototype.hasOwnProperty.call(socketPrototype, name)) {
      Object.defineProperty(socketPrototype, name, descriptor);
    }
  });
}

function Fixture() {
  const [status, setStatus] = useState('Connecting');
  const [mode, setMode] = useState<'view' | 'control'>(initialMode);
  // Lets a test change the mode on the open stream, as Take control and Resume agent do.
  useEffect(() => {
    Object.assign(window, { setComputerMode: setMode });
  }, []);
  return (
    <main style={{ display: 'grid', gap: 12, padding: 12 }}>
      <output>{status}</output>
      <div style={{ width: 'min(400px, 100%)', height: 250, background: '#111' }}>
        <ComputerScreen
          mode={mode}
          onConnected={() => setStatus('Connected')}
          onDisconnected={(message) => setStatus(`Disconnected ${message ?? ''}`.trim())}
          protocols={['binary', 'mindroom-ticket.test']}
          url={`ws://${window.location.host}/rfb-stub`}
        />
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
