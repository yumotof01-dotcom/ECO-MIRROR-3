import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResearchView } from './ResearchView.tsx';
import { computeMapFrame, mapInput } from './research/mapData.ts';

vi.mock('./research/mapWorkerClient.ts', () => ({
  prepareResearchMap: vi.fn(async (study, selection) => computeMapFrame(mapInput(study, selection)))
}));

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', async (input: string) => {
    const path = new URL(String(input), 'http://fixture.invalid').pathname;
    return new Response(await readFile(resolve('public', '.' + path)));
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: vi.fn()
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('keeps the selected candidate when research conditions change', async () => {
  render(<ResearchView region="shinjuku" mode="bridge" />);
  fireEvent.click(screen.getByRole('button', { name: '地域データを読み込む' }));
  await screen.findByText('候補の計算結果を検証しました。', {}, { timeout: 10000 });
  const picker = screen.getByLabelText('追加候補・参照地点') as HTMLSelectElement;
  const selected = picker.options[1]!.value;
  fireEvent.change(picker, { target: { value: selected } });
  await screen.findByText('候補の計算結果を検証しました。');
  fireEvent.change(screen.getByLabelText('仮説λ（m）'), { target: { value: '300' } });
  await screen.findByText('候補の計算結果を検証しました。', {}, { timeout: 10000 });
  expect(screen.getByLabelText('追加候補・参照地点')).toHaveValue(selected);
});

it('clears old results when a region view is replaced', async () => {
  const view = render(<ResearchView key="shinjuku" region="shinjuku" mode="scenario" />);
  fireEvent.click(screen.getByRole('button', { name: '地域データを読み込む' }));
  await screen.findByText('地図の準備ができました。', {}, { timeout: 10000 });
  expect(screen.getByRole('img')).toBeInTheDocument();
  view.rerender(<ResearchView key="odaiba" region="odaiba" mode="scenario" />);
  await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument());
  expect(screen.queryByText('構造的PC')).not.toBeInTheDocument();
});
