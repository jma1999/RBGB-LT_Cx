export type Point = [number, number];

export type SpaceStatus =
  | "unmapped"
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