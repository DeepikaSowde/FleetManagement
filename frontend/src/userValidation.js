// Client-side mirror of backend/src/utils/userValidation.js — instant feedback
// only. The server re-validates everything and is the authority.
const NAME_RE = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_.]{2,29}$/;

export const normalizeName = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

export function validateName(raw) {
  const name = normalizeName(raw);
  if (!name) return "Full name is required.";
  if (!NAME_RE.test(name)) return "Full name can contain only letters and spaces.";
  if (name.length > 120) return "Full name must be 120 characters or fewer.";
  return "";
}

export function validateUsername(raw) {
  const u = String(raw ?? "").trim();
  if (!u) return "Username is required.";
  if (u.length < 3) return "Username must be at least 3 characters.";
  if (u.length > 30) return "Username must be 30 characters or fewer.";
  if (!/^[A-Za-z]/.test(u)) return "Username must start with a letter.";
  if (!USERNAME_RE.test(u)) return "Username can contain only letters, numbers, _ and . (no spaces).";
  return "";
}

export function validatePassword(raw) {
  const p = String(raw ?? "");
  if (!p) return "Password is required.";
  if (p.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(p)) return "Password must contain at least one uppercase letter.";
  if (!/[a-z]/.test(p)) return "Password must contain at least one lowercase letter.";
  if (!/[0-9]/.test(p)) return "Password must contain at least one number.";
  return "";
}

export const PASSWORD_HINT = "At least 8 characters with an uppercase letter, a lowercase letter and a number. A special character is recommended.";
