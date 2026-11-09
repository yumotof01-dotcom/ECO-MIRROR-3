import { evaluateDesign, gapDistances } from './design.ts';

self.onmessage = ({ data }: MessageEvent<{ classes: Uint8Array; parks: [number[], number[]]; gaps: boolean }>) => {
  try {
    const values = data.parks.map(parks => evaluateDesign(data.classes, parks));
    const gaps = data.gaps ? gapDistances(data.classes) : null;
    self.postMessage({ values, gaps });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '計算に失敗しました。' });
  }
};
