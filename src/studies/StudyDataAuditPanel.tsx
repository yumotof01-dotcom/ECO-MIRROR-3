import { useEffect, useRef, useState } from "react";
import {
  loadVerifiedStudyRegion,
  type RegionId,
  type VerifiedStudyRegion,
  StudyIntegrityError
} from "./verifiedStudyLoader.ts";

const REGIONS:readonly {id:RegionId;name:string}[]=[
  {id:"shinjuku",name:"東京・新宿御苑周辺"},
  {id:"osaka",name:"大阪城周辺"},
  {id:"nagoya",name:"名古屋城周辺"},
  {id:"fukuoka",name:"福岡・大濠公園周辺"},
  {id:"sapporo",name:"札幌・円山公園周辺"},
  {id:"odaiba",name:"東京・お台場周辺"}
] as const;

type ViewState=
  | { status:"not_loaded" }
  | { status:"loading" }
  | { status:"verified"; study:VerifiedStudyRegion }
  | { status:"error"; reason:string };

/** Lightweight 2021-data preview. Not an ecological results visualizer or animal movement map. */
export function StudyDataAuditPanel() {
  const [region,setRegion]=useState<RegionId>("shinjuku");
  const [state,setState]=useState<ViewState>({status:"not_loaded"});
  const currentRequest=useRef(0);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>{currentRequest.current++;controller.current?.abort();},[]);

  function changeRegion(next:RegionId) {
    currentRequest.current++;
    controller.current?.abort();
    setRegion(next);
    setState({status:"not_loaded"}); // Never display the previous region as new data.
  }
  async function validateSelectedRegion() {
    currentRequest.current++;
    controller.current?.abort();
    const request=currentRequest.current;
    const abort=new AbortController();
    controller.current=abort;
    setState({status:"loading"}); // Clears all numerical output until full verification succeeds.
    try {
      const study=await loadVerifiedStudyRegion(region,{signal:abort.signal});
      if(request!==currentRequest.current || abort.signal.aborted)return;
      setState({status:"verified",study});
    } catch(error) {
      if(request!==currentRequest.current || abort.signal.aborted)return;
      const reason=error instanceof StudyIntegrityError
        ? error.reason
        : "NETWORK";
      setState({status:"error",reason});
    }
  }

  return (
    <section className="study-audit-panel" aria-labelledby="study-audit-heading">
      <div className="study-audit-head">
        <span className="overline">LIVE DATA INTEGRITY / PHASE 3</span>
        <h2 id="study-audit-heading">2021年の研究データを検証する</h2>
        <p>公式土地被覆から作成した6地域の研究パッケージを読み込み、原分類・出典・計算条件の完全性を確認します。表示するのは構造モデルの研究データで、実際の昆虫の移動を示すものではありません。</p>
      </div>
      <div className="study-audit-controls">
        <div className="study-audit-field">
          <label htmlFor="study-audit-region">データ確認地域</label>
          <select
            id="study-audit-region"
            value={region}
            onChange={event=>changeRegion(event.target.value as RegionId)}
          >
            {REGIONS.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
        </div>
        <button
          type="button"
          className="study-audit-button"
          disabled={state.status==="loading"}
          onClick={()=>void validateSelectedRegion()}
        >
          {state.status==="loading"?"SHA-256を検証中…":"選択した地域のデータを検証"}
        </button>
      </div>
      <div className="study-audit-status" role="status" aria-live="polite">
        {state.status==="not_loaded" && <p><strong>未取得</strong> — 地域を選び、検証ボタンを押してください。計算結果はまだ読み込んでいません。</p>}
        {state.status==="loading" && <p><strong>検証中</strong> — 元分類・マスク・440条件・16地点のデータを照合しています。</p>}
        {state.status==="error" && <p className="audit-error"><strong>検証失敗</strong> — データの取得または整合性を確認できませんでした（{state.reason}）。<br/>以前の地域や仮の数値は表示しません。</p>}
        {state.status==="verified" && (
          <div className="study-audit-results">
            <p className="audit-success"><strong>SHA-256検証成功</strong> — {REGIONS.find(x=>x.id===state.study.regionId)?.name} の2021年研究データを検証しました。</p>
            <dl className="study-audit-metrics">
              <div><dt>土地被覆セル数</dt><dd>{state.study.grid.cells.length.toLocaleString("ja-JP")}</dd></div>
              <div><dt>植生候補セル数</dt><dd>{state.study.grid.cells.filter(c=>c==="vegetation").length.toLocaleString("ja-JP")}</dd></div>
              <div><dt>解析済み条件</dt><dd>{state.study.baseline.ensemble.calculatedCount} / 440</dd></div>
              <div><dt>比較対象の仮想地点</dt><dd>{state.study.bridges.evaluated.length} / 16</dd></div>
            </dl>
            <p className="audit-provenance">
              出典：ESA WorldCover 2021 v200 · CC BY 4.0 · {state.study.index.crs}<br/>
              <span>派生元分類 SHA-256：<code>{state.study.index.derivedPixelClassSha256}</code></span>
            </p>
            <p className="audit-science-warning">土地被覆に基づく構造モデルのみを検証しています。2026年の現況、実際の生物の移動、植生追加の実現可能性は未検証です。440条件は未来予測確率ではありません。</p>
          </div>
        )}
      </div>
    </section>
  );
}
