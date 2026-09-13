import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoots = [
  'src/app/mindroom/cross-room-threads',
  'src/app/pages/client/threads',
  'src/app/pages/client/sidebar/ThreadsTab.tsx',
  'src/app/hooks/router/useThreadsSelected.ts',
  'src/app/pages/MobileFriendly.tsx',
];

const readSources = (): Map<string, string> => {
  const sources = new Map<string, string>();

  const visit = (path: string) => {
    if (path.includes('/__tests__/')) return;
    const absolutePath = resolve(process.cwd(), path);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      readdirSync(absolutePath).forEach((child) => visit(join(path, child)));
      return;
    }
    if (!/\.(ts|tsx)$/.test(path)) return;
    sources.set(relative(process.cwd(), absolutePath), readFileSync(absolutePath, 'utf8'));
  };

  sourceRoots.forEach(visit);
  return sources;
};

describe('cross-room Threads architecture', () => {
  it('does not introduce PWA reload or browser lifecycle hazards', () => {
    const combined = Array.from(readSources().values()).join('\n');

    expect(combined).not.toContain('window.location.reload');
    expect(combined).not.toContain('pagehide');
    expect(combined).not.toContain('beforeunload');
    expect(combined).not.toContain('unload');
    expect(combined).not.toContain('serviceWorker');
    expect(combined).not.toContain('service-worker');
    expect(combined).not.toContain('type="file"');
    expect(combined).not.toContain("type='file'");
    expect(combined).not.toContain('MindroomBackRouteHandler');
    expect(combined).not.toContain('blockStandaloneWebApp');
  });

  it('keeps row rendering on the pure compact-card view model path', () => {
    const rowSource = readFileSync(
      resolve(process.cwd(), 'src/app/pages/client/threads/ThreadsViewRow.tsx'),
      'utf8'
    );

    expect(rowSource).toContain('buildCompactThreadCardViewModelFromRecord');
    expect(rowSource).not.toContain('useCompactThreadCardViewModels');
    expect(rowSource).toContain('navigateRoomThread(entry.roomId, entry.threadRootId)');
    expect(rowSource).not.toContain('navigateRoom(');
  });

  it('keeps free-text filtering scoped to the precomputed entry haystack', () => {
    const pipelineSource = readFileSync(
      resolve(
        process.cwd(),
        'src/app/mindroom/cross-room-threads/crossRoomThreadFilterPipeline.ts'
      ),
      'utf8'
    );

    expect(pipelineSource).toContain('entry.searchableText.includes');
    expect(pipelineSource).not.toContain('reply');
    expect(pipelineSource).not.toContain('body');
  });
});
