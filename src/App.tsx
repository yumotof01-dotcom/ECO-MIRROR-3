import { useRef, useState, type KeyboardEvent } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { StudyDataAuditPanel } from './studies/StudyDataAuditPanel.tsx';

type Mode = 'connectivity' | 'scenario' | 'threshold' | 'bridge';
const REGIONS = [
  { id: 'shinjuku', name: '東京・新宿御苑周辺' },
  { id: 'osaka', name: '大阪城周辺' },
  { id: 'nagoya', name: '名古屋城周辺' },
  { id: 'fukuoka', name: '福岡・大濠公園周辺' },
  { id: 'sapporo', name: '札幌・円山公園周辺' },
  { id: 'odaiba', name: '東京・お台場周辺' }
] as const;

const MODES: { id: Mode; number: string; name: string; en: string; headline: string; description: string; checklist: string[] }[] = [
  {
    id: 'connectivity', number: '01', name: 'つながりを読む', en: 'LANDSCAPE',
    headline: '構造的なつながり',
    description: '土地被覆データをもとに、植生候補と緑地パッチを調べる研究モード。新アプリには研究データが未接続のため、現在は使い方と確認項目を表示しています。',
    checklist: ['元の土地被覆分類・観測年', '4近傍・8近傍でのパッチ抽出', '出典、欠測、推定と未実証の区別']
  },
  {
    id: 'scenario', number: '02', name: '条件を試す', en: '440 CONDITIONS',
    headline: '440条件を比較する',
    description: '距離減衰の仮説パラメータや仮想的な植生減少率を変え、構造的なPCを比較する画面。ここで示す条件の数は研究仕様であり、未来の発生確率ではありません。',
    checklist: ['仮説λ：10種類（40〜1500m）', '仮想植生減少率：0〜50%（5%刻み）', '4/8近傍 × 除去規則2種類']
  },
  {
    id: 'threshold', number: '03', name: '急変区間を調べる', en: 'MODEL SENSITIVITY',
    headline: 'モデルの低下区間',
    description: '計算上のPCが大きく低下する条件を調べる研究モード。モデルの暫定的な急変区間を、自然界の崩壊や絶滅の閾値として表示することはありません。',
    checklist: ['PC曲線と最大低下区間', '領域・仮定を変えたときの頑健性', '生態学的な閾値の実証は未完了']
  },
  {
    id: 'bridge', number: '04', name: '自然の橋を比較', en: 'CONCEPTUAL BRIDGES',
    headline: '仮想的な接続候補',
    description: '同じ400㎡の仮想的な植生追加を比較する研究モード。PC増分と地図上でパッチが実際に結合することは別の指標として扱います。',
    checklist: ['2×2画素・400㎡の同面積比較', 'PC増分とパッチ結合件数の分離', '地権・工事・動物の移動は未検証']
  }
];

function Identity() {
  return (
    <Link className="identity identity-link" to="/" aria-label="ECO MIRROR 3.0 ホーム">
      <span className="identity-mark" aria-hidden="true">◈</span>
      <span><strong>ECO MIRROR</strong><small className="subbrand">3.0 · LANDSCAPE OBSERVATORY</small></span>
    </Link>
  );
}

function Shell() {
  return (
    <>
      <a className="skip" href="#main-content">主な内容へ移動</a>
      <div className="page-shell">
        <header className="topbar">
          <Identity />
          <nav className="site-nav" aria-label="サイト内ナビゲーション">
            <NavLink to="/" end>ホーム</NavLink>
            <NavLink to="/explore">探索する</NavLink>
            <NavLink to="/evidence">研究の根拠</NavLink>
          </nav>
          <span className="design-pill">PHASE 1 · APP SHELL</span>
        </header>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/evidence" element={<Evidence />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <footer className="site-footer">
          <span>© ECO MIRROR 3.0 · 新アプリ基盤</span>
          <span>ESA WorldCover 2021 v200 · データ未接続 · 生物学的な移動は未実証</span>
        </footer>
      </div>
    </>
  );
}

function Home() {
  return (
    <main id="main-content" className="home-landing" tabIndex={-1}>
      <section className="home-hero" aria-labelledby="home-heading">
        <div className="home-copy">
          <p className="overline">EXPLORE THE HIDDEN CONNECTIONS</p>
          <h1 id="home-heading">自然のつながりを、<br /><em>見る。試す。確かめる。</em></h1>
          <p className="home-lead">自然の姿は、地図に映っているものだけで決まるのだろうか。土地被覆と数理モデルを手がかりに、つながりを問い直す研究アプリ。</p>
          <div className="home-actions">
            <Link className="action-link" to="/explore">研究ワークスペースへ <span aria-hidden="true">↗</span></Link>
            <Link className="subtle-link" to="/evidence">データの根拠と限界</Link>
          </div>
          <p className="small-explainer home-disclaimer">現在は第1工程。研究計算エンジンと実地地図はまだ接続されていません。</p>
        </div>
      </section>
      <section className="home-overview" aria-label="4つの研究モード">
        {MODES.map(item => (
          <Link key={item.id} className="overview-card" to="/explore">
            <span className="overline">{item.number} / {item.en}</span>
            <strong>{item.name}</strong>
            <span className="overview-arrow" aria-hidden="true">↗</span>
          </Link>
        ))}
      </section>
      <section className="home-integrity" aria-label="研究上の注意">
        <span className="overline">RESEARCH INTEGRITY</span>
        <p>ESA WorldCoverは2021年の土地被覆を示す製品です。緑地候補を特定の昆虫の生息地と断言せず、440条件を未来の予測確率と呼ばず、実地検証のない結果を実証済みとして扱いません。</p>
      </section>
    </main>
  );
}

function DecorativeMap() {
  return (
    <div className="concept-map">
      <svg className="decorative-network" viewBox="0 0 900 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <defs><radialGradient id="eco-halo"><stop offset="0" stopColor="#69D2A6" stopOpacity=".23" /><stop offset="1" stopColor="#69D2A6" stopOpacity="0" /></radialGradient></defs>
        <circle cx="445" cy="265" r="350" fill="url(#eco-halo)" />
        <g className="landmass" fill="#235C48" stroke="#5FB994" strokeWidth="1.5" opacity=".73">
          <path d="M65 100Q135 40 203 110L195 205Q130 240 70 183Z" />
          <path d="M605 110Q690 44 770 118L805 216Q740 273 662 226Z" />
          <path d="M342 332Q412 252 520 320L547 410Q450 478 352 431Z" />
          <path d="M90 405Q143 362 205 404L216 480Q135 521 78 462Z" />
          <path d="M708 408Q751 361 814 399L825 492Q751 510 698 469Z" />
        </g>
        <g stroke="#8EC5E8" strokeWidth="2" strokeDasharray="7 10" fill="none" opacity=".68">
          <path d="M155 156Q351 42 697 172" /><path d="M155 156Q223 291 434 375" />
          <path d="M434 375Q593 334 745 433" /><path d="M697 172Q664 322 745 433" />
        </g>
        <g fill="#C4F2D9" stroke="#0A1518" strokeWidth="4">
          <circle cx="155" cy="156" r="10" /><circle cx="697" cy="172" r="10" />
          <circle cx="434" cy="375" r="10" /><circle cx="745" cy="433" r="10" />
        </g>
      </svg>
      <div className="map-message" role="status">
        <span className="overline">DATA NOT CONNECTED</span>
        <strong>研究データは、まだ接続していません。</strong>
        <p>背景は設計用の概念図で、実在する土地被覆・動植物の移動・計算値ではありません。</p>
      </div>
      <div className="map-legend" aria-label="概念図の凡例">
        <span><i className="legend-square" aria-hidden="true" />装飾的な緑地</span>
        <span><i className="legend-dash" aria-hidden="true" />装飾的な点線</span>
      </div>
    </div>
  );
}

function Explore() {
  const [mode, setMode] = useState<Mode>('connectivity');
  const [region, setRegion] = useState<string>('shinjuku');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = MODES.find(m => m.id === mode)!;
  const regionName = REGIONS.find(r => r.id === region)?.name ?? '';
  function handleTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let target: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = (index + 1) % MODES.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = (index - 1 + MODES.length) % MODES.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = MODES.length - 1;
    else return;
    event.preventDefault();
    setMode(MODES[target]!.id);
    tabRefs.current[target]?.focus();
  }
  return (
    <>
      <section className="study-band" aria-label="研究データの状態">
        <div className="band-heading">
          <span className="overline">RESEARCH CONTEXT / 2021</span>
          <h1>自然のつながりを、見る。試す。確かめる。</h1>
        </div>
        <div className="region-picker">
          <label htmlFor="region">研究地域（地図は未接続）</label>
          <select id="region" value={region} onChange={event => setRegion(event.target.value)}>
            {REGIONS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="source-status" aria-label="研究計算は未接続">
          <span className="yellow-dot" aria-hidden="true" />
          <div><strong>2021 · LAND COVER</strong><span>計算データ未接続</span></div>
        </div>
      </section>
      <div className="workbench" id="main-content">
        <nav className="navigation" aria-label="研究モード">
          <p className="overline">FOUR RESEARCH LENSES</p>
          <div className="mode-tabs" role="tablist" aria-label="研究モードを切り替える">
            {MODES.map((item, index) => (
              <button
                key={item.id} type="button" id={`tab-${item.id}`}
                role="tab" aria-selected={mode === item.id} aria-controls="mode-panel"
                tabIndex={mode === item.id ? 0 : -1}
                ref={element => { tabRefs.current[index] = element; }}
                onClick={() => setMode(item.id)}
                onKeyDown={event => handleTabs(event, index)}
              >
                <span className="tab-number">{item.number}</span>
                <span>{item.name}<small>{item.en}</small></span>
              </button>
            ))}
          </div>
          <div className="research-note"><span className="note-line" /><p><strong>科学的な慎重さも、デザインの一部。</strong>構造的なつながりは、実際の昆虫の移動経路ではありません。</p></div>
        </nav>
        <main className="map-stage" tabIndex={-1} aria-labelledby="map-title">
          <div className="map-top"><div><span className="overline">LANDSCAPE FIELD</span><h2 id="map-title">{active.headline}</h2></div><span className="sample-label">概念図 · 実在の地図ではありません</span></div>
          <DecorativeMap />
          <div className="map-foot">
            <span>選択地域：<strong className="region-name">{regionName}</strong></span>
            <span>データ状態：<strong>未接続</strong>・計算値は表示しません</span>
          </div>
        </main>
        <aside className="inspector" id="mode-panel" role="tabpanel" aria-labelledby={`tab-${mode}`} tabIndex={0}>
          <span className="overline">MODE INSPECTOR</span>
          <h2>{active.name}</h2>
          <p>{active.description}</p>
          <div className="micro-heading">このモードの確認項目</div>
          <ul>{active.checklist.map(text => <li key={text}>{text}</li>)}</ul>
          <div className="parameter-card"><span className="overline">CALCULATION STATUS</span><strong>未接続</strong><p>検証済みの地図・PC・候補順位を移植するまでは、データと見せかけた数値を作りません。</p></div>
          <div className="micro-heading">研究エンジン接続の予定</div>
          <p className="small-explainer">第2工程で旧研究の固定コードとデータを照合し、再現性を確認したあとに計算機能を有効化します。</p>
          <Link className="action-link panel-link" to="/evidence">科学的な根拠を確認する <span aria-hidden="true">↗</span></Link>
        </aside>
      </div>
    </>
  );
}

function Evidence() {
  return (
    <main id="main-content" className="evidence-page" tabIndex={-1}>
      <p className="overline">RESEARCH INTEGRITY</p>
      <h1>科学的な根拠と、まだ分からないこと。</h1>
      <p className="evidence-intro">このアプリは、土地被覆の分類、数理モデルの計算、現地の生物学的な証拠を混同しません。研究エンジンの新旧一致は検証済みで、2021年の静的データは検証付きで読み込めます。ただし、地図とシミュレーションの操作画面は次の工程です。</p>
      <div className="evidence-grid">
        <section className="evidence-tile">
          <span className="overline">01 / SOURCE</span>
          <h2>土地被覆データ</h2>
          <p>ESA WorldCover 2021 v200。2021年の土地被覆分類であり、現在の緑地配置を保証するものではありません。</p>
          <p>© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium</p>
          <a href="https://doi.org/10.5281/zenodo.7254221" target="_blank" rel="noopener noreferrer">公式データのDOIを見る ↗</a>
        </section>
        <section className="evidence-tile">
          <span className="overline">02 / MODEL</span>
          <h2>構造的なPC</h2>
          <p>仮の距離減衰と緑地パッチの面積・重心距離から計算する代理指標。昆虫の実移動や授粉成功率の実測値ではありません。</p>
          <p>440条件は仮定を変えた感度分析であり、未来の確率ではありません。</p>
        </section>
        <section className="evidence-tile">
          <span className="overline">03 / INTERVENTION</span>
          <h2>自然の橋</h2>
          <p>400㎡の植生追加という仮想的な地図変更を比較する実験。PCが増えても、パッチが直接結合したり生物が移動したりするとは限りません。</p>
          <p>所有権・工事可能性・実際の生態系への効果は未検証です。</p>
        </section>
        <section className="evidence-tile">
          <span className="overline">04 / VERIFICATION</span>
          <h2>旧研究と新アプリの違い</h2>
          <p>旧研究エンジンは新アプリに移植済みで、6地域の計算結果の新旧一致も確認済みです。下のデータ検証画面では、配信ファイルを読み込む際のハッシュと完全性を確認できます。構造モデルの結果は生物学的な実測値ではありません。</p>
          <a href="https://github.com/yumotof01-dotcom/ECO-MIRROR/pull/20" target="_blank" rel="noopener noreferrer">旧研究の監査記録 ↗</a>
        </section>
      </div>
      <StudyDataAuditPanel />
      <Link className="action-link" to="/explore">研究ワークスペースへ戻る <span aria-hidden="true">↗</span></Link>
    </main>
  );
}

function NotFound() {
  return (
    <main id="main-content" className="not-found" tabIndex={-1}>
      <span className="overline">PAGE NOT FOUND</span>
      <h1>ページが見つかりません。</h1>
      <p>このURLに対応する画面はありません。以前の研究結果を代わりに表示することはしません。</p>
      <Link className="action-link" to="/">ホームへ戻る</Link>
    </main>
  );
}

export function App() {
  return <Shell />;
}
