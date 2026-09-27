import { execSync } from 'node:child_process';
import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __closeExistingMessagePorts?: () => number;
    __loseNetworkingProcess?: () => { ports: number; connections: number };
    __schedulerWakeupReplacements?: number;
  }
}

/**
 * WebKit hosts IndexedDB and brokers MessagePorts in its networking process.
 * When that process exits, existing ports stop delivering and every open
 * IndexedDB connection receives `error` then `close`. This helper reproduces
 * only that part in any browser; real WebKit also fails new IndexedDB opens
 * and reads existing Web Storage keys as null until the page reloads, which
 * `killWebKitNetworkProcess` exercises.
 */
const installNetworkingProcessLoss = () => {
  const NativeMessageChannel = window.MessageChannel;
  const channels: MessageChannel[] = [];
  function RecordedMessageChannel() {
    const channel = new NativeMessageChannel();
    channels.push(channel);
    return channel;
  }
  RecordedMessageChannel.prototype = NativeMessageChannel.prototype;
  window.MessageChannel = RecordedMessageChannel as unknown as typeof MessageChannel;

  const nativeOpen = IDBFactory.prototype.open;
  const connections: IDBDatabase[] = [];
  IDBFactory.prototype.open = function open(this: IDBFactory, ...args) {
    const request = nativeOpen.apply(this, args);
    request.addEventListener('success', () => connections.push(request.result));
    return request;
  } as IDBFactory['open'];

  window.__schedulerWakeupReplacements = 0;
  window.addEventListener('mindroom:scheduler-wakeup-replaced', () => {
    window.__schedulerWakeupReplacements = (window.__schedulerWakeupReplacements ?? 0) + 1;
  });
  window.__closeExistingMessagePorts = () => {
    const closed = channels.splice(0);
    closed.forEach((channel) => {
      channel.port1.close();
      channel.port2.close();
    });
    return closed.length;
  };
  window.__loseNetworkingProcess = () => {
    const ports = window.__closeExistingMessagePorts?.() ?? 0;
    const lost = connections.splice(0);
    lost.forEach((connection) => {
      connection.close();
      connection.dispatchEvent(new Event('error'));
      connection.dispatchEvent(new Event('close'));
    });
    return { ports, connections: lost.length };
  };
};

const findWebKitNetworkProcesses = (): number[] => {
  try {
    return execSync('ps -eo pid,comm', { encoding: 'utf8' })
      .split('\n')
      .filter((line) => /NetworkProce/.test(line))
      .map((line) => Number(line.trim().split(/\s+/)[0]))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
};

/** True when the test runs beside a WebKit networking process it can signal. */
export const canKillWebKitNetworkProcess = (): boolean => findWebKitNetworkProcesses().length > 0;

/** Kills WebKit's networking process; the page receives no event for the exit itself. */
export const killWebKitNetworkProcess = (): number => {
  const pids = findWebKitNetworkProcesses();
  pids.forEach((pid) => process.kill(pid, 'SIGKILL'));
  return pids.length;
};

export const recordNetworkingProcessResources = (page: Page) =>
  page.addInitScript(installNetworkingProcessLoss);
