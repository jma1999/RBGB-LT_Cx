import { useEffect, useMemo, useState } from "react";
import {
  TransformComponent,
  TransformWrapper,
} from "react-zoom-pan-pinch";

import {
  addComment,
  loadAssignments,
  loadComments,
  upsertAssignment,
  type GoogleUser,
  type SheetComment,
} from "../services/googleSheets";
import type {
  CommissioningSpace,
  FloorData,
  FloorRegion,
  RegionData,
  SpaceStatus,
} from "../types/commissioning";

type AppMode = "assign" | "inspect";
export type FloorId = "03" | "04";
type SyncStatus = "disconnected" | "loading" | "synced" | "saving" | "error";

interface FloorPlanProps {
  floor: FloorId;
  googleUser: GoogleUser | null;
  onConnectGoogle: () => void;
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

function loadCachedAssignments(
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

function cacheAssignments(
  storageKey: string,
  regions: FloorRegion[],
): void {
  const assignments = Object.fromEntries(
    regions.map((region) => [region.id, region.assignedSpaceId]),
  );

  localStorage.setItem(storageKey, JSON.stringify(assignments));
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export default function FloorPlan({
  floor,
  googleUser,
  onConnectGoogle,
}: FloorPlanProps) {
  const floorDataUrl = `/data/floor-${floor}-spaces.json`;
  const regionDataUrl = `/data/floor-${floor}-regions.json`;
  const assignmentStorageKey =
    `lighting-cx-floor-${floor}-region-assignments-v4-cache`;

  const [floorData, setFloorData] = useState<FloorData | null>(null);
  const [regionData, setRegionData] = useState<RegionData | null>(null);
  const [mode, setMode] = useState<AppMode>("assign");
  const [selectedRegionId, setSelectedRegionId] = useState("");
  const [pendingSpaceId, setPendingSpaceId] = useState("");
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(
    null,
  );
  const [loadError, setLoadError] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("disconnected");
  const [syncMessage, setSyncMessage] = useState(
    "Connect Google Sheets to load shared assignments.",
  );
  const [comments, setComments] = useState<SheetComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(false);

  useEffect(() => {
    async function loadData(): Promise<void> {
      setLoadError("");
      setSelectedRegionId("");
      setPendingSpaceId("");
      setComments([]);

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

        const validRegionIds = new Set(
          loadedRegionData.regions.map((region) => region.id),
        );

        const jsonAssignmentsByRegion = new Map<string, string>();

        for (const space of loadedFloorData.spaces) {
          const regionId = space.regionId?.trim();

          if (!regionId) {
            continue;
          }

          if (!validRegionIds.has(regionId)) {
            throw new Error(
              `${space.displayName} references an unknown region: ${regionId}`,
            );
          }

          const existingSpaceId = jsonAssignmentsByRegion.get(regionId);

          if (existingSpaceId) {
            const existingSpace = loadedFloorData.spaces.find(
              (spaceItem) => spaceItem.id === existingSpaceId,
            );

            throw new Error(
              `${regionId} is assigned to both ${
                existingSpace?.displayName ?? existingSpaceId
              } and ${space.displayName}.`,
            );
          }

          jsonAssignmentsByRegion.set(regionId, space.id);
        }

        const cachedAssignments = loadCachedAssignments(
          assignmentStorageKey,
        );

        setFloorData(loadedFloorData);

        setRegionData({
          ...loadedRegionData,
          regions: loadedRegionData.regions.map((region) => {
            const hasCachedAssignment =
              Object.prototype.hasOwnProperty.call(
                cachedAssignments,
                region.id,
              );

            return {
              ...region,
              assignedSpaceId: hasCachedAssignment
                ? cachedAssignments[region.id]
                : jsonAssignmentsByRegion.get(region.id) ??
                  region.assignedSpaceId,
            };
          }),
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

  useEffect(() => {
    if (!googleUser || !regionData) {
      setSyncStatus("disconnected");
      setSyncMessage("Connect Google Sheets to load shared assignments.");
      return;
    }

    let cancelled = false;

    async function syncFromGoogle(): Promise<void> {
      setSyncStatus("loading");
      setSyncMessage("Loading shared assignments from Google Sheets…");

      try {
        const cloudAssignments = await loadAssignments(floor);

        if (cancelled) {
          return;
        }

        const nextRegions = regionData.regions.map((region) => ({
          ...region,
          assignedSpaceId:
            Object.prototype.hasOwnProperty.call(cloudAssignments, region.id)
              ? cloudAssignments[region.id]
              : region.assignedSpaceId,
        }));

        setRegionData({ ...regionData, regions: nextRegions });
        cacheAssignments(assignmentStorageKey, nextRegions);
        setSyncStatus("synced");
        setSyncMessage(`Shared data synced as ${googleUser.email}.`);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setSyncStatus("error");
        setSyncMessage(
          error instanceof Error
            ? error.message
            : "Shared assignments could not be loaded.",
        );
      }
    }

    void syncFromGoogle();

    return () => {
      cancelled = true;
    };
    // Sync once after a floor loads or the Google account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, googleUser?.email, Boolean(regionData)]);

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

  useEffect(() => {
    if (!googleUser || !selectedRegionId) {
      setComments([]);
      return;
    }

    let cancelled = false;

    async function refreshComments(): Promise<void> {
      setCommentsLoading(true);

      try {
        const loadedComments = await loadComments(floor, selectedRegionId);
        if (!cancelled) {
          setComments(loadedComments);
        }
      } catch (error) {
        if (!cancelled) {
          setSyncStatus("error");
          setSyncMessage(
            error instanceof Error
              ? error.message
              : "Comments could not be loaded.",
          );
        }
      } finally {
        if (!cancelled) {
          setCommentsLoading(false);
        }
      }
    }

    void refreshComments();

    return () => {
      cancelled = true;
    };
  }, [floor, googleUser, selectedRegionId]);

  function selectRegion(region: FloorRegion): void {
    setSelectedRegionId(region.id);
    setPendingSpaceId(region.assignedSpaceId ?? "");
    setCommentText("");
  }

  async function saveAssignment(): Promise<void> {
    if (
      !regionData ||
      !selectedRegion ||
      !pendingSpaceId ||
      !googleUser
    ) {
      return;
    }

    const selectedSpace = spacesById.get(pendingSpaceId);

    if (!selectedSpace) {
      setSyncStatus("error");
      setSyncMessage("The selected CSV room could not be found.");
      return;
    }

    setSyncStatus("saving");
    setSyncMessage("Saving assignment to Google Sheets…");

    try {
      await upsertAssignment({
        floor,
        regionId: selectedRegion.id,
        regionLabel: selectedRegion.label,
        spaceId: selectedSpace.id,
        roomNo: selectedSpace.roomNo,
        spaceType: selectedSpace.spaceType,
        updatedBy: googleUser.email,
      });

      const nextRegions = regionData.regions.map((region) =>
        region.id === selectedRegion.id
          ? { ...region, assignedSpaceId: selectedSpace.id }
          : region,
      );

      setRegionData({ ...regionData, regions: nextRegions });
      cacheAssignments(assignmentStorageKey, nextRegions);
      setSyncStatus("synced");
      setSyncMessage("Assignment saved to Google Sheets.");
    } catch (error) {
      setSyncStatus("error");
      setSyncMessage(
        error instanceof Error
          ? error.message
          : "The assignment could not be saved.",
      );
    }
  }

  async function clearAssignment(): Promise<void> {
    if (!regionData || !selectedRegion || !googleUser) {
      return;
    }

    setSyncStatus("saving");
    setSyncMessage("Clearing assignment in Google Sheets…");

    try {
      await upsertAssignment({
        floor,
        regionId: selectedRegion.id,
        regionLabel: selectedRegion.label,
        spaceId: null,
        roomNo: "",
        spaceType: "",
        updatedBy: googleUser.email,
      });

      const nextRegions = regionData.regions.map((region) =>
        region.id === selectedRegion.id
          ? { ...region, assignedSpaceId: null }
          : region,
      );

      setRegionData({ ...regionData, regions: nextRegions });
      setPendingSpaceId("");
      cacheAssignments(assignmentStorageKey, nextRegions);
      setSyncStatus("synced");
      setSyncMessage("Assignment cleared in Google Sheets.");
    } catch (error) {
      setSyncStatus("error");
      setSyncMessage(
        error instanceof Error
          ? error.message
          : "The assignment could not be cleared.",
      );
    }
  }

  async function reloadSharedAssignments(): Promise<void> {
    if (!googleUser || !regionData) {
      onConnectGoogle();
      return;
    }

    setSyncStatus("loading");
    setSyncMessage("Reloading assignments from Google Sheets…");

    try {
      const cloudAssignments = await loadAssignments(floor);
      const nextRegions = regionData.regions.map((region) => ({
        ...region,
        assignedSpaceId:
          Object.prototype.hasOwnProperty.call(cloudAssignments, region.id)
            ? cloudAssignments[region.id]
            : region.assignedSpaceId,
      }));

      setRegionData({ ...regionData, regions: nextRegions });
      cacheAssignments(assignmentStorageKey, nextRegions);
      setSyncStatus("synced");
      setSyncMessage("Latest Google Sheet data loaded.");
    } catch (error) {
      setSyncStatus("error");
      setSyncMessage(
        error instanceof Error
          ? error.message
          : "Shared assignments could not be reloaded.",
      );
    }
  }

  async function submitComment(): Promise<void> {
    const trimmedComment = commentText.trim();

    if (!googleUser || !selectedRegion || !trimmedComment) {
      return;
    }

    setSyncStatus("saving");
    setSyncMessage("Saving comment to Google Sheets…");

    try {
      const savedComment = await addComment({
        floor,
        regionId: selectedRegion.id,
        spaceId: selectedAssignedSpace?.id ?? "",
        roomNo: selectedAssignedSpace?.roomNo ?? "",
        comment: trimmedComment,
        createdBy: googleUser.email,
        category: "General",
      });

      setComments((currentComments) => [savedComment, ...currentComments]);
      setCommentText("");
      setSyncStatus("synced");
      setSyncMessage("Comment saved to Google Sheets.");
    } catch (error) {
      setSyncStatus("error");
      setSyncMessage(
        error instanceof Error
          ? error.message
          : "The comment could not be saved.",
      );
    }
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
                  <div className={`sync-indicator ${syncStatus}`}>
                    <span className="sync-dot" />
                    <span>{syncStatus === "saving" ? "Saving" : syncStatus}</span>
                  </div>

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
        <div className={`cloud-sync-card ${syncStatus}`}>
          <div>
            <strong>Google Sheets</strong>
            <p>{syncMessage}</p>
          </div>
          {!googleUser && (
            <button
              type="button"
              className="secondary-button"
              onClick={onConnectGoogle}
            >
              Connect
            </button>
          )}
        </div>

        {mode === "assign" ? (
          <AssignmentPanel
            floor={floor}
            selectedRegion={selectedRegion}
            assignedSpace={selectedAssignedSpace}
            pendingSpaceId={pendingSpaceId}
            availableSpaces={availableSpaces}
            unusedCsvCount={unusedCsvCount}
            googleConnected={Boolean(googleUser)}
            saving={syncStatus === "saving"}
            comments={comments}
            commentsLoading={commentsLoading}
            commentText={commentText}
            onPendingSpaceChange={setPendingSpaceId}
            onCommentTextChange={setCommentText}
            onSave={() => void saveAssignment()}
            onClear={() => void clearAssignment()}
            onAddComment={() => void submitComment()}
            onExport={exportAssignments}
            onReload={() => void reloadSharedAssignments()}
            onConnect={onConnectGoogle}
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
  googleConnected: boolean;
  saving: boolean;
  comments: SheetComment[];
  commentsLoading: boolean;
  commentText: string;
  onPendingSpaceChange: (spaceId: string) => void;
  onCommentTextChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  onAddComment: () => void;
  onExport: () => void;
  onReload: () => void;
  onConnect: () => void;
}

function AssignmentPanel({
  floor,
  selectedRegion,
  assignedSpace,
  pendingSpaceId,
  availableSpaces,
  unusedCsvCount,
  googleConnected,
  saving,
  comments,
  commentsLoading,
  commentText,
  onPendingSpaceChange,
  onCommentTextChange,
  onSave,
  onClear,
  onAddComment,
  onExport,
  onReload,
  onConnect,
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

      {!googleConnected && (
        <div className="panel-message">
          Shared saving is disabled until Google Sheets is connected.
          <button type="button" className="inline-link-button" onClick={onConnect}>
            Connect now
          </button>
        </div>
      )}

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
            disabled={!pendingSpaceId || !googleConnected || saving}
            onClick={onSave}
          >
            {saving ? "Saving…" : "Save assignment"}
          </button>

          {assignedSpace && (
            <button
              type="button"
              className="text-danger-button"
              disabled={!googleConnected || saving}
              onClick={onClear}
            >
              Clear this assignment
            </button>
          )}

          <section className="comments-section">
            <h3>Comments</h3>
            <textarea
              value={commentText}
              onChange={(event) => onCommentTextChange(event.target.value)}
              placeholder="Add an assignment, access, or field note…"
              rows={3}
              disabled={!googleConnected || saving}
            />
            <button
              type="button"
              className="secondary-button full-width"
              onClick={onAddComment}
              disabled={!commentText.trim() || !googleConnected || saving}
            >
              Save comment
            </button>

            <div className="comments-list">
              {commentsLoading ? (
                <p className="muted-text">Loading comments…</p>
              ) : comments.length === 0 ? (
                <p className="muted-text">No comments for this region.</p>
              ) : (
                comments.map((comment) => (
                  <article className="comment-card" key={comment.commentId}>
                    <p>{comment.comment}</p>
                    <span>
                      {comment.createdBy} · {formatTimestamp(comment.createdAt)}
                    </span>
                  </article>
                ))
              )}
            </div>
          </section>
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
        <button type="button" className="secondary-button" onClick={onReload}>
          Reload from Google Sheets
        </button>
        <button type="button" className="secondary-button" onClick={onExport}>
          Export Floor {floor} assignments
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
        Checklist results and issues will use the same Google Sheet connection in
        the next phase.
      </div>
    </>
  );
}
