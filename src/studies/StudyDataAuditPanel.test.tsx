import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StudyDataAuditPanel } from "./StudyDataAuditPanel.tsx";
import {
  loadVerifiedStudyRegion, StudyIntegrityError,
  type VerifiedStudyRegion
} from "./verifiedStudyLoader.ts";

vi.mock("./verifiedStudyLoader.ts",async importOriginal=>{
  const original=await importOriginal<typeof import("./verifiedStudyLoader.ts")>();
  return {...original,loadVerifiedStudyRegion:vi.fn()};
});
const mock=vi.mocked(loadVerifiedStudyRegion);
const sourceSha="b".repeat(64);
function syntheticVerified(regionId:"shinjuku"|"odaiba"):VerifiedStudyRegion {
  return {
    regionId,
    index:{crs:"EPSG:6677",derivedPixelClassSha256:sourceSha},
    grid:{cells:["vegetation","other","vegetation","other"]},
    baseline:{ensemble:{calculatedCount:440}},
    bridges:{evaluated:Array.from({length:16},(_,i)=>({site:{id:"connector-x"+i}}))}
  } as unknown as VerifiedStudyRegion;
}
beforeEach(()=>mock.mockReset());

describe("Phase 3 independent verified data status UI",()=>{
  it("starts with no pseudo-results and loads only after a user interaction",async()=>{
    render(<StudyDataAuditPanel />);
    expect(screen.getByText(/未取得/)).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
    mock.mockResolvedValue(syntheticVerified("shinjuku"));
    fireEvent.click(screen.getByRole("button",{name:/選択した地域のデータを検証/}));
    expect(await screen.findByText(/SHA-256検証成功/)).toBeInTheDocument();
    expect(screen.getByText("440 / 440")).toBeInTheDocument();
    expect(screen.getByText("16 / 16")).toBeInTheDocument();
    expect(screen.getByText(sourceSha)).toBeInTheDocument();
    expect(mock).toHaveBeenCalledWith("shinjuku",expect.objectContaining({signal:expect.any(AbortSignal)}));
  });

  it("fails explicitly and does not show zero or stale verified figures",async()=>{
    mock.mockRejectedValue(new StudyIntegrityError("HASH_MISMATCH","Test: data was changed"));
    render(<StudyDataAuditPanel />);
    fireEvent.click(screen.getByRole("button",{name:/選択した地域のデータを検証/}));
    expect(await screen.findByText(/検証失敗/)).toBeInTheDocument();
    expect(screen.getByText(/HASH_MISMATCH/)).toBeInTheDocument();
    expect(screen.queryByText("440 / 440")).not.toBeInTheDocument();
    expect(screen.getByText(/以前の地域や仮の数値は表示しません/)).toBeInTheDocument();
  });

  it("invalidates an in-flight old-region response when region changes",async()=>{
    let completeOld:(value:VerifiedStudyRegion)=>void=()=>{};
    mock.mockImplementationOnce(()=>new Promise(resolve=>{completeOld=resolve;}));
    mock.mockResolvedValueOnce(syntheticVerified("odaiba"));
    render(<StudyDataAuditPanel />);
    fireEvent.click(screen.getByRole("button",{name:/選択した地域のデータを検証/}));
    expect(screen.getByText(/検証中/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("データ確認地域"),{target:{value:"odaiba"}});
    completeOld(syntheticVerified("shinjuku"));
    expect(screen.getByText(/未取得/)).toBeInTheDocument();
    await waitFor(()=>expect(screen.queryByText(/SHA-256検証成功/)).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button",{name:/選択した地域のデータを検証/}));
    expect(await screen.findByText(/SHA-256検証成功/)).toBeInTheDocument();
    expect(mock).toHaveBeenLastCalledWith("odaiba",expect.any(Object));
    expect(screen.getByText(/東京・お台場周辺 の2021年研究データを検証/)).toBeInTheDocument();
  });
});
