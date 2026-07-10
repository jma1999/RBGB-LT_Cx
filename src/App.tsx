import FloorPlan from "./components/FloorPlan";
import "./App.css";

export default function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">
            Internal commissioning tool
          </p>
          <h1>Lighting Commissioning</h1>
          <p className="header-description">
            Map spaces, verify fixtures and document
            commissioning results.
          </p>
        </div>

        <div
          className="floor-selector"
          aria-label="Floor selection"
        >
          <button type="button" disabled>
            Floor 03
          </button>

          <button type="button" className="active">
            Floor 04
          </button>
        </div>
      </header>

      <FloorPlan />
    </main>
  );
}