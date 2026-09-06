import React from "react";
import ReactDOM from "react-dom/client";
import FleetOpzApp from "./FleetOpzApp";
import InvestorPortal from "./InvestorPortal";
import Login from "./Login";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { C } from "./theme";
import "./index.css";
import "./App.css";

// Decides what to render based on auth state: a brief loading screen while we
// check for a saved session, the Login screen if nobody is signed in, or the
// full app once a user is authenticated.
function Root() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, color: C.textMuted, fontFamily: "system-ui, sans-serif" }}>
        Loading…
      </div>
    );
  }

  if (!user) return <Login />;

  // An investor gets their own screen, not the fleet app with parts hidden.
  // The API refuses an investor account every business endpoint, so mounting
  // FleetOpzApp for them would only produce a wall of 403s.
  if (String(user.role).toLowerCase() === "investor") return <InvestorPortal />;

  return <FleetOpzApp />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </React.StrictMode>
);
