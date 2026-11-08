import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PointMap } from './PointMap.tsx';
import { SIZE, type Point } from './geometry.ts';
import { BASELINE, type PointResult } from './analysis.ts';
import type { PointMessage, PointRequest } from './point.worker.ts';
import { CONDITION_AXES } from '../research/conditions.ts';

type Crop = Extract<PointMessage, { type: 'crop' }>;
const CLASS_LABELS = [
  [10, '樹木', '#195d43'], [20, '低木', '#8c6d25'], [30, '草地', '#8ca65a'],
  [40, '農地', '#daaf50'], [50, '建造物', '#b3756d'], [60, '裸地・疎植生', '#c8baaa'],
  [70, '雪氷', '#eef7fd'], [80, '水域', '#427caa'], [90, '草本湿地', '#50867e'],
  [95, 'マングローブ', '#3b7f6c'], [100, 'コケ・地衣類', '#b6be72']
] as const;
const colours = new Map<number, string>(CLASS_LABELS.map(([code, , colour]) => [code, colour]));
const format = new Intl.NumberFormat('ja-JP');

function LandCover({ crop }: { crop: Crop }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const counts = new Map<number, number>();
  for (const code of crop.classes) counts.set(code, (counts.get(code) ?? 0) + 1);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    for (let index = 0; index < crop.classes.length; index++) {
      context.fillStyle = colours.get(crop.classes[index]!) ?? '#454c54';
      context.fillRect(index % SIZE, Math.floor(index / SIZE), 1, 1);
    }
  }, [crop]);
  return <figure className="point-landcover">
    <canvas ref={canvas} width={SIZE} height={SIZE} role="img" aria-label="選択範囲の2021年土地被覆。分類ごとの面積は凡例に表示。" />
    <figcaption>北が上 · 2km四方 · 10m格子</figcaption>
    <details><summary>土地被覆の凡例と面積</summary>
      <ul>{CLASS_LABELS.filter(([code]) => counts.has(code)).map(([code, label, colour]) =>
        <li key={code}><span className="point-swatch" style={{ backgroundColor: colour }} aria-hidden="true" />
          {label} {format.format(counts.get(code)! * 100)} m²</li>)}
        {crop.missing > 0 && <li>欠測・範囲外 {format.format(crop.missing * 100)} m²</li>}
      </ul>
    </details>
  </figure>;
}

export default function PointStudy() {
  const [point, setPoint] = useState<Point | null>(null);
  const [coordinates, setCoordinates] = useState({ lat: '', lon: '' });
  const [status, setStatus] = useState('地図を押して、調べる範囲の中心を選んでください。');
  const [crop, setCrop] = useState<Crop | null>(null);
  const [results, setResults] = useState<PointResult[]>([]);
  const [baseline, setBaseline] = useState<PointResult | null>(null);
  const [condition, setCondition] = useState(BASELINE);
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);

  function stop() {
    worker.current?.terminate();
    worker.current = null;
  }
  useEffect(() => stop, []);

  function pick(next: Point) {
    stop();
    const selected = { lat: Number(next.lat.toFixed(6)), lon: Number(next.lon.toFixed(6)) };
    setPoint(selected);
    setCoordinates({ lat: String(selected.lat), lon: String(selected.lon) });
    setCrop(null); setBaseline(null); setResults([]); setBusy(false); setCondition(BASELINE);
    setStatus('選択した範囲を確認して「解析する」を押してください。');
  }

  function enterCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    pick({ lat: Number(coordinates.lat), lon: Number(coordinates.lon) });
  }

  function run(all: boolean) {
    if (!point) return;
    stop();
    setBusy(true); setCrop(null); setBaseline(null); setResults([]); setCondition(BASELINE);
    setStatus('選んだ範囲の土地被覆データを取得中…');
    const task = new Worker(new URL('./point.worker.ts', import.meta.url), { type: 'module' });
    worker.current = task;
    function finish(message: string) {
      stop(); setBusy(false); setStatus(message);
    }
    task.onmessage = ({ data }: MessageEvent<PointMessage>) => {
      if (worker.current !== task) return;
      switch (data.type) {
        case 'crop':
          setCrop(data);
          setStatus(data.missing ? `欠測・範囲外のマスが${format.format(data.missing)}個あります。` : '基準のPCを計算中…');
          break;
        case 'baseline':
          setBaseline(data.result);
          break;
        case 'progress':
          setStatus(`440条件を計算中 · 地図条件 ${data.done}/42`);
          break;
        case 'complete':
          setResults(data.results);
          if (data.results.length) finish(`${data.results.length}条件の計算が完了しました。`);
          else { stop(); setBusy(false); }
          break;
        case 'error':
          finish(data.message);
          break;
      }
    };
    task.onerror = () => {
      if (worker.current === task) finish('解析処理が停止しました。もう一度お試しください。');
    };
    const request: PointRequest = { point, endpoint: new URL('/api/worldcover', location.origin).href, all };
    task.postMessage(request);
  }

  const shown = results.find(row => row.lambdaMetres === condition.lambdaMetres && row.neighbourhood === condition.neighbourhood &&
    row.lossPercent === condition.lossPercent && row.pattern === condition.pattern) ?? baseline;

  function save() {
    if (!point || !crop || !baseline) return;
    const report = {
      schema: 'eco-mirror-point-v1', point, sideMetres: 2000, resolutionMetres: 10,
      source: 'ESA WorldCover 2021 v200', license: 'CC BY 4.0', sourceTiles: crop.tiles,
      crs: crop.crs, classRasterSha256: crop.sha256, missingCells: crop.missing,
      model: 'centroid-distance-exponential-v1', baseline,
      conditions: results.length ? results : [baseline]
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'eco-mirror-point.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main id="main-content" className="point-study">
    <Link to="/explore">登録済みの研究地域へ</Link>
    <h1>地図から調べる</h1>
    <p>地図を移動・拡大し、調べたい場所を押してください。枠はその地点を中心とした2km四方です。</p>
    <PointMap point={point} onPick={pick} />
    <details>
      <summary>座標を入力する</summary>
      <form className="point-controls" onSubmit={enterCoordinates}>
        <label>緯度<input required type="number" min="-90" max="90" step="any" value={coordinates.lat} onChange={event => setCoordinates({ ...coordinates, lat: event.target.value })} /></label>
        <label>経度<input required type="number" min="-180" max="180" step="any" value={coordinates.lon} onChange={event => setCoordinates({ ...coordinates, lon: event.target.value })} /></label>
        <button type="submit">この座標を選ぶ</button>
      </form>
    </details>
    {point && <p>選択地点 <strong>{point.lat.toFixed(6)}, {point.lon.toFixed(6)}</strong></p>}
    <div className="point-actions">
      <button type="button" disabled={!point || busy} onClick={() => run(false)}>解析する</button>
      <button type="button" disabled={!point || busy} onClick={() => run(true)}>440条件を計算する</button>
      {busy && <button type="button" onClick={() => { stop(); setBusy(false); setStatus('解析を中止しました。'); }}>中止</button>}
    </div>
    <p role="status">{status}</p>
    {crop && <section className="point-results" aria-label="解析結果">
      <LandCover crop={crop} />
      <div>
        {results.length > 1 && <fieldset className="point-controls">
          <legend>表示する条件</legend>
          <label>仮説λ（m）<select value={condition.lambdaMetres} onChange={event => setCondition({ ...condition, lambdaMetres: Number(event.target.value) })}>
            {CONDITION_AXES.lambdaMetres.map(value => <option key={value}>{value}</option>)}
          </select></label>
          <label>近傍<select value={condition.neighbourhood} onChange={event => setCondition({ ...condition, neighbourhood: Number(event.target.value) as 4 | 8 })}>
            <option value={4}>4近傍</option><option value={8}>8近傍</option>
          </select></label>
          <label>除去規則<select value={condition.pattern} onChange={event => setCondition({ ...condition, pattern: event.target.value as typeof condition.pattern })}>
            <option value="distributed">分散除去</option><option value="edge_first">縁から除去</option>
          </select></label>
          <label>仮想除去率<select value={condition.lossPercent} onChange={event => setCondition({ ...condition, lossPercent: Number(event.target.value) })}>
            {CONDITION_AXES.lossPercent.map(value => <option key={value} value={value}>{value}%</option>)}
          </select></label>
        </fieldset>}
        {shown && <><dl className="point-metrics">
          <div><dt>構造的PC</dt><dd>{shown.pc.toPrecision(6)}</dd></div>
          <div><dt>植生候補面積</dt><dd>{format.format(shown.area)} m²</dd></div>
          <div><dt>緑地のまとまり</dt><dd>{format.format(shown.patches)}</dd></div>
        </dl>
        <p>同じ近傍・λの除去率0%からのPC差 {(() => {
          const before = results.find(row => row.lossPercent === 0 && row.neighbourhood === shown.neighbourhood && row.lambdaMetres === shown.lambdaMetres);
          return (shown.pc - (before ?? baseline!).pc).toPrecision(6);
        })()}</p>
        <button type="button" onClick={save}>出典付きJSONを保存</button></>}
      </div>
    </section>}
    <p className="point-source">土地被覆は2021年時点の分類です。PCは緑地の面積と重心間距離を用いた構造モデルの指標です。</p>
    <p className="point-source">© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium. <a href="https://doi.org/10.5281/zenodo.7254221">出典・CC BY 4.0</a></p>
  </main>;
}
