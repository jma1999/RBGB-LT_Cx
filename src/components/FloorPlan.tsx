import { useEffect, useMemo, useState } from "react";
import {
  TransformComponent,
  TransformWrapper,
} from "react-zoom-pan-pinch";

import type {
  CommissioningSpace,
  FloorData,
  FloorRegion,
  RegionData,
  SpaceStatus,
} from "../types/commissioning";

type AppMode = "assign" | "inspect";
export type FloorId = "03" | "04";

interface FloorPlanProps {
  floor: FloorId;
}

const STATUS_STYLES: Record<
  SpaceStatus | "unassigned",
  { fill: string; stroke: string; label: string }
> = {
  unassigned: {
    fill: "#f1f5f9",
    stroke: "#94a3b8",
    label: "Unassigned",
  },
  not_inspected: {
    fill: "#dbeafe",
    stroke: "#2563eb",
    label: "Not inspected",
  },
  in_progress: {
    fill: "#fef3c7",
    stroke: "#d97706",
    label: "In progress",
  },
  passed: {
    fill: "#dcfce7",
    stroke: "#16a34a",
    label: "Passed",
  },
  issue: {
    fill: "#fee2e2",
    stroke: "#dc2626",
    label: "Issue",
  },
  not_applicable: {
    fill: "#f1f5f9",
    stroke: "#64748b",
    label: "Not applicable",
  },
};

function pointsToString(region: FloorRegion): string {
  return region.points.map(([x, y]) => `${x},${y}`).join(" ");
}

function loadSavedAssignments(
  storageKey: string,
): Record<string, string | null> {
  const savedValue = localStorage.getItem(storageKey);

  if (!savedValue) {
    return {};
  }

  try {
    return JSON.parse(savedValue) as Record<string, string | null>;
  } catch {
    localStorage.removeItem(storageKey);
    return {};
  }
}

export default function FloorPlan({ floor }: FloorPlanProps) {
  const floorDataUrl = `/data/floor-${floor}-spaces.json`;
  const regionDataUrl = `/data/floor-${floor}-regions.json`;
  const assignmentStorageKey =
    `lighting-cx-floor-${floor}-region-assignments-v1`;

  const [floorData, setFloorData] = useState<FloorData | null>(null);
  const [regionData, setRegionData] = useState<RegionData | null>(null);
  const [mode, setMode] = useState<AppMode>("assign");
  const [selectedRegionId, setSelectedRegionId] = useState("");
  const [pendingSpaceId, setPendingSpaceId] = useState("");
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(
    null,
  );
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    async function loadData(): Promise<void> {
      setLoadError("");

      try {
        const [floorResponse, regionResponse] = await Promise.all([
          fetch(floorDataUrl),
          fetch(regionDataUrl),
        ]);

        if (!floorResponse.ok || !regionResponse.ok) {
          throw new Error(`The Floor ${floor} plan data could not be loaded.`);
        }

        const loadedFloorData = (await floorResponse.json()) as FloorData;
        const loadedRegionData = (await regionResponse.json()) as RegionData;

        if (
          loadedFloorData.floor !== floor ||
          loadedRegionData.floor !== floor
        ) {
          throw new Error(`The Floor ${floor} files contain the wrong floor ID.`);
        }

        const savedAssignments = loadSavedAssignments(
          assignmentStorageKey,
        );

        setFloorData(loadedFloorData);
        setRegionData({
          ...loadedRegionData,
          regions: loadedRegionData.regions.map((region) => ({
            ...region,
            assignedSpaceId:
              savedAssignments[region.id] ?? region.assignedSpaceId,
          })),
        });
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : `The Floor ${floor} data could not be loaded.`,
        );
      }
    }

    void loadData();
  }, [assignmentStorageKey, floor, floorDataUrl, regionDataUrl]);

  const spacesById = useMemo(() => {
    return new Map(
      floorData?.spaces.map((space) => [space.id, space]) ?? [],
    );
  }, [floorData]);

  const selectedRegion = useMemo(() => {
    return regionData?.regions.find(
      (region) => region.id === selectedRegionId,
    );
  }, [regionData, selectedRegionId]);

  const selectedAssignedSpace = selectedRegion?.assignedSpaceId
    ? spacesById.get(selectedRegion.assignedSpaceId)
    : undefined;

  const assignedSpaceIds = useMemo(() => {
    return new Set(
      regionData?.regions
        .map((region) => region.assignedSpaceId)
        .filter((spaceId): spaceId is string => Boolean(spaceId)) ?? [],
    );
  }, [regionData]);

  const availableSpaces = useMemo(() => {
    if (!floorData) {
      return [];
    }

    return floorData.spaces.filter((space) => {
      return (
        !assignedSpaceIds.has(space.id) ||
        space.id === selectedRegion?.assignedSpaceId
      );
    });
  }, [assignedSpaceIds, floorData, selectedRegion]);

  const assignedCount =
    regionData?.regions.filter((region) => region.assignedSpaceId).length ?? 0;

  const unusedCsvCount = floorData
    ? floorData.spaces.length - assignedSpaceIds.size
    : 0;

  function selectRegion(region: FloorRegion): void {
    setSelectedRegionId(region.id);
    setPendingSpaceId(region.assignedSpaceId ?? "");
  }

  function persistAssignments(regions: FloorRegion[]): void {
    const assignments = Object.fromEntries(
      regions.map((region) => [region.id, region.assignedSpaceId]),
    );

    localStorage.setItem(
      assignmentStorageKey,
      JSON.stringify(assignments),
    );
  }

  function saveAssignment(): void {
    if (!regionData || !selectedRegionId || !pendingSpaceId) {
      return;
    }

    const nextRegions = regionData.regions.map((region) => {
      if (region.id !== selectedRegionId) {
        return region;
      }

      return {
        ...region,
        assignedSpaceId: pendingSpaceId,
      };
    });

    setRegionData({ ...regionData, regions: nextRegions });
    persistAssignments(nextRegions);
  }

  function clearAssignment(): void {
    if (!regionData || !selectedRegionId) {
      return;
    }

    const nextRegions = regionData.regions.map((region) => {
      if (region.id !== selectedRegionId) {
        return region;
      }

      return { ...region, assignedSpaceId: null };
    });

    setRegionData({ ...regionData, regions: nextRegions });
    setPendingSpaceId("");
    persistAssignments(nextRegions);
  }

  function exportAssignments(): void {
    if (!regionData) {
      return;
    }

    const blob = new Blob([JSON.stringify(regionData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `floor-${floor}-regions-assigned.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function resetAssignments(): void {
    if (!regionData) {
      return;
    }

    const shouldReset = window.confirm(
      `Clear every room assignment on Floor ${floor}?`,
    );

    if (!shouldReset) {
      return;
    }

    const nextRegions = regionData.regions.map((region) => ({
      ...region,
      assignedSpaceId: null,
    }));

    setRegionData({ ...regionData, regions: nextRegions });
    setSelectedRegionId("");
    setPendingSpaceId("");
    localStorage.removeItem(assignmentStorageKey);
  }

  if (loadError) {
    return (
      <div className="empty-state error-state">
        <h2>Unable to load Floor {floor}</h2>
        <p>{loadError}</p>
      </div>
    );
  }

  if (!floorData || !regionData) {
    return (
      <div className="empty-state">
        Loading the Floor {floor} plan…
      </div>
    );
  }

  const [, , planWidth, planHeight] = regionData.viewBox
    .split(/\s+/)
    .map(Number);

  return (
    <div className="workspace">
      <section className="plan-card">
        <TransformWrapper
          initialScale={1}
          minScale={0.65}
          maxScale={6}
          centerOnInit
          limitToBounds={false}
          doubleClick={{ disabled: true }}
          wheel={{ step: 0.12 }}
          panning={{ excluded: ["region-shape"] }}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <>
              <div className="plan-toolbar">
                <div className="mode-switcher" aria-label="Application mode">
                  <button
                    type="button"
                    className={mode === "assign" ? "active" : ""}
                    onClick={() => setMode("assign")}
                  >
                    Assign spaces
                  </button>
                  <button
                    type="button"
                    className={mode === "inspect" ? "active" : ""}
                    onClick={() => setMode("inspect")}
                  >
                    Inspect
                  </button>
                </div>

                <div className="toolbar-right">
                  <div className="mapping-progress">
                    <strong>{assignedCount}</strong>
                    <span>of {regionData.regions.length} regions assigned</span>
                  </div>

                  <div className="zoom-controls" aria-label="Plan zoom controls">
                    <button
                      type="button"
                      onClick={() => zoomOut()}
                      aria-label="Zoom out"
                    >
                      −
                    </button>
                    <button type="button" onClick={() => resetTransform()}>
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => zoomIn()}
                      aria-label="Zoom in"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              <TransformComponent
                wrapperClass="zoom-wrapper"
                contentClass="zoom-content"
              >
                <svg
                  className="floor-svg"
                  viewBox={regionData.viewBox}
                  role="img"
                  aria-label={`Floor ${floor} selectable lighting commissioning plan`}
                >
                  <image
                    href={regionData.sourcePlan}
                    x="0"
                    y="0"
                    width={planWidth}
                    height={planHeight}
                    preserveAspectRatio="xMidYMid meet"
                    pointerEvents="none"
                  />

                  {regionData.regions.map((region) => {
                    const assignedSpace = region.assignedSpaceId
                      ? spacesById.get(region.assignedSpaceId)
                      : undefined;
                    const visualStatus = assignedSpace?.status ?? "unassigned";
                    const style = STATUS_STYLES[visualStatus];
                    const isSelected = selectedRegionId === region.id;
                    const isHovered = hoveredRegionId === region.id;
                    const [labelX, labelY] = region.centroid;
                    const label = assignedSpace
                      ? assignedSpace.roomNo === "N/A"
                        ? region.label
                        : assignedSpace.roomNo
                      : region.label;

                    return (
                      <g key={region.id}>
                        <polygon
                          className="region-shape"
                          points={pointsToString(region)}
                          fill={style.fill}
                          fillOpacity={isSelected || isHovered ? 0.78 : 0.38}
                          stroke={isSelected ? "#0f172a" : style.stroke}
                          strokeWidth={isSelected || isHovered ? 2.2 : 1}
                          onPointerEnter={() => setHoveredRegionId(region.id)}
                          onPointerLeave={() => setHoveredRegionId(null)}
                          onClick={(event) => {
                            event.stopPropagation();
                            selectRegion(region);
                          }}
                        >
                          <title>
                            {assignedSpace?.displayName ??
                              `${region.label} — unassigned`}
                          </title>
                        </polygon>

                        <text
                          x={labelX}
                          y={labelY}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="region-label"
                          pointerEvents="none"
                        >
                          {label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </TransformComponent>
            </>
          )}
        </TransformWrapper>

        <div className="status-legend">
          {(Object.keys(STATUS_STYLES) as Array<
            keyof typeof STATUS_STYLES
          >).map((status) => (
            <div className="legend-item" key={status}>
              <span
                className="legend-swatch"
                style={{
                  background: STATUS_STYLES[status].fill,
                  borderColor: STATUS_STYLES[status].stroke,
                }}
              />
              <span>{STATUS_STYLES[status].label}</span>
            </div>
          ))}
        </div>
      </section>

      <aside className="side-panel">
        {mode === "assign" ? (
          <AssignmentPanel
            floor={floor}
            selectedRegion={selectedRegion}
            assignedSpace={selectedAssignedSpace}
            pendingSpaceId={pendingSpaceId}
            availableSpaces={availableSpaces}
            unusedCsvCount={unusedCsvCount}
            onPendingSpaceChange={setPendingSpaceId}
            onSave={saveAssignment}
            onClear={clearAssignment}
            onExport={exportAssignments}
            onReset={resetAssignments}
          />
        ) : selectedAssignedSpace ? (
          <InspectionPreview space={selectedAssignedSpace} />
        ) : (
          <div className="empty-side-panel">
            <p className="eyebrow">Inspection mode</p>
            <h2>Select an assigned room</h2>
            <p>
              Click a Floor {floor} room that has already been linked to a CSV
              record.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

interface AssignmentPanelProps {
  floor: FloorId;
  selectedRegion: FloorRegion | undefined;
  assignedSpace: CommissioningSpace | undefined;
  pendingSpaceId: string;
  availableSpaces: CommissioningSpace[];
  unusedCsvCount: number;
  onPendingSpaceChange: (spaceId: string) => void;
  onSave: () => void;
  onClear: () => void;
  onExport: () => void;
  onReset: () => void;
}

function AssignmentPanel({
  floor,
  selectedRegion,
  assignedSpace,
  pendingSpaceId,
  availableSpaces,
  unusedCsvCount,
  onPendingSpaceChange,
  onSave,
  onClear,
  onExport,
  onReset,
}: AssignmentPanelProps) {
  return (
    <>
      <div className="panel-heading">
        <p className="eyebrow">Floor {floor} assignment</p>
        <h2>Link drawing spaces to CSV rooms</h2>
        <p>
          Click a prepared region on the plan, then choose its corresponding CSV
          record.
        </p>
      </div>

      {selectedRegion ? (
        <>
          <div className="selected-space-card">
            <div className="selected-space-header">
              <div>
                <p className="room-number">{selectedRegion.label}</p>
                <h3>
                  {assignedSpace?.displayName ?? "No CSV room assigned"}
                </h3>
              </div>
              <span
                className={
                  assignedSpace ? "mapping-badge mapped" : "mapping-badge"
                }
              >
                {assignedSpace ? "Assigned" : "Unassigned"}
              </span>
            </div>
          </div>

          <label className="form-field">
            <span>CSV room or space</span>
            <select
              value={pendingSpaceId}
              onChange={(event) => onPendingSpaceChange(event.target.value)}
            >
              <option value="">Choose a CSV room…</option>
              {availableSpaces.map((space) => (
                <option value={space.id} key={space.id}>
                  {space.displayName}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="primary-button full-width"
            disabled={!pendingSpaceId}
            onClick={onSave}
          >
            Save assignment
          </button>

          {assignedSpace && (
            <button
              type="button"
              className="text-danger-button"
              onClick={onClear}
            >
              Clear this assignment
            </button>
          )}
        </>
      ) : (
        <div className="panel-message">
          Select one of the shaded regions on the plan to begin.
        </div>
      )}

      <div className="assignment-summary">
        <span>CSV records not yet used</span>
        <strong>{unusedCsvCount}</strong>
      </div>

      <div className="panel-divider" />

      <div className="data-actions">
        <button type="button" className="secondary-button" onClick={onExport}>
          Export Floor {floor} assignments
        </button>
        <button type="button" className="secondary-button" onClick={onReset}>
          Reset Floor {floor} assignments
        </button>
      </div>
    </>
  );
}

function InspectionPreview({ space }: { space: CommissioningSpace }) {
  return (
    <>
      <div className="panel-heading">
        <p className="eyebrow">Floor {space.floor} inspection</p>
        <h2>{space.roomNo}</h2>
        <p>{space.spaceType}</p>
      </div>

      <div className="inspection-status">
        <span>Status</span>
        <strong>{STATUS_STYLES[space.status].label}</strong>
      </div>

      <div className="expected-items">
        <h3>Expected devices</h3>
        {space.items.map((item) => (
          <div className="expected-item" key={item.id}>
            <div>
              <strong>{item.deviceType}</strong>
              <span className="item-category">{item.category}</span>
            </div>
            <span>
              {item.expectedQty === null
                ? "Quantity not specified"
                : `Expected: ${item.expectedQty}`}
            </span>
          </div>
        ))}
      </div>

      <div className="panel-message">
        The full field checklist is the next phase.
      </div>
    </>
  );
}
