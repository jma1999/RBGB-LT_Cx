import { useEffect, useState } from "react";
import FloorPlan, {
  type FloorId,
} from "./components/FloorPlan";
import {
  connectGoogleSheets,
  disconnectGoogleSheets,
  initializeGoogleSheets,
  type GoogleUser,
} from "./services/googleSheets";
import "./App.css";

type AuthStatus = "initializing" | "disconnected" | "connecting" | "connected" | "error";

export default function App() {
  const [selectedFloor, setSelectedFloor] = useState<FloorId>("04");
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("initializing");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    async function prepareGoogle(): Promise<void> {
      try {
        await initializeGoogleSheets();
        setAuthStatus("disconnected");
      } catch (error) {
        setAuthStatus("error");
        setAuthError(
          error instanceof Error
            ? error.message
            : "Google Sheets could not be initialized.",
        );
      }
    }

    void prepareGoogle();
  }, []);

  async function handleConnectGoogle(): Promise<void> {
    setAuthStatus("connecting");
    setAuthError("");

    try {
      const user = await connectGoogleSheets();
      setGoogleUser(user);
      setAuthStatus("connected");
    } catch (error) {
      setGoogleUser(null);
      setAuthStatus("error");
      setAuthError(
        error instanceof Error
          ? error.message
          : "Google Sheets authorization was not completed.",
      );
    }
  }

  function handleDisconnectGoogle(): void {
    disconnectGoogleSheets();
    setGoogleUser(null);
    setAuthStatus("disconnected");
    setAuthError("");
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="header-copy">
          <p className="eyebrow">RBGB Internal Tool</p>
          <h1>Cx-LT</h1>
          <p className="header-description">
            Map spaces, verify fixtures and document commissioning results.
          </p>
        </div>

        <div className="header-actions">
          {googleUser ? (
            <div className="google-account-card">
              <div>
                <span>Google Sheets connected</span>
                <strong>{googleUser.email}</strong>
              </div>

              <button
                type="button"
                onClick={handleDisconnectGoogle}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="google-connect-wrap">
              <button
                type="button"
                className="google-connect-button"
                onClick={() => void handleConnectGoogle()}
                disabled={
                  authStatus === "initializing" ||
                  authStatus === "connecting"
                }
              >
                {authStatus === "initializing"
                  ? "Loading Google…"
                  : authStatus === "connecting"
                    ? "Connecting…"
                    : "Connect Google Sheets"}
              </button>

              {authError && (
                <span className="auth-error">
                  {authError}
                </span>
              )}
            </div>
          )}

          <div className="floor-selector">
            <button
              type="button"
              className={selectedFloor === "03" ? "active" : ""}
              onClick={() => setSelectedFloor("03")}
            >
              Floor 03
            </button>

            <button
              type="button"
              className={selectedFloor === "04" ? "active" : ""}
              onClick={() => setSelectedFloor("04")}
            >
              Floor 04
            </button>
          </div>
        </div>
      </header>

      <FloorPlan
        key={`${selectedFloor}-${googleUser?.email ?? "local"}`}
        floor={selectedFloor}
        googleUser={googleUser}
        onConnectGoogle={() => void handleConnectGoogle()}
      />
    </main>
  );
}
