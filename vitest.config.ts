import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/vitest.setup.ts'],
    include: [
      'src/**/*.test.ts',
      'src/app/pages/ConfigConfig.test.tsx',
      'src/app/components/invite-user-prompt/InviteUserAutocomplete.test.tsx',
      'src/app/components/invite-user-prompt/InviteUserPrompt.test.tsx',
      'src/app/components/message/content/AudioContent.test.tsx',
      'src/app/components/message/content/ImageContent.test.tsx',
      'src/app/features/room-nav/SortableRoomNavItem.test.tsx',
      'src/app/mindroom/native/useEdgeSwipeBack.test.tsx',
    ],
  },
});
