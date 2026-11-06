/** Public boundary for the later UI. No React, DOM layout, network service or generated values. */
export { CONDITIONS, CONDITION_AXES, conditionId, resolveCondition } from './conditions.ts';
export { ResearchStudy, loadResearchStudy, loadResearchSite, STUDY_RELEASE, RESEARCH_CAVEATS } from './study.ts';
export { ResearchSession } from './session.ts';
export type { ResearchState } from './session.ts';
export { LANDCOVER_LEGEND, cellBounds, candidateFootprint } from './mapData.ts';
export type { MapSelection, MapFrame } from './mapData.ts';
export { prepareResearchMap } from './mapWorkerClient.ts';
export { createResearchSnapshot,serializeResearchSnapshot,parseResearchSnapshot,readResearchSnapshot,
  replayResearchSnapshot,snapshotFile,SnapshotError,SNAPSHOT_VERSION,MAX_SNAPSHOT_BYTES } from './snapshot.ts';
export type { ResearchQuery,ResearchSnapshot } from './snapshot.ts';
export { RESEARCH_UI_CONTRACT,researchErrorMessage,researchActions,researchCapabilities } from './uiContract.ts';
export type { UiStatus,ResearchErrorCode } from './uiContract.ts';
export { ResearchMapSession } from './mapSession.ts';
export type { ResearchMapState } from './mapSession.ts';
