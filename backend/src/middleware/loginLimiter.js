// Brute-force protection for POST /api/auth/login.
//
// Failed attempts are counted per (username, IP) and, more loosely, per IP
// alone, so both "one account hammered" and "one machine trying many accounts"
// get stopped. After MAX_FAILS failures inside WINDOW_MS the key is locked for
// LOCK_MS and requests get a 429 before any password is checked. A successful
// login clears that key's counter.
//
// In-memory on purpose: this app runs as a single Node process. Counters reset
// on restart, which is acceptable for throttling (not an audit record). If it
// is ever scaled to multiple instances, move this store to Redis/the DB.
const MAX_FAILS = 5;
const IP_MAX_FAILS = 20;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

const entries = new Map(); // key -> { fails, first, lockedUntil }

const clientIp = (req) =>
  req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";

const userKey = (req) => `u:${String(req.body?.username || "").trim().toLowerCase()}|${clientIp(req)}`;
const ipKey = (req) => `i:${clientIp(req)}`;

function lockedFor(key, now) {
  const e = entries.get(key);
  return e && e.lockedUntil > now ? e.lockedUntil - now : 0;
}

function recordFailure(key, max, now) {
  let e = entries.get(key);
  if (!e || now - e.first > WINDOW_MS) e = { fails: 0, first: now, lockedUntil: 0 };
  e.fails += 1;
  if (e.fails >= max) e.lockedUntil = now + LOCK_MS;
  entries.set(key, e);
}

// Runs before the login controller. Blocks locked keys; the controller calls
// req.loginFailed()/req.loginSucceeded() once it knows the outcome.
function loginLimiter(req, res, next) {
  const now = Date.now();
  const wait = Math.max(lockedFor(userKey(req), now), lockedFor(ipKey(req), now));
  if (wait > 0) {
    res.set("Retry-After", String(Math.ceil(wait / 1000)));
    return res.status(429).json({
      message: `Too many failed sign-in attempts. Try again in ${Math.ceil(wait / 60000)} minute(s).`,
    });
  }
  req.loginFailed = () => {
    const t = Date.now();
    recordFailure(userKey(req), MAX_FAILS, t);
    recordFailure(ipKey(req), IP_MAX_FAILS, t);
  };
  req.loginSucceeded = () => entries.delete(userKey(req));
  next();
}

// Drop stale entries so the map can't grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of entries) {
    if (e.lockedUntil < now && now - e.first > WINDOW_MS) entries.delete(k);
  }
}, 10 * 60 * 1000).unref();

module.exports = { loginLimiter };
