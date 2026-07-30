// Tiny API client used by the whole frontend to talk to the backend.
// Built on the browser's built-in fetch (no extra dependency). It:
//   * prefixes every call with the API base URL (from .env)
//   * attaches the saved JWT as an Authorization header
//   * parses JSON and throws a readable Error on non-2xx responses
//
// useFleetData.js and AuthContext.jsx call get/post/put/del from here rather
// than calling fetch directly, so auth headers and error handling live in one
// place.

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const TOKEN_KEY = "fleetopz:token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // 204 No Content (e.g. successful DELETE) has no body to parse.
  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    // no/invalid JSON body — leave data as null
  }

  if (!res.ok) {
    const message = (data && data.message) || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  put: (path, body) => request("PUT", path, body),
  del: (path) => request("DELETE", path),
};

export default api;
