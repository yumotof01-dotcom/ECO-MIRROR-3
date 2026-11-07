import { useRef, useState, type KeyboardEvent } from 'react';
import { Link, NavLink, Route, Routes, useSearchParams } from 'react-router-dom';
import { ResearchView } from './ResearchView.tsx';
import type { RegionId } from './studies/verifiedStudyLoader.ts';
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
    description: '土地被覆データをもとに、植生候補と緑地パッチを調べる研究モード。研究データを読み込み、植生候補の面積と緑地パッチを確認できます。',
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
          <span className="design-pill">LANDSCAPE STUDY</span>
        </header>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/evidence" element={<Evidence />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <footer className="site-footer">
          <span>© ECO MIRROR 3.0 · 新アプリ基盤</span>
          <span>ESA WorldCover 2021 v200 · 6地域の構造モデル · 生物学的な移動は未実証</span>
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
          <p className="small-explainer home-disclaimer">2021年の土地被覆から、6地域の構造的なつながりを観察します。</p>
        </div>
      </section>
      <section className="home-overview" aria-label="4つの研究モード">
        {MODES.map(item => (
          <Link key={item.id} className="overview-card" to={`/explore?mode=${item.id}`}>
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

function Explore() {
  const [params, setParams] = useSearchParams();
  const selectedMode = params.get('mode');
  const mode: Mode = MODES.some(item => item.id === selectedMode) ? selectedMode as Mode : 'connectivity';
  const setMode = (value: Mode) => setParams({ mode: value }, { replace: true });
  const [region, setRegion] = useState<RegionId>('shinjuku');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = MODES.find(m => m.id === mode)!;
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
          <label htmlFor="region">研究地域</label>
          <select id="region" value={region} onChange={event => setRegion(event.target.value as RegionId)}>
            {REGIONS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="source-status" aria-label="2021年の土地被覆データ">
          <span className="yellow-dot" aria-hidden="true" />
          <div><strong>2021 · LAND COVER</strong><span>6地域 · 固定研究条件</span></div>
        </div>
      </section>
      <div className="workbench transparent-workbench" id="main-content">
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
        <ResearchView key={region} region={region} mode={mode} />
        <aside className="inspector" id="mode-panel" role="tabpanel" aria-labelledby={`tab-${mode}`} tabIndex={0}>
          <span className="overline">MODE INSPECTOR</span>
          <h2>{active.name}</h2>
          <p>{active.description}</p>
          <div className="micro-heading">このモードの確認項目</div>
          <ul>{active.checklist.map(text => <li key={text}>{text}</li>)}</ul>
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
      <p className="evidence-intro">このアプリは、土地被覆の分類、数理モデルの計算、現地の生物学的な証拠を混同しません。研究エンジンの新旧一致は検証済みで、2021年の静的データは検証付きで読み込めます。探索画面で地図と固定研究条件の計算結果を確認できます。</p>
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
