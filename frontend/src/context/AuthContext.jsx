// Authentication state for the whole app.
//
// Holds the logged-in user, exposes login/register/logout, and — on first load
// — restores the session from a saved token by asking the backend "who am I?"
// (GET /api/auth/me). main.jsx uses `user` to decide whether to show the Login
// screen or the app.
import { createContext, useContext, useEffect, useState } from "react";
import api, { getToken, setToken, clearToken } from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true until we've checked for a saved session

  // On mount: if a token is saved, verify it and load the user.
  useEffect(() => {
    async function restore() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const { user } = await api.get("/auth/me");
        setUser(user);
      } catch {
        clearToken(); // token missing/expired — force a fresh login
      } finally {
        setLoading(false);
      }
    }
    restore();
  }, []);

  async function login(email, password) {
    const { token, user } = await api.post("/auth/login", { email, password });
    setToken(token);
    setUser(user);
  }

  async function register(name, email, password) {
    const { token, user } = await api.post("/auth/register", { name, email, password });
    setToken(token);
    setUser(user);
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
