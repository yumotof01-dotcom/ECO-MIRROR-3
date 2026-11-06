import type { EnsembleResult, ScenarioRecord, DisturbancePattern } from "../scenarios/engine.ts";
import { LAMBDA_METRES, NEIGHBOURHOODS, PATTERNS, LOSS_PERCENT } from "../scenarios/engine.ts";
import type { Neighbourhood } from "../core/types.ts";

/** A model-only diagnostic; never a measured ecological collapse threshold. */
export interface CurveDiagnostic {
  readonly pattern: DisturbancePattern;
  readonly neighbourhood: Neighbourhood;
  readonly lambdaMetres: number;
  readonly status: "LARGEST_DECLINE_ONLY" | "POTENTIAL_MODEL_ABRUPTNESS" | "NO_DECLINE" | "UNDEFINED_BASELINE" | "INCOMPLETE_CURVE";
  readonly baselinePc: number | null;
  readonly finalPc: number | null;
  readonly maxDropFromPercent: number | null;
  readonly maxDropToPercent: number | null;
  readonly maxDropPc: number | null;
  readonly maxSlopePcPerOnePercent: number | null;
  readonly largestToMedianDropRatio: number | null;
  readonly nonmonotonic: boolean | null;
  readonly warnings: readonly string[];
}
export interface ThresholdReport {
  readonly schemaVersion: "landscape-thresholds-v1";
  readonly status: "complete" | "incomplete";
  readonly testedCurves: number;
  readonly completeCurves: number;
  readonly potentialModelAbruptnessCount: number;
  readonly curves: readonly CurveDiagnostic[];
  readonly ecologicalThresholdsValidated: 0;
  readonly interpretation: string;
}
function median(xs:readonly number[]):number{
  const a=[...xs].sort((x,y)=>x-y);
  return a.length%2===1?a[(a.length-1)/2]!:(a[a.length/2-1]!+a[a.length/2]!)/2;
}
function curveKey(pattern:DisturbancePattern,n:Neighbourhood,lambda:number){
  return pattern+"|"+n+"|"+lambda;
}
export function detectModelChangeIntervals(ensemble:EnsembleResult):ThresholdReport {
  const byKey=new Map<string,ScenarioRecord[]>();
  for(const record of ensemble.conditions){
    const key=curveKey(record.pattern,record.neighbourhood,record.lambdaMetres);
    if(!byKey.has(key))byKey.set(key,[]);
    byKey.get(key)!.push(record);
  }
  const curves:CurveDiagnostic[]=[];
  for(const pattern of PATTERNS)for(const neighbourhood of NEIGHBOURHOODS)for(const lambdaMetres of LAMBDA_METRES){
    const group=byKey.get(curveKey(pattern,neighbourhood,lambdaMetres))??[];
    const ordered=[...group].sort((a,b)=>a.lossPercent-b.lossPercent);
    const base={pattern,neighbourhood,lambdaMetres};
    const incomplete=ordered.length!==LOSS_PERCENT.length ||
      ordered.some((r,i)=>r.lossPercent!==LOSS_PERCENT[i]||r.status!=="STRUCTURAL_ONLY"||r.pc===null);
    if(incomplete){
      curves.push({...base,status:"INCOMPLETE_CURVE",baselinePc:null,finalPc:null,maxDropFromPercent:null,
        maxDropToPercent:null,maxDropPc:null,maxSlopePcPerOnePercent:null,largestToMedianDropRatio:null,
        nonmonotonic:null,warnings:["Missing, duplicated, uncalculated or invalid parameter points."]});
      continue;
    }
    const pcs=ordered.map(r=>r.pc!);
    const baseline=pcs[0]!,last=pcs[pcs.length-1]!;
    if(baseline<=0){
      curves.push({...base,status:"UNDEFINED_BASELINE",baselinePc:baseline,finalPc:last,maxDropFromPercent:null,
        maxDropToPercent:null,maxDropPc:null,maxSlopePcPerOnePercent:null,largestToMedianDropRatio:null,
        nonmonotonic:null,warnings:["Connectivity baseline is zero, so change cannot be normalized."]});
      continue;
    }
    const deltas=pcs.slice(1).map((p,i)=>pcs[i]!-p);
    const nonmonotonic=deltas.some(d=>d < -Math.max(1e-12,baseline*1e-8));
    let bestIndex=0;
    for(let i=1;i<deltas.length;i++)if(deltas[i]!>deltas[bestIndex]!)bestIndex=i;
    const drop=deltas[bestIndex]!;
    const positives=deltas.map(d=>Math.max(0,d));
    const med=median(positives);
    const ratio=drop<=0?0:med===0?null:drop/med;
    const significant=drop>0 && drop>=0.01*baseline && (ratio===null||ratio>=2);
    const warnings=["Largest decrease is a model interval, not proof of an ecological tipping point."];
    if(nonmonotonic)warnings.push("Connectivity rises in some removal steps; centroid-geometry or classification artefacts may dominate.");
    if(ratio===null && drop>0)warnings.push("Median drop is zero; ratio is undefined, inspect step discretization.");
    const status=drop<=0?"NO_DECLINE":!nonmonotonic&&significant&&ratio!==null?
      "POTENTIAL_MODEL_ABRUPTNESS":"LARGEST_DECLINE_ONLY";
    curves.push({...base,status,baselinePc:baseline,finalPc:last,
      maxDropFromPercent:ordered[bestIndex]!.lossPercent,
      maxDropToPercent:ordered[bestIndex+1]!.lossPercent,maxDropPc:drop,
      maxSlopePcPerOnePercent:drop/(ordered[bestIndex+1]!.lossPercent-ordered[bestIndex]!.lossPercent),
      largestToMedianDropRatio:ratio,nonmonotonic,warnings});
  }
  const complete=curves.filter(x=>x.status!=="INCOMPLETE_CURVE").length;
  return {schemaVersion:"landscape-thresholds-v1",status:complete===curves.length?"complete":"incomplete",
    testedCurves:curves.length,completeCurves:complete,
    potentialModelAbruptnessCount:curves.filter(x=>x.status==="POTENTIAL_MODEL_ABRUPTNESS").length,
    curves,ecologicalThresholdsValidated:0,
    interpretation:"All extrema and abruptness flags are only model sensitivities under hypothetical vegetation removal, not ecological tipping points, population declines or future probabilities."};
}
