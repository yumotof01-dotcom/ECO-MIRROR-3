#!/usr/bin/env python3
"""Independent standard-library audit of a real cropped map and full ensemble.

Run: python scripts/landscape/audit_real_results.py input_crop.json full_report.json
Does not use or trust the JavaScript scenario generator to re-count combinations.
This audits reproducibility, coverage and status; not biological field validity.
"""
import collections
import hashlib
import json
import math
import statistics
import sys

def require(ok, message):
    if not ok:
        raise AssertionError(message)

def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python audit_real_results.py crop.json report.json")
    raw_bytes = open(sys.argv[1], "rb").read()
    report_bytes = open(sys.argv[2], "rb").read()
    crop = json.loads(raw_bytes)
    report = json.loads(report_bytes)
    rows = crop["rows"]
    w, h = crop["width"], crop["height"]
    require(len(rows) == h and all(len(r) == w for r in rows), "crop shape")
    require(all(set(r) <= {"V", "O"} for r in rows), "unknown values cannot be treated as other")
    mask_hash = hashlib.sha256("".join(rows).encode("ascii")).hexdigest()
    require(mask_hash == crop["derived_binary_mask_sha256"], "crop mask hash")
    require(mask_hash == report["derived_binary_mask_sha256"], "report crop hash")
    histogram = crop["source_class_histogram"]
    require(sum(int(v) for v in histogram.values()) == w*h, "missing raw pixels")
    vegetation_codes = set(crop["class_mapping"]["vegetation"])
    raw_vegetation_count = sum(int(n) for code,n in histogram.items() if int(code) in vegetation_codes)
    require(raw_vegetation_count == "".join(rows).count("V"), "derived class counts")
    require(crop["source_full_tile_sha256"] is None, "full source hash not measured")
    require(report["source_full_tile_sha256"] is None, "full source hash not measured in report")
    ensemble=report["ensemble"]
    records=ensemble["conditions"]
    dims={
      "lambdaMetres":set(),
      "lossPercent":set(),
      "neighbourhood":set(),
      "pattern":set()
    }
    identifiers=set()
    found=set()
    for r in records:
        for key in dims:
            dims[key].add(r[key])
        tup=tuple(r[k] for k in ("lambdaMetres","lossPercent","neighbourhood","pattern"))
        require(tup not in found, "duplicate scenario tuple")
        found.add(tup)
        require(r["scenarioId"] not in identifiers, "duplicate scenario ID")
        identifiers.add(r["scenarioId"])
        require(r["status"]=="STRUCTURAL_ONLY", "failed condition, cannot claim exhaustive success")
        require(r["pc"] is not None and math.isfinite(r["pc"]) and 0<=r["pc"]<=1, "PC out of bounds")
        expected_removed=math.floor(raw_vegetation_count*r["lossPercent"]/100 + 0.5)
        expected_loss=100*expected_removed/raw_vegetation_count if raw_vegetation_count else None
        if expected_loss is None:
            require(r["actualLossPercent"] is None, "no vegetation baseline")
        else:
            require(math.isclose(r["actualLossPercent"],expected_loss,rel_tol=0,abs_tol=1e-9), "realized cell loss")
    n_expected=math.prod(len(xs) for xs in dims.values())
    require(n_expected==len(found), "missing combination in Cartesian product")
    require(len(records)==ensemble["expectedCount"]==ensemble["calculatedCount"]==n_expected,"reported run count")
    require(ensemble["status"]=="complete", "incomplete run mislabeled complete")
    require(ensemble["scientificMeaning"]=="hypothetical_stress_tests_not_forecast_probabilities","probability mislabeling")
    require(report["ecological_validation"]=="not_validated" and report["actual_future_probabilities"] is False,
            "unvalidated result misrepresented")
    thresholds=report["thresholds"]
    curves=thresholds["curves"]
    distinct_groups = {(r["lambdaMetres"],r["neighbourhood"],r["pattern"]) for r in records}
    require(len(curves)==len(distinct_groups)==thresholds["testedCurves"]==thresholds["completeCurves"],"curve count")
    grouped=collections.defaultdict(list)
    for r in records:
        grouped[(r["lambdaMetres"],r["neighbourhood"],r["pattern"])].append(r)
    require({len(x) for x in grouped.values()} == {len(dims["lossPercent"])}, "incomplete curves")
    actual_curves={(r["lambdaMetres"],r["neighbourhood"],r["pattern"]):r for r in curves}
    require(set(actual_curves)==distinct_groups,"curve labels")
    monotonicity_violations=[]
    for key,items in grouped.items():
        series=sorted(items,key=lambda r:r["lossPercent"])
        for prev,nxt in zip(series,series[1:]):
            require(prev["actualLossPercent"]<=nxt["actualLossPercent"], "vegetation removal not nested")
            require(prev["vegetationAreaM2"] >= nxt["vegetationAreaM2"], "vegetation area increased under removal")
        if any(nxt["pc"]>prev["pc"]+1e-12 for prev,nxt in zip(series,series[1:])):
            monotonicity_violations.append(key)
        c=actual_curves[key]
        require(c["baselinePc"]==series[0]["pc"] and c["finalPc"]==series[-1]["pc"],"baseline mismatch")
        if c["maxDropFromPercent"] is not None:
            drops=[a["pc"]-b["pc"] for a,b in zip(series,series[1:])]
            i=max(range(len(drops)),key=lambda j:drops[j])
            require(c["maxDropFromPercent"]==series[i]["lossPercent"] and
                c["maxDropToPercent"]==series[i+1]["lossPercent"] and
                math.isclose(c["maxDropPc"],drops[i],abs_tol=1e-12), "extremum inconsistent")
    require(thresholds["ecologicalThresholdsValidated"]==0,"no ecological validation can be claimed")
    require(thresholds["status"]=="complete", "incomplete curves labeled complete")
    candidates=[c for c in curves if c["status"]=="POTENTIAL_MODEL_ABRUPTNESS"]
    require(len(candidates)==thresholds["potentialModelAbruptnessCount"],"candidate count mismatch")
    # A candidate is not corroborated if its exact interval has no counterpart
    # in BOTH neighbourhood definitions and BOTH stress patterns.
    confirmed_within_grid=[]
    for c in candidates:
        same_interval=[x for x in candidates if x["maxDropFromPercent"]==c["maxDropFromPercent"] and
          x["maxDropToPercent"]==c["maxDropToPercent"] and x["lambdaMetres"]==c["lambdaMetres"]]
        if {x["neighbourhood"] for x in same_interval}==dims["neighbourhood"] and {x["pattern"] for x in same_interval}==dims["pattern"]:
            confirmed_within_grid.append(c)
    summary={
      "source_dataset_id":crop["dataset_id"],
      "real_vegetation_candidate_pixels":raw_vegetation_count,
      "real_vegetation_candidate_fraction":raw_vegetation_count/(w*h),
      "source_tile_full_sha256_measured":False,
      "derived_mask_sha256":mask_hash,
      "crop_json_sha256":hashlib.sha256(raw_bytes).hexdigest(),
      "full_results_sha256":hashlib.sha256(report_bytes).hexdigest(),
      "unique_scenarios_audited":len(records),
      "condition_dimensions":{k:sorted(v) for k,v in dims.items()},
      "response_curves_audited":len(curves),
      "model_abruptness_candidates":len(candidates),
      "cross_pattern_neighbourhood_corrob_candidates":len(confirmed_within_grid),
      "nonmonotonic_pc_response_curves":len(monotonicity_violations),
      "ecological_field_thresholds_validated":0,
      "limitations":[f"{w*crop['resolution_metres']}m by {h*crop['resolution_metres']}m boundary was cropped without ecological movement buffer",
                     "ESA 2021 land cover is not a measured bee habitat map",
                     "Hypothetical vegetation removal, not measured future change",
                     "The candidate's model-only classification is sensitive to arbitrary threshold settings"]
    }
    print("LANDSCAPE_INDEPENDENT_AUDIT="+json.dumps(summary,sort_keys=True,ensure_ascii=False))
    return summary

if __name__=="__main__":
    main()
