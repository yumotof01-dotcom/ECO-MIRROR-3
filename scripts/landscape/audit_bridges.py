#!/usr/bin/env python3
"""Independent stdlib audit: source pixels, matched area, full 440 rows, order and PC.

No dependency on the TypeScript model. A small fixed sample of before/after
PC values is recalculated from raw pixels with a separate Python algorithm.
"""
import base64
import collections
import hashlib
import json
import math
import sys

VEGETATION={10,20,30,40,90,95,100}
OTHER={50,60,70,80}
CONVERTIBLE={50,60}
EPS=1e-12

def check(condition, message):
    if not condition:
        raise AssertionError(message)

def percentile(values, p):
    ordered=sorted(values)
    idx=(len(ordered)-1)*p
    lo=math.floor(idx);hi=math.ceil(idx)
    return ordered[lo]+(ordered[hi]-ordered[lo])*(idx-lo)

def patch_pc(mask,w,h,res,neighbourhood,lam):
    directions=[(1,0),(-1,0),(0,1),(0,-1)]
    if neighbourhood==8:
        directions += [(1,1),(1,-1),(-1,1),(-1,-1)]
    marked=bytearray(w*h)
    groups=[]
    for i in range(w*h):
        if not mask[i] or marked[i]: continue
        todo=[i];marked[i]=1
        sx=sy=0;count=0
        for pos in todo:
            y,x=divmod(pos,w)
            sx+=x+0.5;sy+=y+0.5;count+=1
            for dx,dy in directions:
                xx=x+dx; yy=y+dy
                if 0<=xx<w and 0<=yy<h:
                    j=yy*w+xx
                    if mask[j] and not marked[j]:
                        marked[j]=1;todo.append(j)
        groups.append((count*res*res,(sx/count)*res,(sy/count)*res))
    n=len(groups); numerator=0.
    for i in range(n):
        ai,xi,yi=groups[i];numerator+=ai*ai
        for j in range(i+1,n):
            aj,xj,yj=groups[j]
            numerator+=2*ai*aj*math.exp(-math.hypot(xi-xj,yi-yj)/lam)
    return numerator / ((w*h*res*res)**2)

def patch_labels(mask,w,h,neighbourhood):
    """Independent component labels for verifying actual direct topology."""
    directions=[(1,0),(-1,0),(0,1),(0,-1)]
    if neighbourhood==8:directions += [(1,1),(1,-1),(-1,1),(-1,-1)]
    ids=[0]*(w*h);component_count=0
    for i in range(w*h):
        if not mask[i] or ids[i]:continue
        component_count+=1; todo=[i];ids[i]=component_count
        for pos in todo:
            y,x=divmod(pos,w)
            for dx,dy in directions:
                xx=x+dx;yy=y+dy
                if 0<=xx<w and 0<=yy<h:
                    k=yy*w+xx
                    if mask[k] and not ids[k]:ids[k]=component_count;todo.append(k)
    return ids,component_count

def hashed_order(mask,w,h,pattern):
    veg=[i for i,m in enumerate(mask) if m]
    def mix32(i):
        x=(((i+1)^0x42e1bade)*0x9e3779b1)&0xffffffff
        x=((x^(x>>16))*0x85ebca6b)&0xffffffff
        x=((x^(x>>13))*0xc2b2ae35)&0xffffffff
        return (x^(x>>16))&0xffffffff
    if pattern=="distributed":
        return sorted(veg,key=lambda i:(mix32(i),i))
    def edge(i):
        y,x=divmod(i,w);count=0
        for dy in (-1,0,1):
            for dx in (-1,0,1):
                if not (dx or dy): continue
                xx=x+dx;yy=y+dy
                if xx<0 or yy<0 or xx>=w or yy>=h or not mask[yy*w+xx]:
                    count+=1
        return count
    if pattern=="edge_first":
        return sorted(veg,key=lambda i:(-edge(i),mix32(i),i))
    raise AssertionError("invalid pattern")

def main():
    if len(sys.argv)!=4:
        raise SystemExit("Usage: audit_bridges.py crop.json baseline.json bridge.json")
    with open(sys.argv[1],encoding="utf-8") as f:crop=json.load(f)
    with open(sys.argv[2],encoding="utf-8") as f:baseline=json.load(f)
    with open(sys.argv[3],encoding="utf-8") as f:study=json.load(f)
    result=study["result"]
    w,h=crop["width"],crop["height"];res=crop["resolution_metres"]
    raw=base64.b64decode(crop["source_class_codes_b64"],validate=True)
    check(len(raw)==w*h,"raw source raster length")
    check(hashlib.sha256(raw).hexdigest()==crop["derived_pixel_class_sha256"],"source raster sha")
    mask=[c in VEGETATION for c in raw]
    check(all(c in VEGETATION|OTHER for c in raw),"unrecognized land class")
    check(hashlib.sha256("".join("V" if x else "O" for x in mask).encode("ascii")).hexdigest()
          ==crop["derived_binary_mask_sha256"],"mask sha")
    check(result["sourceRasterSha256"]==crop["derived_pixel_class_sha256"],"source binding")
    check(result["sourceDatasetId"]==crop["dataset_id"],"source ID binding")
    check(result["siteFeasibility"]=="not_assessed" and
          result["ecologicalInterventionEffectsValidated"]==0 and
          result["modelValidation"]=="not_validated_for_real_species_or_intervention",
          "not validated ecological outcome")
    reference={c["scenarioId"]:c for c in baseline["ensemble"]["conditions"]}
    expected=baseline["ensemble"]["expectedCount"]
    check(expected==440 and len(reference)==440 and result["scenarioCount"]==440,
          "all 440 scenarios must be represented")
    components4,number4=patch_labels(mask,w,h,4)
    components8,number8=patch_labels(mask,w,h,8)
    interventions=result["evaluated"]
    check(len(interventions)==result["selectedConnectorFootprintsCount"]+
          result["selectedReferenceFootprintsCount"],"candidate count mismatch")
    all_ids=set(); all_cells=set()
    for item in interventions:
        site=item["site"]
        ident=site["id"]
        check(ident not in all_ids,"duplicate location");all_ids.add(ident)
        x,y=site["x"],site["y"]
        check(x%2==0 and y%2==0 and 8<=x and x+2<=w-8 and 8<=y and y+2<=h-8,
              "off-grid or too-close-to-edge candidate")
        footprint=[y*w+x,y*w+x+1,(y+1)*w+x,(y+1)*w+x+1]
        check(site["cells"]==footprint,"site cells differ from declared x,y")
        check(not any(i in all_cells for i in footprint),"overlapping sites")
        all_cells.update(footprint)
        check(site["sourceClasses"]==[raw[i] for i in footprint] and
              all(raw[i] in CONVERTIBLE for i in footprint) and
              all(not mask[i] for i in footprint),"water, vegetation or mislabeled candidate")
        check(site["addedAreaM2"]==4*res**2,"unequal area")
        orthogonal=[(x-1,y),(x-1,y+1),(x+2,y),(x+2,y+1),
                    (x,y-1),(x+1,y-1),(x,y+2),(x+1,y+2)]
        perimeter=[(xx,yy) for yy in range(y-1,y+3) for xx in range(x-1,x+3)
                   if not(x<=xx<=x+1 and y<=yy<=y+1)]
        def touch_count(positions,component_ids):
            return len({component_ids[yy*w+xx] for xx,yy in positions
                if 0<=xx<w and 0<=yy<h and component_ids[yy*w+xx]>0})
        touch4=touch_count(orthogonal,components4)
        touch8=touch_count(perimeter,components8)
        check(site["adjacentPatchCount4"]==touch4 and site["adjacentPatchCount8"]==touch8,
              "independent topology audit mismatch")
        expected_mechanism=("joins_patches_in_both" if touch4>=2 and touch8>=2 else
           "joins_patches_in_4_only" if touch4>=2 else
           "joins_patches_in_8_only" if touch8>=2 else "no_direct_patch_join")
        check(site["topologicalEffect"]==expected_mechanism,"false direct bridge label")
        if site["role"]=="hypothetical_connector":
            check(site["nearbyPatchCount"]>=2,"connector lacks two baseline patches")
        else:
            check(site["role"]=="equal_area_reference" and site["nearbyPatchCount"]<2,
                  "reference wrongly labeled")
        rows=item["results"]
        check(len(rows)==item["resultCount"]==expected,"not all scenarios evaluated")
        keys={r["scenarioId"] for r in rows}
        check(keys==set(reference),"intervention missing scenario IDs or duplicated scenarios")
        gains=[]
        for r in rows:
            b=reference[r["scenarioId"]]
            check(r["beforePc"]==b["pc"],"baseline PC changed")
            check(r["beforeVegetationAreaM2"]==b["vegetationAreaM2"],"baseline vegetation changed")
            check(math.isclose(r["afterVegetationAreaM2"]-r["beforeVegetationAreaM2"],
                               4*res**2,abs_tol=1e-9),"not the same added area")
            check(math.isclose(r["afterPc"]-r["beforePc"],r["deltaPc"],abs_tol=1e-12),
                  "intervention effect mismatch")
            check(all(math.isfinite(r[k]) for k in ("afterPc","beforePc","deltaPc")),
                  "non-finite PC")
            check(0<=r["afterPc"]<=1 and 0<=r["beforePc"]<=1,"PC outside range")
            check(isinstance(r["beforePatchCount"],int) and r["beforePatchCount"]>=0 and
                  isinstance(r["afterPatchCount"],int) and r["afterPatchCount"]>=0,"invalid patch counts")
            check(r["patchesJoined"]==max(0,r["beforePatchCount"]-r["afterPatchCount"]),
                  "reported patch merger count mismatch")
            gains.append(r["deltaPc"])
        summary=item["summary"]
        check(summary["count"]==expected,"summary coverage")
        for key,val in (("minimumDeltaPc",min(gains)),("maximumDeltaPc",max(gains)),
                        ("lowerDecileDeltaPc",percentile(gains,0.1)),
                        ("medianDeltaPc",percentile(gains,0.5))):
            check(math.isclose(summary[key],val,rel_tol=0,abs_tol=1e-12),key+" mismatch")
        positive=sum(g>EPS for g in gains)
        negative=sum(g < -EPS for g in gains)
        check((summary["positiveConditions"],summary["negativeConditions"],summary["zeroConditions"])
              ==(positive,negative,len(gains)-positive-negative),"sign counts")
        reduced=sum(r["afterPatchCount"]<r["beforePatchCount"] for r in rows)
        unchanged=sum(r["afterPatchCount"]==r["beforePatchCount"] for r in rows)
        increased=sum(r["afterPatchCount"]>r["beforePatchCount"] for r in rows)
        check((summary["scenariosWithPatchMerger"],
              summary["scenariosWithoutPatchCountChange"],summary["scenariosCreatingNewIsland"])
              ==(reduced,unchanged,increased),"topological summary mismatch")
    connector_items=[it for it in interventions if it["site"]["role"]=="hypothetical_connector"]
    control_items=[it for it in interventions if it["site"]["role"]=="equal_area_reference"]
    check(len(connector_items)==result["selectedConnectorFootprintsCount"],"connector count")
    check(len(control_items)==result["selectedReferenceFootprintsCount"],"controls count")
    sorted_rank=sorted(connector_items,key=lambda it:(
        -it["summary"]["lowerDecileDeltaPc"], -it["summary"]["medianDeltaPc"],it["site"]["id"]))
    check([it["site"]["id"] for it in sorted_rank]==result["rankedConnectorIds"],"ranking mismatch")
    check([it["site"]["id"] for it in sorted_rank
        if it["site"]["topologicalEffect"]=="joins_patches_in_both"]==result["rankedDirectBridgeIds"],
        "separate true direct bridge ranking mismatch")
    # The strongest direct bridge should reduce the number of 4- and 8-components.
    if result["rankedDirectBridgeIds"]:
        direct=next(it for it in interventions if it["site"]["id"]==result["rankedDirectBridgeIds"][0])
        revised=mask.copy()
        for idx in direct["site"]["cells"]:revised[idx]=True
        _,after4=patch_labels(revised,w,h,4)
        _,after8=patch_labels(revised,w,h,8)
        check(after4<number4 and after8<number8,"claimed bridge failed to join patches")

    # Recalculate a small fixed sample independently of the TypeScript connectivity engine.
    sample_items=[sorted_rank[0]]
    if control_items:sample_items.append(control_items[0])
    chosen_scenarios=[
        ("distributed",0,4,40),("edge_first",25,8,300),
        ("distributed",50,8,1500),("edge_first",50,4,60),
    ]
    independent_cases=0
    baseline_mask=mask
    ranking_by_pattern={p:hashed_order(mask,w,h,p) for p in ("distributed","edge_first")}
    for item in sample_items:
        by_id={r["scenarioId"]:r for r in item["results"]}
        for pattern,percent,neighbour,lam in chosen_scenarios:
            sid=pattern+"-n"+str(neighbour)+"-lambda"+str(lam)+"-loss"+str(percent)
            removed=math.floor(sum(mask)*percent/100+.5)
            altered=baseline_mask.copy()
            for idx in ranking_by_pattern[pattern][:removed]:
                altered[idx]=False
            check(all(not altered[idx] for idx in item["site"]["cells"]),"site already vegetation")
            pre=patch_pc(altered,w,h,res,neighbour,lam)
            _,before_components=patch_labels(altered,w,h,neighbour)
            for idx in item["site"]["cells"]:altered[idx]=True
            post=patch_pc(altered,w,h,res,neighbour,lam)
            _,after_components=patch_labels(altered,w,h,neighbour)
            row=by_id[sid]
            check(row["beforePatchCount"]==before_components and
                  row["afterPatchCount"]==after_components,
                  "independent per-scenario topology mismatch for "+sid)
            check(math.isclose(pre,row["beforePc"],rel_tol=0,abs_tol=1e-11),
                  "independent baseline PC mismatch for "+sid)
            check(math.isclose(post,row["afterPc"],rel_tol=0,abs_tol=1e-11),
                  "independent intervention PC mismatch for "+sid)
            independent_cases+=1
    top=sorted_rank[0]
    output={
        "source":crop["dataset_id"],
        "candidate_pool_reported":result["sourcePixelCandidatesCount"],
        "connector_eligible_reported":result["connectorEligibleFootprintsCount"],
        "candidate_sites_checked":len(interventions),
        "scenarios_per_candidate":expected,
        "total_scenario_comparisons_checked":sum(len(it["results"]) for it in interventions),
        "independent_before_after_pc_cases":independent_cases,
        "model_robustness_quantile":"type7 q=0.10",
        "ranked_first_candidate_id":top["site"]["id"],
        "ranked_first_lower_decile_delta_pc":top["summary"]["lowerDecileDeltaPc"],
        "ranked_first_negative_conditions":top["summary"]["negativeConditions"],
        "ranked_first_patch_merge_conditions":top["summary"]["scenariosWithPatchMerger"],
        "reference_candidate_count":len(control_items),
        "genuine_both_neighbourhood_bridges_in_shortlist":len(result["rankedDirectBridgeIds"]),
        "outcome":"PASS",
        "field_ecology_validation":"NOT_DONE",
        "site_legal_feasibility":"NOT_DONE"
    }
    print("LANDSCAPE_BRIDGE_INDEPENDENT_AUDIT="+json.dumps(output,sort_keys=True))
if __name__=="__main__":
    main()
