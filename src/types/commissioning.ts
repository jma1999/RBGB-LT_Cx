export type Point = [number, number];

export type SpaceStatus =
  | "not_inspected"
  | "in_progress"
  | "passed"
  | "issue"
  | "not_applicable";

export type ChecklistResult =
  | "not_checked"
  | "pass"
  | "issue"
  | "not_applicable";

export interface ChecklistItem {
  id: string;
  category: "lighting" | "control" | string;
  deviceType: string;
  expectedQty: number | null;
  observedQty: number | null;
  result: ChecklistResult;
  notes: string;
  issueIds: string[];
}

export interface CommissioningSpace {
  id: string;
  sourceRow: number;
  floor: string;
  roomNo: string;
  spaceType: string;
  displayName: string;
  status: SpaceStatus;
  polygon: Point[];
  daylightZone: string | null;
  emergencyFixtures: string | null;
  testedBy: string;
  testedAt: string | null;
  notes: string;
  items: ChecklistItem[];
  issueIds: string[];
}

export interface FloorData {
  schemaVersion: number;
  floor: string;
  plan: {
    file: string;
    viewBox: string;
  };
  spaces: CommissioningSpace[];
}

export interface FloorRegion {
  id: string;
  label: string;
  points: Point[];
  centroid: Point;
  area: number;
  assignedSpaceId: string | null;
  status: "unassigned";
}

export interface RegionData {
  schemaVersion: number;
  floor: string;
  viewBox: string;
  sourcePlan: string;
  generation: {
    method: string;
    regionCount: number;
    reviewRequired: boolean;
    note: string;
  };
  regions: FloorRegion[];
}