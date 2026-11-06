import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { env } from 'node:process';

export default defineConfig({
  // GitHub Pages serves project repositories under /<repository>/, not the domain root.
  // Keep localhost and isolated test builds on / so development URLs remain predictable.
  base: env.GITHUB_PAGES_DEPLOY === 'true' ? '/ECO-MIRROR-3/' : '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true
  }
});
