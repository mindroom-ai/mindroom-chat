import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/app/components/message/content/ImageContent.test.tsx',
      'src/app/hooks/useEdgeSwipeBack.test.tsx',
    ],
  },
});
