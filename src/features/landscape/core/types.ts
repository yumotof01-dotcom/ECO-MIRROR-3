/** Independent landscape model. No dependency on the observation-event engine. */
export type Neighbourhood = 4 | 8;
export type CellClass = "vegetation" | "other" | "unknown";
export interface LandscapeGrid {
  readonly width: number;
  readonly height: number;
  /** Projected square-cell side length in metres. Not longitude/latitude degrees. */
  readonly resolutionMetres: number;
  /** A verified metric CRS identifier, e.g. EPSG:6677. */
  readonly crs: string;
  readonly datasetId: string;
  readonly sourceVersion: string;
  readonly sourceSha256: string;
  /** Row-major cells; no-data MUST be unknown, never other. */
  readonly cells: readonly CellClass[];
}
export interface Patch {
  readonly id: number;
  readonly cellCount: number;
  readonly areaM2: number;
  readonly centroidXMetres: number;
  readonly centroidYMetres: number;
}
export interface LandscapeResult {
  readonly status: "STRUCTURAL_ONLY";
  readonly model: "centroid-distance-exponential-v1";
  readonly ecologicalValidation: "not_validated";
  readonly neighbourhood: Neighbourhood;
  readonly patches: readonly Patch[];
  readonly landscapeAreaM2: number;
  readonly vegetationAreaM2: number;
  readonly pc: number;
  readonly datasetId: string;
  readonly sourceVersion: string;
  readonly sourceSha256: string;
  readonly caveat: string;
}
export type LandscapeAssessment =
  | { readonly status: "NOT_ESTIMABLE"; readonly reason: "DATA_MISSING" | "CLASS_UNKNOWN" | "CRS_INVALID" | "INPUT_INVALID" | "MODEL_LIMIT"; readonly detail: string }
  | LandscapeResult;
