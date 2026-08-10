// Login screen with updated UI theme. Logic remains unchanged.
import { useState } from "react";
import { C } from "./theme";
import { useAuth } from "./context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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

  const inputWrapStyle = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    height: 48,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    boxSizing: "border-box",
    marginTop: 8,
    transition: "border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease",
  };
  const inputStyle = {
    flex: 1,
    border: "none",
    outline: "none",
    fontSize: 14,
    fontFamily: "inherit",
    background: "transparent",
    color: C.textPri,
    minWidth: 0,
    height: "100%",
  };
  const labelStyle = { fontSize: 13, fontWeight: 700, color: C.textPri, display: "block" };
  const iconColor = "#94a3b8";

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        background: C.bg,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @media (max-width: 860px) {
          .login-left-panel { display: none !important; }
          .login-right-panel { flex: 1 1 100% !important; }
        }
        .fo-input-wrap:focus-within {
          border-color: #16a34a !important;
          background: #ffffff !important;
          box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.1) !important;
        }
        .fo-signin-btn {
          transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
        }
        .fo-signin-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.05);
          box-shadow: 0 12px 28px rgba(15, 118, 110, 0.32);
        }
        .fo-signin-btn:active:not(:disabled) {
          transform: translateY(0);
        }
        .fo-link:hover {
          text-decoration: underline !important;
        }
        .fo-card {
          animation: fo-float-in 0.5s ease;
        }
        @keyframes fo-float-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fo-float-img {
          animation: fo-float 4.5s ease-in-out infinite;
        }
        @keyframes fo-float {
          0%, 100% { transform: translateY(0px) scale(1.08); }
          50% { transform: translateY(-10px) scale(1.08); }
        }
      `}</style>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* LEFT PANEL — 45% width */}
        <div
          className="login-left-panel"
          style={{
            flex: "1 1 45%",
            position: "relative",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            background: "#f7fbfa",
            overflow: "hidden",
          }}
        >
          {/* Abstract decorative gradient circles */}
          <div
            style={{
              position: "absolute",
              top: "-8%",
              right: "-6%",
              width: 320,
              height: 320,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(22,163,74,0.10) 0%, rgba(22,163,74,0) 70%)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "22%",
              left: "-10%",
              width: 260,
              height: 260,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(15,118,110,0.08) 0%, rgba(15,118,110,0) 70%)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "-10%",
              right: "8%",
              width: 220,
              height: 220,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(22,163,74,0.07) 0%, rgba(22,163,74,0) 70%)",
              pointerEvents: "none",
            }}
          />

          {/* Text block */}
          <div
            style={{
              position: "relative",
              zIndex: 1,
              flex: "0 0 auto",
              padding: "5.5% 6% 1%",
              boxSizing: "border-box",
            }}
          >
            {/* Brand */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: "9%" }}>
              {/* Logo placeholder — replace src with your logo file */}
              <img
                src="/logo.png"
                alt="FleetOPZ logo"
                style={{
                  width: 50,
                  height: 50,
                  objectFit: "contain",
                  flexShrink: 0,
                }}
              />
              <div>
                <div
                  style={{
                    color: C.navy,
                    fontWeight: 800,
                    fontSize: 25,
                    letterSpacing: -0.6,
                    lineHeight: 1.05,
                  }}
                >
                  Fleet<span style={{ color: "#16a34a", fontWeight: 800 }}>OPZ</span>
                </div>
                <div
                  style={{
                    color: "#94a3b8",
                    fontSize: 11.5,
                    fontWeight: 700,
                    marginTop: 5,
                    letterSpacing: 1.6,
                    textTransform: "uppercase",
                  }}
                >
                  Fleet Management System
                </div>
              </div>
            </div>

            {/* Headline */}
            <h1
              style={{
                fontSize: "clamp(30px, 3.4vw, 54px)",
                fontWeight: 900,
                color: C.navy,
                margin: 0,
                lineHeight: 1.08,
                letterSpacing: "-1.5px",
              }}
            >
              Manage Your Fleet
              <br />
              <span
                style={{
                  background: "linear-gradient(135deg, #0f766e 0%, #16a34a 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Smarter
              </span>
            </h1>

            <p
              style={{
                fontSize: 16.5,
                fontWeight: 400,
                color: "#6b7785",
                maxWidth: 380,
                marginTop: 22,
                lineHeight: 1.75,
                letterSpacing: "-0.1px",
              }}
            >
              A powerful and flexible platform to manage your vehicles, bookings, drivers,
              maintenance and business operations efficiently.
            </p>
          </div>

          {/* Image section — hero illustration, fills remaining space */}
          <div
            style={{
              position: "relative",
              zIndex: 1,
              flex: "1 1 auto",
              minHeight: 0,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              overflow: "hidden",
              padding: "0 2% 0",
              boxSizing: "border-box",
            }}
          >
            {/* Soft glow behind illustration */}
            <div
              style={{
                position: "absolute",
                width: "80%",
                height: "80%",
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, rgba(22,163,74,0.14) 0%, rgba(15,118,110,0.06) 45%, rgba(255,255,255,0) 75%)",
                filter: "blur(4px)",
                pointerEvents: "none",
              }}
            />
            <img
              src="/Fleet-illustration.png"
              alt="Fleet illustration"
              className="fo-float-img"
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: "block",
              }}
            />
          </div>
        </div>

        {/* RIGHT PANEL — 55% width */}
        <div
          className="login-right-panel"
          style={{
            flex: "1 1 55%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "3%",
            boxSizing: "border-box",
            background: "#fff",
          }}
        >
          {/* Floating card */}
          <div
            className="fo-card"
            style={{
              width: 440,
              maxWidth: "100%",
              maxHeight: "94vh",
              overflowY: "auto",
              boxSizing: "border-box",
              background: "#ffffff",
              borderRadius: 24,
              border: "1px solid rgba(15, 23, 42, 0.06)",
              boxShadow:
                "0 1px 2px rgba(15,23,42,0.04), 0 24px 48px -12px rgba(15,23,42,0.12), 0 8px 24px -8px rgba(15,23,42,0.08)",
              padding: "44px 44px",
            }}
          >
            {/* Logo placeholder — replace src with your logo file */}
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
              <img
                src="/logo.png"
                alt="FleetOPZ logo"
                style={{ width: 56, height: 56, objectFit: "contain" }}
              />
            </div>

            <h1
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: C.navy,
                margin: "0 0 6px",
                textAlign: "center",
                letterSpacing: -0.3,
              }}
            >
              Welcome Back
            </h1>
            <p style={{ fontSize: 13.5, color: C.textMuted, margin: "0 0 30px", textAlign: "center" }}>
              Sign in to access your account
            </p>

            <form onSubmit={handleSubmit}>
              <label style={{ display: "block", marginBottom: 18 }}>
                <span style={labelStyle}>Username</span>
                <div className="fo-input-wrap" style={inputWrapStyle}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <input
                    style={inputStyle}
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your username"
                    required
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </div>
              </label>

              <label style={{ display: "block", marginBottom: 10 }}>
                <span style={labelStyle}>Password</span>
                <div className="fo-input-wrap" style={inputWrapStyle}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <input
                    style={inputStyle}
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                  />
                  <span onClick={() => setShowPassword((s) => !s)} style={{ cursor: "pointer", display: "flex" }}>
                    {showPassword ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </span>
                </div>
              </label>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "10px 0 24px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.textSec, cursor: "pointer" }}>
                  <input type="checkbox" style={{ margin: 0, width: 15, height: 15, accentColor: "#16a34a" }} />
                  Remember Me
                </label>
                <a href="#" className="fo-link" style={{ fontSize: 13.5, color: "#16a34a", fontWeight: 600, textDecoration: "none" }}>
                  Forgot Password?
                </a>
              </div>

              {error && (
                <div
                  style={{
                    background: C.redFaint,
                    color: C.red,
                    fontSize: 12.5,
                    padding: "10px 12px",
                    borderRadius: 10,
                    marginBottom: 18,
                  }}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="fo-signin-btn"
                style={{
                  width: "100%",
                  height: 52,
                  borderRadius: 14,
                  border: "none",
                  background: "linear-gradient(135deg, #0f766e, #16a34a)",
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.7 : 1,
                  boxShadow: "0 8px 20px rgba(15, 118, 110, 0.25)",
                }}
              >
                {busy ? "Please wait…" : "Sign In"}
              </button>
            </form>

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "26px 0 18px" }}>
              <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
              <span style={{ fontSize: 12, color: C.textMuted }}>or</span>
              <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
              </svg>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.textPri }}>Enterprise Secure</div>
                <div style={{ fontSize: 12, color: C.textMuted }}>256-bit Encryption</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          flexShrink: 0,
          textAlign: "center",
          padding: "12px 0",
          fontSize: 12.5,
          color: C.textMuted,
          borderTop: "1px solid #eef1f0",
          background: "#fff",
        }}
      >
        <a href="#" className="fo-link" style={{ color: C.textMuted, textDecoration: "none" }}>Privacy Policy</a>
        <span style={{ margin: "0 12px", color: "#cbd5e1" }}>•</span>
        <a href="#" className="fo-link" style={{ color: C.textMuted, textDecoration: "none" }}>Terms &amp; Conditions</a>
        <span style={{ margin: "0 12px", color: "#cbd5e1" }}>•</span>
        <a href="#" className="fo-link" style={{ color: C.textMuted, textDecoration: "none" }}>Support</a>
      </div>
    </div>
  );
}
