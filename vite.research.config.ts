import { defineConfig } from 'vite';

// A separately built integration boundary verifies worker emission without changing the public app.
export default defineConfig({
  build:{outDir:'dist-research',lib:{entry:'src/research/index.ts',formats:['es'],fileName:'research'},
    emptyOutDir:true,copyPublicDir:false},
  worker:{format:'es'}
});
