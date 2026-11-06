import { StudyIntegrityError } from '../studies/verifiedStudyLoader.ts';
import { SnapshotError } from './snapshot.ts';
import { CONDITION_AXES } from './conditions.ts';

/** Semantic handoff only: no layout, colors, animations or fake live measurements. */
export const RESEARCH_UI_CONTRACT=Object.freeze({
  version:'eco3-research-ui-contract-v1',
  regionIds:Object.freeze(['shinjuku','osaka','nagoya','fukuoka','sapporo','odaiba'] as const),
  controls:CONDITION_AXES,
  modes:Object.freeze(['connectivity','scenario','threshold','bridge'] as const),
  states:Object.freeze(['idle','loading','ready','empty','cancelled','error'] as const),
  sourceYear:2021,
  semantics:Object.freeze({pc:'structural_model_indicator',lambdaMetres:'hypothesis_not_measured_dispersal',
    lossPercent:'hypothetical_removed_fraction_of_original_vegetation',curve:'model_diagnostic_not_ecological_tipping_point',
    bridge:'equal_area_hypothetical_landcover_conversion',ranking:'twelve_candidate_shortlist_only'}),
  requiredEvidence:Object.freeze(['release','regionId','datasetId','classSha256','maskSha256','crs','sourceUrl','attribution','caveats'] as const),
  fields:Object.freeze([
    Object.freeze({id:'pc',label:'構造的接続性（PC）',unit:null,nullMeaning:'未計算・不適用を0と表示しない'}),
    Object.freeze({id:'deltaPc',label:'PCの差',unit:null,nullMeaning:'比較できません'}),
    Object.freeze({id:'relativeChange',label:'基準からの相対変化',unit:'ratio',nullMeaning:'基準PCが0のため相対変化を定義できません'}),
    Object.freeze({id:'vegetationAreaM2',label:'植生候補の面積',unit:'m²',nullMeaning:'面積未取得'}),
    Object.freeze({id:'patchesJoined',label:'結合したパッチ数の減少分',unit:'count',nullMeaning:'結合判定未取得'})
  ]),
  limits:Object.freeze({regions:6,conditionsPerRegion:440,curvePoints:11,curvesPerRegion:40,
    candidateConnectors:12,candidateReferences:4,addedAreaM2:400,mapCells:40000,workerTimeoutMs:30000}),
  accessibility:Object.freeze({keyboard:true,textLegendRequired:true,tableAlternativeRequired:true,
    announceAsyncStatus:true,preserveFocusOnStatusChange:true,reducedMotion:true}),
  unverified:Object.freeze(['physical_ipad_safari','voiceover','field_ecological_effect','land_permissions_and_construction'] as const)
});
export type UiStatus=(typeof RESEARCH_UI_CONTRACT.states)[number];
export type ResearchErrorCode='cancelled'|'network'|'missing_resource'|'integrity'|'unsupported_file'|'invalid_data'|'crypto_unavailable'|'unknown';
export function researchErrorMessage(error:unknown):Readonly<{code:ResearchErrorCode;message:string;retryable:boolean}> {
  if(error instanceof Error && error.name==='AbortError')return Object.freeze({code:'cancelled',message:'処理を中止しました。',retryable:true});
  if(error instanceof SnapshotError) {
    const integrity=['CHECKSUM_MISMATCH','REPLAY_MISMATCH'].includes(error.reason);
    return Object.freeze({code:integrity?'integrity':'unsupported_file',message:integrity?
      '保存ファイルと検証済みデータが一致しません。結果は表示しません。':'この保存ファイルは読み込めません。形式・版・サイズを確認してください。',retryable:false});
  }
  if(error instanceof StudyIntegrityError) {
    switch(error.reason) {
      case 'NETWORK':return Object.freeze({code:'network',message:'データを取得できません。接続を確認して再試行してください。',retryable:true});
      case 'MISSING_RESOURCE':return Object.freeze({code:'missing_resource',message:'必要なデータが見つかりません。結果は表示しません。',retryable:true});
      case 'HASH_MISMATCH':return Object.freeze({code:'integrity',message:'データの版または内容が一致しません。結果は表示しません。',retryable:false});
      case 'CRYPTO_UNAVAILABLE':return Object.freeze({code:'crypto_unavailable',message:'この環境ではデータ検証を実行できません。',retryable:false});
      default:return Object.freeze({code:'invalid_data',message:'研究データを検証できません。結果は表示しません。',retryable:false});
    }
  }
  return Object.freeze({code:'unknown',message:'処理を完了できません。結果は表示しません。',retryable:true});
}
/** Ready means verified source/results only. A parsed but unreplayed file cannot enable export. */
export function researchActions(status:UiStatus,options:{regionVerified?:boolean}={}) {
  return Object.freeze({selectRegion:true,selectCondition:status==='ready'||status==='loading'&&options.regionVerified===true,compare:status==='ready',
    export:status==='ready',import:status!=='loading',cancel:status==='loading',retry:status==='error'||status==='cancelled'});
}
export function researchCapabilities() {
  const cryptoAvailable=!!globalThis.crypto?.subtle,workerAvailable=typeof Worker!=='undefined',fileAvailable=typeof Blob!=='undefined';
  return Object.freeze({cryptoAvailable,workerAvailable,fileAvailable,canVerify:cryptoAvailable,
    canPrepareMap:cryptoAvailable&&workerAvailable,canSaveAndReplay:cryptoAvailable&&fileAvailable});
}
