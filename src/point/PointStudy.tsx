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

function LandCover({ crop, removed, title }: { crop: Crop; removed?: Uint8Array; title: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const counts = new Map<number, number>();
  for (const code of crop.classes) counts.set(code, (counts.get(code) ?? 0) + 1);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    for (let index = 0; index < crop.classes.length; index++) {
      context.fillStyle = removed?.[index] ? '#a13919' : (colours.get(crop.classes[index]!) ?? '#454c54');
      context.fillRect(index % SIZE, Math.floor(index / SIZE), 1, 1);
    }
  }, [crop, removed]);
  return <figure className="point-landcover">
    <strong>{title}</strong>
    <canvas ref={canvas} width={SIZE} height={SIZE} role="img" aria-label={removed ? "減少を想定した地図。赤茶色が取り除いた部分。" : "2021年の元の地図。分類ごとの面積は凡例に表示。"} />
    <figcaption>北が上 · 2km四方 · 10m格子</figcaption>
    {removed ? <p><span className="point-swatch point-removed" aria-hidden="true" />取り除いた植生</p> : <details open><summary>元の地図の色と面積</summary>
      <ul>{CLASS_LABELS.filter(([code]) => counts.has(code)).map(([code, label, colour]) =>
        <li key={code}><span className="point-swatch" style={{ backgroundColor: colour }} aria-hidden="true" />
          {label} {format.format(counts.get(code)! * 100)} m²</li>)}
        {crop.missing > 0 && <li>欠測・範囲外 {format.format(crop.missing * 100)} m²</li>}
      </ul>
    </details>}
  </figure>;
}

export default function PointStudy() {
  const [point, setPoint] = useState<Point | null>(null);
  const [coordinates, setCoordinates] = useState({ lat: '', lon: '' });
  const [status, setStatus] = useState('地図を押して、調べる範囲の中心を選んでください。');
  const [crop, setCrop] = useState<Crop | null>(null);
  const [results, setResults] = useState<PointResult[]>([]);
  const [resultPoint, setResultPoint] = useState<Point | null>(null);
  const [masks, setMasks] = useState<Record<string, Uint8Array>>({});
  const [baseline, setBaseline] = useState<PointResult | null>(null);
  const [condition, setCondition] = useState(BASELINE);
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  const resultsPanel = useRef<HTMLElement>(null);

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
    setBusy(false);
    setStatus('調査範囲を確認して「緑地を調べる」を押してください。');
  }

  function enterCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    pick({ lat: Number(coordinates.lat), lon: Number(coordinates.lon) });
  }

  function run(all: boolean) {
    if (!point) return;
    if (!navigator.onLine) { setStatus('オフラインです。接続を戻してから、もう一度押してください。'); return; }
    stop();
    setBusy(true); setCrop(null); setBaseline(null); setResults([]); setMasks({}); setCondition(BASELINE);
    setResultPoint(point);
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
          setStatus(data.missing ? `欠測・範囲外のマスが${format.format(data.missing)}個あります。` : '元の緑地のつながりを計算中…');
          break;
        case 'baseline':
          setBaseline(data.result);
          break;
        case 'progress':
          setStatus(`緑地の減り方を試しています（${Math.round(data.done / 42 * 100)}%）`);
          break;
        case 'complete':
          setResults(data.results); setMasks(data.masks ?? {});
          if (data.results.length) finish(data.results.length > 1 ? '440条件の計算が完了しました。' : '元の緑地を確認できました。');
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

  const before = shown && (results.find(row => row.lossPercent === 0 && row.neighbourhood === shown.neighbourhood &&
    row.lambdaMetres === shown.lambdaMetres) ?? baseline);
  const removed = shown && masks[`${shown.pattern}-${shown.lossPercent}`];
  const samePoint = point && resultPoint && point.lat === resultPoint.lat && point.lon === resultPoint.lon;
  const trend = shown && before ? shown.pc < before.pc - 1e-12 ? '弱まりました' :
    shown.pc > before.pc + 1e-12 ? '強まりました' : 'ほぼ同じでした' : '';
  const percent = before?.pc && shown ? ((shown.pc / before.pc - 1) * 100).toFixed(1) : null;

  function save() {
    if (!resultPoint || !crop || !baseline) return;
    const report = {
      schema: 'eco-mirror-point-v1', point: resultPoint, sideMetres: 2000, resolutionMetres: 10,
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
    <p>調べたい場所を地図で押すと、中心から2km四方の調査範囲が表示されます。</p>
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
      <button type="button" disabled={!point || busy} onClick={() => run(false)}>緑地を調べる</button>
      {samePoint && baseline && results.length <= 1 && !busy && <button type="button" onClick={() => run(true)}>緑地が減った場合を試す</button>}
      {busy && <button type="button" onClick={() => { stop(); setBusy(false); setStatus('解析を中止しました。'); }}>中止</button>}
    </div>
    <p role="status">{status}</p>
    {crop && <button type="button" onClick={() => {
      resultsPanel.current?.scrollIntoView({ block: 'start' });
      resultsPanel.current?.focus({ preventScroll: true });
    }}>結果へ移動</button>}
    {crop && <section ref={resultsPanel} tabIndex={-1} className="point-results" aria-label="解析結果">
      <div className="point-result-heading">
        <h2>{samePoint ? 'この範囲の結果' : '前に調べた範囲の結果'}</h2>
        {resultPoint && <p>中心 {resultPoint.lat.toFixed(5)}, {resultPoint.lon.toFixed(5)} · 2021年</p>}
        {!samePoint && resultPoint && <button type="button" onClick={() => pick(resultPoint)}>前の調査地点に戻る</button>}
        {shown && before && <p className="point-summary">{shown.lossPercent > 0
          ? `植生が約${shown.lossPercent}%減ると想定した場合、このモデルでは緑地のつながりが${trend}${shown.patches > before.patches && shown.area < before.area ? ' 残った植生は、より細かいまとまりに分かれました。' : ''}`
          : '元の地図で、植生として分類した場所の広さと、まとまりの数を確認できます。'}</p>}
      </div>
      {results.length > 1 && <div className="point-scenario">
        <label>植生が減る割合 <select value={condition.lossPercent} onChange={event => setCondition({ ...condition, lossPercent: Number(event.target.value) })}>
          {CONDITION_AXES.lossPercent.map(value => <option key={value} value={value}>{value}%</option>)}
        </select></label>
        <details><summary>詳しい計算条件</summary><fieldset className="point-controls">
          <legend>研究用の設定</legend>
          <label>離れた緑地をどこまでつながりとして見るか（λ・m）<select value={condition.lambdaMetres} onChange={event => setCondition({ ...condition, lambdaMetres: Number(event.target.value) })}>
            {CONDITION_AXES.lambdaMetres.map(value => <option key={value}>{value}</option>)}
          </select></label>
          <label>斜めに接するマス<select value={condition.neighbourhood} onChange={event => setCondition({ ...condition, neighbourhood: Number(event.target.value) as 4 | 8 })}>
            <option value={4}>別々に数える（4近傍）</option><option value={8}>つなげて数える（8近傍）</option>
          </select></label>
          <label>植生の減り方<select value={condition.pattern} onChange={event => setCondition({ ...condition, pattern: event.target.value as typeof condition.pattern })}>
            <option value="distributed">あちこちから減る</option><option value="edge_first">端から減る</option>
          </select></label>
        </fieldset></details>
      </div>}
      <div className="point-cover-pair">
        <LandCover crop={crop} title="元の地図" />
        {removed && <LandCover crop={crop} removed={removed} title="植生が減った場合の地図" />}
      </div>
      {shown && before && <div className="point-numbers">
        <table><caption>元の状態と選んだ条件の比較</caption>
          <thead><tr><th scope="col">見る項目</th><th scope="col">元の状態</th><th scope="col">選んだ条件</th></tr></thead>
          <tbody>
            <tr><th scope="row">植生の面積</th><td>{format.format(before.area)} ㎡</td><td>{format.format(shown.area)} ㎡</td></tr>
            <tr><th scope="row">分かれている植生のまとまり</th><td>{before.patches}</td><td>{shown.patches}</td></tr>
            <tr><th scope="row">緑地のつながり（PC）</th><td>{before.pc.toPrecision(6)}</td><td>{shown.pc.toPrecision(6)}{percent !== null && shown.lossPercent > 0 && `（${percent}%変化）`}</td></tr>
          </tbody>
        </table>
        <p>PCは、緑地が広いほど、また互いに近いほど大きくなるモデル上の指標です。</p>
        <button type="button" onClick={save}>結果と出典を保存（JSON）</button>
      </div>}
    </section>}
    <p className="point-source">土地被覆は2021年時点の分類です。PCは緑地の面積と重心間距離を用いた構造モデルの指標です。</p>
    <p className="point-source">© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium. <a href="https://doi.org/10.5281/zenodo.7254221">出典・CC BY 4.0</a></p>
  </main>;
}
