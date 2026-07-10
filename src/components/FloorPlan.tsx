import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import type {
  CommissioningSpace,
  FloorData,
  Point,
  SpaceStatus,
} from "../types/commissioning";

type AppMode = "map" | "inspect";

const FLOOR_DATA_URL = "/data/floor-04-spaces.json";
const STORAGE_KEY = "lighting-cx-floor-04-data-v1";

const STATUS_STYLES: Record<
  SpaceStatus,
  {
    fill: string;
    stroke: string;
    label: string;
  }
> = {
  unmapped: {
    fill: "#f1f5f9",
    stroke: "#94a3b8",
    label: "Unmapped",
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

function isMapped(space: CommissioningSpace): boolean {
  return space.polygon.length >= 3;
}

function getPolygonCentre(points: Point[]): Point {
  if (points.length === 0) {
    return [0, 0];
  }

  const totals = points.reduce(
    (sum, [x, y]) => {
      return [sum[0] + x, sum[1] + y] as Point;
    },
    [0, 0] as Point,
  );

  return [
    totals[0] / points.length,
    totals[1] / points.length,
  ];
}

function formatQuantity(quantity: number | null): string {
  return quantity === null ? "Quantity not specified" : `Expected: ${quantity}`;
}

export default function FloorPlan() {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [floorData, setFloorData] = useState<FloorData | null>(null);
  const [mode, setMode] = useState<AppMode>("map");
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [hoveredSpaceId, setHoveredSpaceId] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    async function loadFloor(): Promise<void> {
      try {
        const response = await fetch(FLOOR_DATA_URL);

        if (!response.ok) {
          throw new Error("The fourth-floor data file could not be loaded.");
        }

        const originalData = (await response.json()) as FloorData;
        const locallySavedData = localStorage.getItem(STORAGE_KEY);

        if (locallySavedData) {
          try {
            const parsedData = JSON.parse(locallySavedData) as FloorData;

            if (
              parsedData.floor === originalData.floor &&
              Array.isArray(parsedData.spaces)
            ) {
              setFloorData(parsedData);
              return;
            }
          } catch {
            localStorage.removeItem(STORAGE_KEY);
          }
        }

        setFloorData(originalData);
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "The floor data could not be loaded.",
        );
      }
    }

    void loadFloor();
  }, []);

  useEffect(() => {
    if (floorData) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(floorData));
    }
  }, [floorData]);

  const selectedSpace = useMemo(() => {
    return floorData?.spaces.find(
      (space) => space.id === selectedSpaceId,
    );
  }, [floorData, selectedSpaceId]);

  const mappedCount = useMemo(() => {
    return floorData?.spaces.filter(isMapped).length ?? 0;
  }, [floorData]);

  function changeMode(nextMode: AppMode): void {
    setMode(nextMode);
    setDraftPoints([]);
  }

  function handleCanvasClick(
    event: ReactMouseEvent<SVGSVGElement>,
  ): void {
    if (mode !== "map" || !selectedSpaceId) {
      return;
    }

    const svg = svgRef.current;

    if (!svg) {
      return;
    }

    const screenMatrix = svg.getScreenCTM();

    if (!screenMatrix) {
      return;
    }

    const svgPoint = svg.createSVGPoint();
    svgPoint.x = event.clientX;
    svgPoint.y = event.clientY;

    const transformedPoint = svgPoint.matrixTransform(
      screenMatrix.inverse(),
    );

    const newPoint: Point = [
      Math.round(transformedPoint.x * 10) / 10,
      Math.round(transformedPoint.y * 10) / 10,
    ];

    setDraftPoints((currentPoints) => [
      ...currentPoints,
      newPoint,
    ]);
  }

  function handleSpaceClick(
    event: ReactMouseEvent<SVGPolygonElement>,
    spaceId: string,
  ): void {
    event.stopPropagation();
    setSelectedSpaceId(spaceId);
    setDraftPoints([]);
  }

  function saveBoundary(): void {
    if (!floorData || !selectedSpaceId || draftPoints.length < 3) {
      return;
    }

    setFloorData({
      ...floorData,
      spaces: floorData.spaces.map((space) => {
        if (space.id !== selectedSpaceId) {
          return space;
        }

        return {
          ...space,
          polygon: draftPoints,
          status:
            space.status === "unmapped"
              ? "not_inspected"
              : space.status,
        };
      }),
    });

    setDraftPoints([]);
  }

  function undoLastPoint(): void {
    setDraftPoints((currentPoints) =>
      currentPoints.slice(0, -1),
    );
  }

  function cancelDraft(): void {
    setDraftPoints([]);
  }

  function removeSelectedBoundary(): void {
    if (!floorData || !selectedSpaceId || !selectedSpace) {
      return;
    }

    const shouldRemove = window.confirm(
      `Remove the saved boundary for ${selectedSpace.displayName}?`,
    );

    if (!shouldRemove) {
      return;
    }

    setFloorData({
      ...floorData,
      spaces: floorData.spaces.map((space) => {
        if (space.id !== selectedSpaceId) {
          return space;
        }

        return {
          ...space,
          polygon: [],
        };
      }),
    });

    setDraftPoints([]);
  }

  function exportMappedData(): void {
    if (!floorData) {
      return;
    }

    const jsonText = JSON.stringify(floorData, null, 2);
    const blob = new Blob([jsonText], {
      type: "application/json",
    });

    const downloadUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");

    downloadLink.href = downloadUrl;
    downloadLink.download = "floor-04-spaces-mapped.json";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();

    URL.revokeObjectURL(downloadUrl);
  }

  async function resetAllMapping(): Promise<void> {
    const shouldReset = window.confirm(
      "Remove every saved room boundary and restore the original fourth-floor data?",
    );

    if (!shouldReset) {
      return;
    }

    try {
      const response = await fetch(FLOOR_DATA_URL);

      if (!response.ok) {
        throw new Error("The original floor data could not be restored.");
      }

      const originalData = (await response.json()) as FloorData;

      localStorage.removeItem(STORAGE_KEY);
      setFloorData(originalData);
      setSelectedSpaceId("");
      setDraftPoints([]);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "The original data could not be restored.",
      );
    }
  }

  if (loadError) {
    return (
      <div className="empty-state error-state">
        <h2>Unable to load the floor</h2>
        <p>{loadError}</p>
      </div>
    );
  }

  if (!floorData) {
    return (
      <div className="empty-state">
        <p>Loading the fourth-floor plan…</p>
      </div>
    );
  }

  const [, , planWidth, planHeight] = floorData.plan.viewBox
    .split(/\s+/)
    .map(Number);

  const draftPointString = draftPoints
    .map(([x, y]) => `${x},${y}`)
    .join(" ");

  return (
    <div className="workspace">
      <section className="plan-card">
        <div className="plan-toolbar">
          <div
            className="mode-switcher"
            aria-label="Application mode"
          >
            <button
              type="button"
              className={mode === "map" ? "active" : ""}
              aria-pressed={mode === "map"}
              onClick={() => changeMode("map")}
            >
              Map spaces
            </button>

            <button
              type="button"
              className={mode === "inspect" ? "active" : ""}
              aria-pressed={mode === "inspect"}
              onClick={() => changeMode("inspect")}
            >
              Inspect
            </button>
          </div>

          <div className="mapping-progress">
            <strong>{mappedCount}</strong>
            <span>of {floorData.spaces.length} spaces mapped</span>
          </div>
        </div>

        <div className="plan-scroll-area">
          <svg
            ref={svgRef}
            viewBox={floorData.plan.viewBox}
            role="img"
            aria-label={`Floor ${floorData.floor} lighting commissioning plan`}
            onClick={handleCanvasClick}
            className={mode === "map" ? "mapping-cursor" : ""}
          >
            <image
              href={floorData.plan.file}
              x="0"
              y="0"
              width={planWidth}
              height={planHeight}
              preserveAspectRatio="xMidYMid meet"
              pointerEvents="none"
            />

            {floorData.spaces
              .filter(isMapped)
              .map((space) => {
                const statusStyle =
                  STATUS_STYLES[space.status];
                const points = space.polygon
                  .map(([x, y]) => `${x},${y}`)
                  .join(" ");

                const isHovered =
                  hoveredSpaceId === space.id;
                const isSelected =
                  selectedSpaceId === space.id;

                const [labelX, labelY] =
                  getPolygonCentre(space.polygon);

                return (
                  <g key={space.id}>
                    <polygon
                      points={points}
                      fill={statusStyle.fill}
                      fillOpacity={
                        isHovered || isSelected ? 0.8 : 0.55
                      }
                      stroke={statusStyle.stroke}
                      strokeWidth={
                        isHovered || isSelected ? 2.4 : 1.2
                      }
                      onPointerEnter={() =>
                        setHoveredSpaceId(space.id)
                      }
                      onPointerLeave={() =>
                        setHoveredSpaceId(null)
                      }
                      onClick={(event) =>
                        handleSpaceClick(event, space.id)
                      }
                      className="room-polygon"
                    >
                      <title>
                        {space.displayName} —{" "}
                        {statusStyle.label}
                      </title>
                    </polygon>

                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="room-label"
                      pointerEvents="none"
                    >
                      {space.roomNo}
                    </text>
                  </g>
                );
              })}

            {mode === "map" && draftPoints.length >= 3 && (
              <polygon
                points={draftPointString}
                className="draft-polygon"
                pointerEvents="none"
              />
            )}

            {mode === "map" && draftPoints.length >= 2 && (
              <polyline
                points={draftPointString}
                className="draft-line"
                pointerEvents="none"
              />
            )}

            {mode === "map" &&
              draftPoints.map(([x, y], index) => (
                <circle
                  key={`${x}-${y}-${index}`}
                  cx={x}
                  cy={y}
                  r={index === 0 ? 4.5 : 3.3}
                  className={
                    index === 0
                      ? "draft-point first-point"
                      : "draft-point"
                  }
                  pointerEvents="none"
                />
              ))}
          </svg>
        </div>

        <div className="status-legend">
          {(
            [
              "not_inspected",
              "in_progress",
              "passed",
              "issue",
            ] as SpaceStatus[]
          ).map((status) => (
            <div className="legend-item" key={status}>
              <span
                className="legend-swatch"
                style={{
                  background: STATUS_STYLES[status].fill,
                  borderColor:
                    STATUS_STYLES[status].stroke,
                }}
              />
              <span>{STATUS_STYLES[status].label}</span>
            </div>
          ))}
        </div>
      </section>

      <aside className="side-panel">
        {mode === "map" ? (
          <>
            <div className="panel-heading">
              <p className="eyebrow">Setup mode</p>
              <h2>Map room boundaries</h2>
              <p>
                Select a space, then click around its
                boundary on the plan.
              </p>
            </div>

            <label className="form-field">
              <span>Select a CSV space</span>

              <select
                value={selectedSpaceId}
                onChange={(event) => {
                  setSelectedSpaceId(event.target.value);
                  setDraftPoints([]);
                }}
              >
                <option value="">Choose a space…</option>

                {floorData.spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {isMapped(space) ? "✓ " : ""}
                    {space.displayName}
                  </option>
                ))}
              </select>
            </label>

            {selectedSpace ? (
              <div className="selected-space-card">
                <div className="selected-space-header">
                  <div>
                    <p className="room-number">
                      {selectedSpace.roomNo}
                    </p>
                    <h3>{selectedSpace.spaceType}</h3>
                  </div>

                  <span
                    className={
                      isMapped(selectedSpace)
                        ? "mapping-badge mapped"
                        : "mapping-badge"
                    }
                  >
                    {isMapped(selectedSpace)
                      ? "Mapped"
                      : "Not mapped"}
                  </span>
                </div>

                <div className="device-summary">
                  <span>
                    {
                      selectedSpace.items.filter(
                        (item) =>
                          item.category === "lighting",
                      ).length
                    }{" "}
                    lighting types
                  </span>

                  <span>
                    {
                      selectedSpace.items.filter(
                        (item) =>
                          item.category === "control",
                      ).length
                    }{" "}
                    control types
                  </span>
                </div>
              </div>
            ) : (
              <div className="panel-message">
                Select a room before drawing.
              </div>
            )}

            <div className="drawing-instructions">
              <h3>Drawing the boundary</h3>
              <p>
                Click each corner of the room. Use enough
                points to follow irregular room shapes.
              </p>

              <div className="point-count">
                <span>Boundary points</span>
                <strong>{draftPoints.length}</strong>
              </div>
            </div>

            <div className="button-grid">
              <button
                type="button"
                className="secondary-button"
                onClick={undoLastPoint}
                disabled={draftPoints.length === 0}
              >
                Undo point
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={cancelDraft}
                disabled={draftPoints.length === 0}
              >
                Cancel drawing
              </button>

              <button
                type="button"
                className="primary-button full-width"
                onClick={saveBoundary}
                disabled={
                  !selectedSpaceId ||
                  draftPoints.length < 3
                }
              >
                Save room boundary
              </button>
            </div>

            {selectedSpace &&
              isMapped(selectedSpace) && (
                <button
                  type="button"
                  className="text-danger-button"
                  onClick={removeSelectedBoundary}
                >
                  Remove saved boundary
                </button>
              )}

            <div className="panel-divider" />

            <div className="data-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={exportMappedData}
              >
                Export mapped JSON
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() => void resetAllMapping()}
              >
                Reset all mapping
              </button>
            </div>
          </>
        ) : selectedSpace ? (
          <>
            <div className="panel-heading">
              <p className="eyebrow">Inspection mode</p>
              <h2>{selectedSpace.roomNo}</h2>
              <p>{selectedSpace.spaceType}</p>
            </div>

            <div className="inspection-status">
              <span>Status</span>
              <strong>
                {
                  STATUS_STYLES[selectedSpace.status]
                    .label
                }
              </strong>
            </div>

            <div className="expected-items">
              <h3>Expected devices</h3>

              {selectedSpace.items.map((item) => (
                <div
                  className="expected-item"
                  key={item.id}
                >
                  <div>
                    <strong>{item.deviceType}</strong>
                    <span className="item-category">
                      {item.category}
                    </span>
                  </div>

                  <span>
                    {formatQuantity(item.expectedQty)}
                  </span>
                </div>
              ))}
            </div>

            <div className="panel-message">
              The interactive inspection checklist will be
              added in the next step.
            </div>
          </>
        ) : (
          <div className="empty-side-panel">
            <p className="eyebrow">Inspection mode</p>
            <h2>Select a mapped space</h2>
            <p>
              Click a room on the floor plan to view its
              expected fixtures and controls.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}