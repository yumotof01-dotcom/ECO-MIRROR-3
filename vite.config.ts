import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { env } from 'node:process';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { forwardWorldCover } from './server/worldcover.mjs';

async function worldCoverMiddleware(req: IncomingMessage, res: ServerResponse) {
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const request = new Request(new URL(req.url ?? '/', 'http://localhost'), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    signal: controller.signal
  });
  const response = await forwardWorldCover(request);
  if (res.destroyed) return;
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) { res.end(); return; }
  Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    .on('error', () => res.destroy()).pipe(res);
}


export default defineConfig({
  // GitHub Pages serves project repositories under /<repository>/, not the domain root.
  // Keep localhost and isolated test builds on / so development URLs remain predictable.
  base: env.GITHUB_PAGES_DEPLOY === 'true' ? '/ECO-MIRROR-3/' : '/',
  plugins: [react(), {
    name: 'eco-worldcover-range',
    configureServer(server) {
      server.middlewares.use('/api/worldcover', worldCoverMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/worldcover', worldCoverMiddleware);
    }
  }],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true
  }
});
