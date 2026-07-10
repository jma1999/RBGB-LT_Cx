import { useEffect, useState } from "react";

type SpaceStatus =
  | "unmapped"
  | "not_inspected"
  | "in_progress"
  | "passed"
  | "issue"
  | "not_applicable";

type Point = [number, number];

interface Space {
  id: string;
  roomNo: string;
  spaceType: string;
  displayName: string;
  status: SpaceStatus;
  polygon: Point[];
}

interface FloorData {
  floor: string;
  plan: {
    file: string;
    viewBox: string;
  };
  spaces: Space[];
}

const STATUS_COLORS: Record<SpaceStatus, string> = {
  unmapped: "#D1D5DB",
  not_inspected: "#60A5FA",
  in_progress: "#FBBF24",
  passed: "#34D399",
  issue: "#F87171",
  not_applicable: "#94A3B8",
};

export default function FloorPlan() {
  const [floorData, setFloorData] = useState<FloorData | null>(null);
  const [selectedSpace, setSelectedSpace] = useState<Space | null>(null);
  const [hoveredSpaceId, setHoveredSpaceId] = useState<string | null>(null);

  useEffect(() => {
    async function loadFloorData() {
      const response = await fetch("/data/floor-04-spaces.json");

      if (!response.ok) {
        throw new Error("Unable to load Floor 04 data.");
      }

      const data = (await response.json()) as FloorData;
      setFloorData(data);
    }

    loadFloorData().catch((error: unknown) => {
      console.error(error);
    });
  }, []);

  if (!floorData) {
    return <p>Loading floor plan…</p>;
  }

  return (
    <div className="floor-layout">
      <section className="floor-canvas">
        <svg
          viewBox={floorData.plan.viewBox}
          role="img"
          aria-label={`Floor ${floorData.floor} lighting commissioning plan`}
        >
          <image
            href={floorData.plan.file}
            x="0"
            y="0"
            width="792"
            height="612"
            preserveAspectRatio="xMidYMid meet"
            pointerEvents="none"
          />

          {floorData.spaces
            .filter((space) => space.polygon.length >= 3)
            .map((space) => {
              const points = space.polygon
                .map(([x, y]) => `${x},${y}`)
                .join(" ");

              const isHovered = hoveredSpaceId === space.id;

              return (
                <polygon
                  key={space.id}
                  points={points}
                  fill={STATUS_COLORS[space.status]}
                  fillOpacity={isHovered ? 0.68 : 0.42}
                  stroke={isHovered ? "#111827" : "#FFFFFF"}
                  strokeWidth={isHovered ? 2 : 1}
                  onPointerEnter={() => setHoveredSpaceId(space.id)}
                  onPointerLeave={() => setHoveredSpaceId(null)}
                  onClick={() => setSelectedSpace(space)}
                  style={{ cursor: "pointer" }}
                >
                  <title>{space.displayName}</title>
                </polygon>
              );
            })}
        </svg>
      </section>

      <aside className="space-summary">
        {selectedSpace ? (
          <>
            <p className="eyebrow">Selected space</p>
            <h2>{selectedSpace.roomNo}</h2>
            <p>{selectedSpace.spaceType}</p>
            <p>Status: {selectedSpace.status.replaceAll("_", " ")}</p>
          </>
        ) : (
          <>
            <h2>No space selected</h2>
            <p>Select a mapped space from the plan.</p>
          </>
        )}
      </aside>
    </div>
  );
}