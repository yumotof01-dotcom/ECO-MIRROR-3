import { useEffect, useRef, useState } from 'react';
import { canPlace, footprint, PARK_BUDGET } from './design.ts';
import { SIZE, type Point } from './geometry.ts';
import type { PointResult } from './analysis.ts';

export interface CitySnapshot {
  point: Point;
  classes: Uint8Array;
  baseline: PointResult;
  sha256: string;
  tiles: string[];
  crs: string;
}

type Note = { index: number; text: string };
const attribution = '© ESA WorldCover project 2021 / Copernicus Sentinel data (2021) / CC BY 4.0';
const coordinates = ({ lat, lon }: Point) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
const pc = (value: number) => value.toPrecision(5);
const colours: Record<number, string> = { 10: '#33674c', 20: '#67874c', 30: '#8ba761', 40: '#a9a466',
  50: '#ded4c9', 60: '#e9dfca', 70: '#f1f3f4', 80: '#81aabf', 90: '#5c927b', 95: '#286e55', 100: '#b6bb78' };

function paint(canvas: HTMLCanvasElement, classes: Uint8Array, parks: number[] = [], gaps?: Int16Array | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const added = new Set(parks.flatMap(footprint));
  for (let i = 0; i < classes.length; i++) {
    const distance = gaps?.[i] ?? 0;
    ctx.fillStyle = added.has(i) ? '#125db0' : distance === -1 ? '#702819' : distance >= 30 ? '#b34425' :
      distance >= 15 ? '#dc8b4c' : colours[classes[i]!] ?? '#b8bec0';
    ctx.fillRect(i % SIZE, Math.floor(i / SIZE), 1, 1);
  }
}

function CityMap({ city }: { city: CitySnapshot }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (canvas.current) paint(canvas.current, city.classes); }, [city]);
  return <figure><canvas ref={canvas} width={SIZE} height={SIZE} role="img" aria-label="元の土地被覆図" />
    <figcaption>{coordinates(city.point)}<br />植生 {city.baseline.area.toLocaleString('ja-JP')}㎡ · PC {pc(city.baseline.pc)}</figcaption>
  </figure>;
}

export default function CityLab({ city, reference, onReference }: {
  city: CitySnapshot; reference: CitySnapshot | null; onReference: (city: CitySnapshot) => void;
}) {
  const [plans, setPlans] = useState<[number[], number[]]>([[], []]);
  const [active, setActive] = useState<0 | 1>(0);
  const [view, setView] = useState({ x: 0, y: 0, size: SIZE });
  const [cursor, setCursor] = useState(100 * SIZE + 100);
  const [mode, setMode] = useState<'park' | 'note' | 'focus'>('park');
  const [gapMode, setGapMode] = useState(false);
  const [result, setResult] = useState<{ values: PointResult[]; gaps: Int16Array | null } | null>(null);
  const [status, setStatus] = useState('建造物や裸地のマスに、20m×20mの緑地を置けます。');
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('');
  const storageKey = `eco-observations:${coordinates(city.point)}:${city.sha256}`;
  const [notes, setNotes] = useState<Note[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      return Array.isArray(stored) ? stored.filter(n => Number.isInteger(n?.index) && n.index >= 0 &&
        n.index < SIZE * SIZE && typeof n.text === 'string').slice(0, 30) : [];
    } catch { return []; }
  });
  const map = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const worker = new Worker(new URL('./design.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.error) setStatus(data.error);
      else setResult(data);
    };
    worker.onerror = () => setStatus('街づくりの計算に失敗しました。配置を確認してください。');
    worker.postMessage({ classes: city.classes, parks: plans, gaps: gapMode });
    return () => worker.terminate();
  }, [city.classes, plans, gapMode]);

  useEffect(() => {
    const canvas = map.current;
    const context = canvas?.getContext('2d');
    if (!context || !canvas) return;
    const raster = document.createElement('canvas');
    raster.width = SIZE;
    raster.height = SIZE;
    paint(raster, city.classes, plans[active], gapMode ? result?.gaps : null);
    context.imageSmoothingEnabled = false;
    context.drawImage(raster, view.x, view.y, view.size, view.size, 0, 0, canvas.width, canvas.height);
  }, [active, city.classes, gapMode, plans, result, view]);

  function focusView(size: number, index: number) {
    const clamp = (value: number) => Math.max(0, Math.min(SIZE - size, value));
    setView({ size, x: clamp(index % SIZE - size / 2), y: clamp(Math.floor(index / SIZE) - size / 2) });
  }

  function overlayPosition(index: number) {
    const x = index % SIZE - view.x;
    const y = Math.floor(index / SIZE) - view.y;
    return { left: `${(x + .5) / view.size * 100}%`, top: `${(y + .5) / view.size * 100}%`,
      visibility: x >= 0 && y >= 0 && x < view.size && y < view.size ? 'visible' as const : 'hidden' as const };
  }

  function changePlan(next: number[]) {
    setResult(null);
    setPlans(active === 0 ? [next, plans[1]] : [plans[0], next]);
  }

  function place(index: number) {
    setCursor(index);
    if (mode === 'focus') { focusView(view.size, index); return; }
    if (mode === 'note') { setStatus('観察する場所を選びました。下にメモを入力してください。'); return; }
    const existing = plans[active].find(start => footprint(start).includes(index));
    if (existing !== undefined) { changePlan(plans[active].filter(start => start !== existing)); return; }
    if (plans[active].length >= PARK_BUDGET) { setStatus('この案は予算を使い切りました。青い緑地を押すと取り消せます。'); return; }
    if (!canPlace(city.classes, plans[active], index)) {
      setStatus('枠内に収まる、建造物・裸地の2×2マスを選んでください。');
      return;
    }
    changePlan([...plans[active], index]);
    setStatus('400㎡の緑地を追加しました。');
  }

  function storeNotes(next: Note[]) {
    setNotes(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setStatus('メモはこの画面に保持しています。端末への保存に失敗しました。'); }
  }

  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPlan() {
    download(new Blob([JSON.stringify({
      schema: 'eco-mirror-design-v1', point: city.point, sha256: city.sha256,
      crs: city.crs, tiles: city.tiles, parks: plans[active]
    })], { type: 'application/json' }), 'eco-mirror-plan.json');
  }

  async function importPlan(file: File) {
    try {
      if (file.size > 10000) throw new Error();
      const saved = JSON.parse(await file.text());
      if (saved.schema !== 'eco-mirror-design-v1' || saved.sha256 !== city.sha256 ||
          saved.point?.lat !== city.point.lat || saved.point?.lon !== city.point.lon ||
          !Array.isArray(saved.parks) || saved.parks.length > PARK_BUDGET ||
          saved.parks.some((index: number, i: number) => !canPlace(city.classes, saved.parks.slice(0, i), index))) throw new Error();
      changePlan(saved.parks);
      setStatus('選択中の案に、共有された配置を読み込みました。');
    } catch { setStatus('この案を読み込めません。元の調査地点とファイルを確認してください。'); }
  }

  function share() {
    if (!result) return;
    const output = document.createElement('canvas');
    output.width = 960; output.height = 630;
    const ctx = output.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#f7f7ef'; ctx.fillRect(0, 0, 960, 630);
    ctx.fillStyle = '#20392e'; ctx.font = 'bold 26px sans-serif';
    ctx.fillText(title.trim() || 'ECO MIRROR · 緑地の配置案', 35, 46, 890);
    ctx.font = '16px sans-serif';
    ctx.fillText(`調査範囲 ${coordinates(city.point)} · 2km四方 · 2021年の土地被覆`, 35, 76);
    const raster = document.createElement('canvas');
    raster.width = SIZE; raster.height = SIZE;
    ctx.imageSmoothingEnabled = false;
    [[], ...plans].forEach((parks, i) => {
      const x = 35 + i * 305;
      paint(raster, city.classes, parks);
      ctx.drawImage(raster, x, 140, 280, 280);
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(['元の街', '案 A', '案 B'][i]!, x, 124);
      ctx.font = '16px sans-serif';
      const stats = i === 0 ? city.baseline : result.values[i - 1]!;
      ctx.fillText(`追加 ${parks.length * 400}㎡ · PC ${pc(stats.pc)}`, x, 451, 280);
    });
    ctx.font = '15px sans-serif';
    ctx.fillText('青＝追加した緑地 ／ モデル上の試算（4近傍・λ200m）', 35, 495);
    ctx.fillText(attribution, 35, 530, 890);
    ctx.font = '12px monospace';
    ctx.fillText(`土地被覆SHA-256 ${city.sha256}`, 35, 561, 890);
    output.toBlob(blob => {
      if (blob) download(blob, 'eco-mirror-city-design.png');
    });
  }

  return <section className="city-lab" aria-label="街づくり実験室">
    <h2>街づくり実験室</h2>
    <p>2km四方の街で緑地をつくり、同じ予算で別の配置を試せます。</p>
    <div className="point-actions">
      <button type="button" aria-pressed={active === 0} onClick={() => setActive(0)}>案 A</button>
      <button type="button" aria-pressed={active === 1} onClick={() => setActive(1)}>案 B</button>
      <button type="button" aria-pressed={mode === 'note'} onClick={() => setMode(mode === 'note' ? 'park' : 'note')}>観察ピン</button>
      <label><input type="checkbox" checked={gapMode} onChange={event => {
        setGapMode(event.target.checked); setResult(null);
      }} /> 緑地から離れた場所を表示</label>
    </div>
    <p>この案の残り予算 <strong>{(PARK_BUDGET - plans[active].length) * 400}㎡</strong> ／ 1,200㎡</p>
    <div className="point-actions" aria-label="配置地図の拡大">
      {[200, 100, 50, 20].map(size => <button key={size} type="button" aria-pressed={view.size === size}
        onClick={() => focusView(size, cursor)}>{size === SIZE ? '全体' : `${SIZE / size}倍`}</button>)}
      <button type="button" aria-pressed={mode === 'focus'} onClick={() => setMode(mode === 'focus' ? 'park' : 'focus')}>見る場所を移動</button>
      <span>表示範囲 {view.size * 10}m四方</span>
    </div>
    <p>「見る場所を移動」を選んで地図を押すと、その場所を中心に表示できます。</p>
    <div className="city-map-wrap">
      <canvas ref={map} width={SIZE} height={SIZE} tabIndex={0} role="button"
        aria-label={mode === 'park' ? '配置地図。矢印キーで位置を選び、Enterで緑地を追加または削除' : mode === 'note' ? '観察地図。矢印キーで位置を選び、Enterで観察地点を選択' : '地図の中心を選択。矢印キーで移動し、Enterで中心を変更'}
        onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = Math.max(0, Math.min(view.size - 1, Math.floor((event.clientX - rect.left) / rect.width * view.size)));
          const y = Math.max(0, Math.min(view.size - 1, Math.floor((event.clientY - rect.top) / rect.height * view.size)));
          place((view.y + y) * SIZE + view.x + x);
        }}
        onKeyDown={event => {
          const moves: Record<string, number> = { ArrowUp: -SIZE, ArrowDown: SIZE, ArrowLeft: -1, ArrowRight: 1 };
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); place(cursor); }
          else if (event.key in moves) {
            event.preventDefault();
            const step = event.shiftKey ? 10 : 1;
            const next = Math.max(0, Math.min(SIZE * SIZE - 1, cursor + moves[event.key]! * step));
            setCursor(next);
            if (overlayPosition(next).visibility === 'hidden') focusView(view.size, next);
          }
        }} />
      <span className="city-crosshair" style={overlayPosition(cursor)} aria-hidden="true">+</span>
      {notes.map((entry, i) => <span key={i} className="city-pin" style={overlayPosition(entry.index)} aria-hidden="true">{i + 1}</span>)}
    </div>
    <p>青＝追加した緑地。地図で押すと配置、青い場所を押すと取り消し。</p>
    {gapMode && <p>橙＝元の植生から150m以上、赤茶＝300m以上。縦横に移動する格子上の距離です。植生がない範囲は赤茶で表示します。</p>}
    <p role="status">{status}</p>
    {mode === 'note' && <form onSubmit={event => {
      event.preventDefault();
      if (!note.trim() || notes.length >= 30) return;
      storeNotes([...notes, { index: cursor, text: note.trim() }]); setNote('');
    }}>
      <label>選んだ地点の観察メモ <input value={note} maxLength={100} onChange={event => setNote(event.target.value)} /></label>
      <button disabled={!note.trim() || notes.length >= 30}>ピンを記録</button>
    </form>}
    {notes.length > 0 && <ol>{notes.map((entry, i) => <li key={i}>{entry.text} <button type="button" onClick={() => storeNotes(notes.filter((_, index) => index !== i))}>削除</button></li>)}</ol>}
    {result ? <table className="city-compare"><caption>同じ予算で配置を比較</caption>
      <thead><tr><th>項目</th><th>元の街</th><th>案 A</th><th>案 B</th></tr></thead>
      <tbody>
        <tr><th>追加面積</th><td>0㎡</td>{plans.map((parks, i) => <td key={i}>{parks.length * 400}㎡</td>)}</tr>
        <tr><th>つながり（PC）</th>{[city.baseline, ...result.values].map((value, i) => <td key={i}>{pc(value.pc)}</td>)}</tr>
        <tr><th>植生のまとまり</th>{[city.baseline, ...result.values].map((value, i) => <td key={i}>{value.patches}</td>)}</tr>
      </tbody></table> : <p>配置結果を計算中…</p>}
    <div className="point-actions">
      <label>画像に載せる設計意図 <input maxLength={50} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <button type="button" disabled={!result} onClick={share}>比較画像を保存</button>
    </div>
    <details><summary>友達の案と比べる</summary>
      <p>同じ調査地点を開き、空いている案を選んでファイルを読み込んでください。読み込むと選択中の案が置き換わります。</p>
      <button type="button" onClick={exportPlan}>この案をファイルに保存</button>
      <label>選択中の案へ読み込む <input type="file" accept=".json,application/json" onChange={event => {
        const file = event.target.files?.[0];
        if (file) void importPlan(file);
        event.target.value = '';
      }} /></label>
    </details>
    <h3>別の街と比べる</h3>
    <button type="button" onClick={() => onReference(city)}>この街を比較用に残す</button>
    {reference && <p>比較元 {coordinates(reference.point)}。別の場所を地図で選び「緑地を調べる」と並べて表示します。</p>}
    {reference && (reference.point.lat !== city.point.lat || reference.point.lon !== city.point.lon) && <div className="city-places"><CityMap city={reference} /><CityMap city={city} /></div>}
  </section>;
}
