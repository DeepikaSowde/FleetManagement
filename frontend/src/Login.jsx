// Login screen. Shown by main.jsx whenever no user is logged in.
// This is an internal admin/staff tool — there is no public self-registration.
// New users are created by an admin from Settings → Add User.
import { useState } from "react";
import { C } from "./theme";
import { useAuth } from "./context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    width: "100%", padding: "11px 13px", borderRadius: 9, border: `1px solid ${C.border}`,
    fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
    background: C.surface, color: C.textPri, marginTop: 6,
  };
  const labelStyle = { fontSize: 11, fontWeight: 600, color: C.textSec, display: "block" };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380, background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, padding: "32px 28px", boxShadow: "0 10px 40px rgba(0,0,0,0.08)" }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <div style={{ width: 36, height: 36, background: C.teal, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚗</div>
          <div>
            <div style={{ color: C.navy, fontWeight: 700, fontSize: 17, letterSpacing: -0.3 }}>FleetOpz</div>
            <div style={{ color: C.tealLight, fontSize: 9.5, fontWeight: 500, letterSpacing: 1.5, textTransform: "uppercase" }}>Car Rental SaaS</div>
          </div>
        </div>

        <h1 style={{ fontSize: 18, fontWeight: 700, color: C.textPri, margin: "0 0 4px" }}>Welcome back</h1>
        <p style={{ fontSize: 12.5, color: C.textMuted, margin: "0 0 22px" }}>Sign in to manage your fleet.</p>

        <form onSubmit={handleSubmit}>
          <label style={{ display: "block", marginBottom: 14 }}>
            <span style={labelStyle}>Username</span>
            <input style={inputStyle} type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. admin" required autoCapitalize="none" autoCorrect="off" />
          </label>
          <label style={{ display: "block", marginBottom: 18 }}>
            <span style={labelStyle}>Password</span>
            <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </label>

          {error && (
            <div style={{ background: C.redFaint, color: C.red, fontSize: 12, padding: "9px 12px", borderRadius: 8, marginBottom: 16 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={busy}
            style={{ width: "100%", padding: "12px", borderRadius: 9, border: "none", background: C.teal, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
            {busy ? "Please wait…" : "Sign in"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 18, fontSize: 11.5, color: C.textMuted }}>
          Accounts are created by an administrator.
        </p>
      </div>
    </div>
  );
}
