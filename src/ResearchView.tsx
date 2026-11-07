import { useEffect, useRef, useState } from 'react';
import {
  CONDITION_AXES, ResearchSession, ResearchMapSession, conditionId, loadResearchSite,
  researchErrorMessage, createResearchSnapshot, serializeResearchSnapshot,
  type ResearchState, type ResearchMapState, type ResearchStudy, type MapFrame
} from './research/index.ts';
import type { RegionId } from './studies/verifiedStudyLoader.ts';
import type { ScenarioSettings } from './features/landscape/scenarios/engine.ts';

const INITIAL: ScenarioSettings = { pattern: 'distributed', neighbourhood: 4, lambdaMetres: 200, lossPercent: 0 };
const number = (value: number | null) => value === null ? '取得できません' : value.toLocaleString('ja-JP', { maximumSignificantDigits: 6 });
const DIAGNOSTICS = { LARGEST_DECLINE_ONLY: '最大低下区間', POTENTIAL_MODEL_ABRUPTNESS: 'モデル上の急低下候補', NO_DECLINE: '低下なし', UNDEFINED_BASELINE: '基準値を定義できません', INCOMPLETE_CURVE: '曲線データが不足' };
type Mode = 'connectivity' | 'scenario' | 'threshold' | 'bridge';

function ResearchMap({ frame }: { frame: MapFrame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(frame.width, frame.height);
    frame.displayMask.forEach((value, index) => {
      const color = value === 1 ? [47, 104, 73] : value === 2 ? [193, 112, 62] : [229, 230, 217];
      pixels.data.set([...color, 255], index * 4);
    });
    context.putImageData(pixels, 0, 0);
  }, [frame]);
  return <figure className="research-map">
    <canvas ref={canvas} width={frame.width} height={frame.height} role="img"
      aria-label={`北が上の2km四方の植生候補地図。残存面積${frame.vegetationAreaM2}平方メートル、仮想除去面積${frame.removedAreaM2}平方メートル。詳しい値は続く表。`} />
    <figcaption>↑ 北 · 2km × 2km · 1画素10m · {frame.crs}</figcaption>
    <table><caption>地図の凡例と面積</caption><thead><tr><th>分類</th><th>面積 m²</th></tr></thead><tbody>
      <tr><th><i className="map-swatch remaining" />残る植生候補（緑）</th><td>{number(frame.vegetationAreaM2)}</td></tr>
      <tr><th><i className="map-swatch removed" />仮想的に除く植生（橙）</th><td>{number(frame.removedAreaM2)}</td></tr>
      <tr><th><i className="map-swatch other" />元からその他の土地（淡灰）</th><td>{number(frame.otherAreaM2)}</td></tr>
      <tr><th>残る緑地パッチ数</th><td>{frame.patches.length}</td></tr>
    </tbody></table>
    <details><summary>元の土地被覆分類を確認する</summary><table><thead><tr><th>分類</th><th>面積 m²</th></tr></thead><tbody>
      {frame.sourceClassCounts.map(row => <tr key={row.code}><th>{row.label}</th><td>{number(row.areaM2)}</td></tr>)}
    </tbody></table></details>
  </figure>;
}

function Curve({ study, settings }: { study: ResearchStudy; settings: ScenarioSettings }) {
  const curve = study.curve(settings);
  const values = curve.points.map(point => point.pc);
  const complete = values.every((value): value is number => value !== null);
  const max = Math.max(...values.filter((value): value is number => value !== null), 0);
  const points = curve.points.map(point => `${40 + point.lossPercent * 8},${180 - (max > 0 && point.pc !== null ? point.pc / max * 150 : 0)}`).join(' ');
  return <section className="result-panel"><h2>仮想植生減少とPCの曲線</h2>
    {complete && <svg viewBox="0 0 480 220" role="img" aria-label="仮想除去率0〜50%に対する構造的PC。各値は下の表に記載。">
      <path d="M40 25V180H450" fill="none" stroke="currentColor" />
      <polyline points={points} fill="none" stroke="#25583f" strokeWidth="3" />
      <text x="40" y="205">0%</text><text x="410" y="205">50%</text><text x="40" y="18">PC 最大 {number(max)}</text>
    </svg>}
    <p>最大低下区間 {curve.diagnostic.maxDropFromPercent === null ? '定義できません' : `${curve.diagnostic.maxDropFromPercent}〜${curve.diagnostic.maxDropToPercent}%`}</p>
    <p>診断 {DIAGNOSTICS[curve.diagnostic.status]} · 非単調性 {curve.diagnostic.nonmonotonic === null ? '判定できません' : curve.diagnostic.nonmonotonic ? 'あり' : 'なし'}</p>
    {curve.diagnostic.warnings.map(warning => <p key={warning}>{warning === 'Largest decrease is a model interval, not proof of an ecological tipping point.' ? '最大低下区間はモデルの診断結果です。現地での生態学的な検証が必要です。' : warning}</p>)}
    <table><caption>同じ規則・近傍・λでの11条件</caption><thead><tr><th>仮想除去率</th><th>構造的PC</th></tr></thead><tbody>
      {curve.points.map(point => <tr key={point.scenarioId}><th>{point.lossPercent}%</th><td>{number(point.pc)}</td></tr>)}
    </tbody></table>
    <p>この曲線は構造モデルの感度分析です。現地の生態学的な閾値は未検証です。</p>
  </section>;
}

function Bridge({ study, settings }: { study: ResearchStudy; settings: ScenarioSettings }) {
  const [siteId, setSiteId] = useState(study.candidates[0]!.site.id);
  const [result, setResult] = useState<ReturnType<ResearchStudy['intervention']> | null>(null);
  const [status, setStatus] = useState('候補を読み込みます。');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    setResult(null); setLoading(true); setStatus('候補の計算結果を検証中…');
    loadResearchSite(study, siteId, { signal: abort.signal }).then(site => {
      if (abort.signal.aborted) return;
      setResult(study.intervention(site, settings)); setStatus('候補の計算結果を検証しました。');
    }).catch(error => { if (!abort.signal.aborted) setStatus(researchErrorMessage(error).message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [study, siteId, settings, retry]);
  return <section className="result-panel"><h2>400m²の仮想追加を調べる</h2>
    <label>追加候補・参照地点<select value={siteId} onChange={event => { setResult(null); setSiteId(event.target.value); }}>
      {study.candidates.map(({ site }) => <option key={site.id} value={site.id}>{site.role === 'hypothetical_connector' ? '候補' : '参照'} · {site.id}</option>)}
    </select></label>
    <p role="status">{status}</p>
    {loading ? <button onClick={() => { controller.current?.abort(); setLoading(false); setStatus('候補の読込を中止しました。'); }}>候補の読込を中止</button> : !result && <button onClick={() => setRetry(value => value + 1)}>候補を再読込</button>}
    {result && <><table><caption>選択条件での追加前後</caption><thead><tr><th>指標</th><th>値</th></tr></thead><tbody>
      <tr><th>PCの差</th><td>{number(result.result.deltaPc)}</td></tr>
      <tr><th>追加前のパッチ数</th><td>{result.result.beforePatchCount}</td></tr>
      <tr><th>追加後のパッチ数</th><td>{result.result.afterPatchCount}</td></tr>
      <tr><th>地図上の変化</th><td>{result.topology === 'patch_merger' ? 'パッチが結合' : result.topology === 'new_island' ? '新しい孤立パッチ' : 'パッチ数は同じ'}</td></tr>
      <tr><th>元の分類コード</th><td>{result.site.sourceClasses.join(' / ')}</td></tr>
    </tbody></table><p>位置は西から{result.site.x * 10}m、北から{result.site.y * 10}m。追加面積400m²。候補12地点・参照4地点の範囲で検討します。</p></>}
    <p>土地の利用権・施工可能性・実際の保全効果は未検証です。</p>
  </section>;
}

export function ResearchView({ region, mode }: { region: RegionId; mode: Mode }) {
  const [session] = useState(() => new ResearchSession());
  const [maps] = useState(() => new ResearchMapSession());
  const [state, setState] = useState<ResearchState>({ status: 'idle' });
  const [map, setMap] = useState<ResearchMapState>({ status: 'idle' });
  const [settings, setSettings] = useState<ScenarioSettings>(INITIAL);
  const [mapRetry, setMapRetry] = useState(0);
  const [saveStatus, setSaveStatus] = useState('');
  const saveController = useRef<AbortController | null>(null);
  const study = state.status === 'ready' ? state.study : null;
  useEffect(() => () => { session.clear(); maps.clear(); saveController.current?.abort(); }, [session, maps]);
  useEffect(() => {
    if (!study) return;
    let active = true;
    const request = maps.select(study, settings);
    setMap(maps.state);
    request.then(value => { if (active) setMap(value); });
    return () => { active = false; maps.cancel(); };
  }, [study, settings, maps, mapRetry]);
  function load() {
    const request = session.select(region);
    setState(session.state); setMap({ status: 'idle' });
    request.then(value => setState(value));
  }
  function change(next: ScenarioSettings) {
    maps.clear(); setMap({ status: 'idle' });
    saveController.current?.abort(); setSaveStatus(''); setSettings(next);
  }
  async function save() {
    if (!study) return;
    saveController.current?.abort();
    const controller = new AbortController(); saveController.current = controller;
    setSaveStatus('保存ファイルを作成中…');
    try {
      const snapshot = await createResearchSnapshot(study, { kind: 'condition', conditionId: conditionId(settings) }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([serializeResearchSnapshot(snapshot)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `eco-mirror-${region}-${conditionId(settings)}.json`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaveStatus('出典付きの条件結果を保存しました。');
    } catch (error) { if (!controller.signal.aborted) setSaveStatus(researchErrorMessage(error).message); }
  }
  const record = study?.condition(settings);
  const baseline = study?.condition({ ...settings, lossPercent: 0 });
  const comparison = study && record?.pc !== null && baseline?.pc !== null ? study.compare({ ...settings, lossPercent: 0 }, settings) : null;
  const mapReady = map.status === 'ready';
  return <section className="research-view" aria-label="研究ワークスペース">
    <div className="research-status" role="status">{state.status === 'idle' ? '地域データを読み込んで観察を始めます。' : state.status === 'loading' ? '出典とデータの整合性を検証中…' : state.status === 'error' ? researchErrorMessage(state.error).message : state.status === 'cancelled' ? '読込を中止しました。' : '2021年の研究データを検証しました。'}</div>
    {state.status === 'loading' ? <button onClick={() => { session.cancel(); setState(session.state); }}>読込を中止</button> : !study && <button className="glass-action" onClick={load}>地域データを読み込む</button>}
    {study && <>
      <fieldset className="research-controls"><legend>研究条件</legend>
        <label>仮説λ（m）<select value={settings.lambdaMetres} onChange={event => change({ ...settings, lambdaMetres: Number(event.target.value) })}>{CONDITION_AXES.lambdaMetres.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>近傍<select value={settings.neighbourhood} onChange={event => change({ ...settings, neighbourhood: Number(event.target.value) as 4 | 8 })}><option value={4}>4近傍</option><option value={8}>8近傍</option></select></label>
        <label>除去規則<select value={settings.pattern} onChange={event => change({ ...settings, pattern: event.target.value as ScenarioSettings['pattern'] })}><option value="distributed">分散除去</option><option value="edge_first">縁から除去</option></select></label>
        <label className="loss-control">仮想植生減少率 {settings.lossPercent}%<input aria-label="仮想植生減少率" type="range" min="0" max="50" step="5" value={settings.lossPercent} onChange={event => change({ ...settings, lossPercent: Number(event.target.value) })} /></label>
      </fieldset>
      <p className="research-caption">λは距離減衰の仮説パラメータです。元の植生候補に対する仮想除去率を変えて比較します。</p>
      <div role="status">{map.status === 'loading' ? '地図を作成中…' : map.status === 'error' ? researchErrorMessage(map.error).message : map.status === 'cancelled' ? '地図作成を中止しました。' : mapReady ? '地図の準備ができました。' : ''}</div>
      {map.status === 'loading' && <button onClick={() => { maps.cancel(); setMap(maps.state); }}>地図作成を中止</button>}
      {(map.status === 'error' || map.status === 'cancelled') && <button onClick={() => setMapRetry(value => value + 1)}>地図を再作成</button>}
      {mapReady && <div className="research-results"><ResearchMap frame={map.frame} />
        <div><section className="result-panel"><h2>構造的なつながり</h2>
          <dl className="research-metrics"><div><dt>構造的PC</dt><dd>{number(record!.pc)}</dd></div><div><dt>植生候補 m²</dt><dd>{number(record!.vegetationAreaM2)}</dd></div></dl>
          <p>画素数に基づく実除去率 {number(record!.actualLossPercent)}%</p>
          {mode === 'scenario' && comparison && <><p>比較基準は同じ規則・近傍・λでの除去率0%。変更軸は仮想除去率です。</p><p>基準PC {number(baseline!.pc)} · PCの差 {number(comparison.deltaPc)}</p><p>相対変化 {comparison.relativeChange === null ? '基準PCが0のため定義できません' : `${number(comparison.relativeChange * 100)}%`}</p></>}
          <button className="glass-action" onClick={save}>この条件の結果を保存</button><p role="status">{saveStatus}</p>
        </section>
        {mode === 'threshold' && <Curve study={study} settings={settings} />}
        {mode === 'bridge' && <Bridge key={conditionId(settings)} study={study} settings={settings} />}
        </div></div>}
      <details className="research-provenance"><summary>出典・データ版・研究上の注意</summary>
        <p>ESA WorldCover 2021 v200 · {study.provenance.release.license} · {study.provenance.crs}</p>
        <p>{study.provenance.attribution}</p><a href={study.provenance.sourceUrl} target="_blank" rel="noreferrer">データ出典</a>
        <dl><dt>データ版</dt><dd>{study.provenance.release.id}</dd><dt>データセット</dt><dd>{study.provenance.datasetId}</dd><dt>原分類SHA256</dt><dd>{study.provenance.classSha256}</dd><dt>マスクSHA256</dt><dd>{study.provenance.maskSha256}</dd></dl>
        <ul>{study.provenance.caveats.map(text => <li key={text}>{text}</li>)}</ul>
      </details>
    </>}
  </section>;
}
