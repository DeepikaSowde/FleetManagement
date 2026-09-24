// Shared validation for user create/update. The frontend mirrors these rules
// for instant feedback (frontend/src/userValidation.js) but this is the
// authority — every check here runs server-side regardless of the client.

const NAME_RE = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_.]{2,29}$/;

// Collapses runs of whitespace and trims, so "  John   Smith " -> "John Smith".
const normalizeName = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const normalizeUsername = (v) => String(v ?? "").trim();

function validateName(raw) {
  const name = normalizeName(raw);
  if (!name) return { error: "Full name is required." };
  if (!NAME_RE.test(name)) return { error: "Full name can contain only letters and spaces." };
  if (name.length > 120) return { error: "Full name must be 120 characters or fewer." };
  return { value: name };
}

function validateUsername(raw) {
  const username = normalizeUsername(raw);
  if (!username) return { error: "Username is required." };
  if (username.length < 3) return { error: "Username must be at least 3 characters." };
  if (username.length > 30) return { error: "Username must be 30 characters or fewer." };
  if (!/^[A-Za-z]/.test(username)) return { error: "Username must start with a letter." };
  if (!USERNAME_RE.test(username)) return { error: "Username can contain only letters, numbers, _ and . (no spaces)." };
  return { value: username };
}

// Special characters are recommended, not required: the app has no earlier
// password policy to inherit, so the enforced floor is length + mixed case +
// a digit.
function validatePassword(raw) {
  const password = String(raw ?? "");
  if (!password) return { error: "Password is required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  // bcrypt silently ignores everything past 72 bytes.
  if (Buffer.byteLength(password, "utf8") > 72) return { error: "Password must be 72 bytes or fewer." };
  if (!/[A-Z]/.test(password)) return { error: "Password must contain at least one uppercase letter." };
  if (!/[a-z]/.test(password)) return { error: "Password must contain at least one lowercase letter." };
  if (!/[0-9]/.test(password)) return { error: "Password must contain at least one number." };
  return { value: password };
}

const ROLES = ["admin", "staff", "investor"];
function validateRole(raw) {
  const role = String(raw ?? "").trim().toLowerCase();
  if (!role) return { error: "Role is required." };
  if (!ROLES.includes(role)) return { error: "Role must be Admin, Staff or Investor." };
  return { value: role };
}

module.exports = { validateName, validateUsername, validatePassword, validateRole, normalizeName, normalizeUsername };
