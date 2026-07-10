import { useState } from "react";
import FloorPlan, {
  type FloorId,
} from "./components/FloorPlan";
import "./App.css";

export default function App() {
  const [selectedFloor, setSelectedFloor] = useState<FloorId>("04");

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Internal commissioning tool</p>
          <h1>Lighting Commissioning</h1>
          <p className="header-description">
            Map spaces, verify fixtures and document commissioning results.
          </p>
        </div>

        <div className="floor-selector" aria-label="Floor selection">
          <button
            type="button"
            className={selectedFloor === "03" ? "active" : ""}
            aria-pressed={selectedFloor === "03"}
            onClick={() => setSelectedFloor("03")}
          >
            Floor 03
          </button>

          <button
            type="button"
            className={selectedFloor === "04" ? "active" : ""}
            aria-pressed={selectedFloor === "04"}
            onClick={() => setSelectedFloor("04")}
          >
            Floor 04
          </button>
        </div>
      </header>

      <FloorPlan key={selectedFloor} floor={selectedFloor} />
    </main>
  );
}
