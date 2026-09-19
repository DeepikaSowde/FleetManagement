// Single shared Year/date-year validation rule for the whole app — every
// screen that takes a plain Year (Add Car, Edit Vehicle, and any future one)
// or a calendar date (Booking, Investors, Finance, Customers, Ownership,
// Today's Operations, ...) imports from here instead of writing its own
// regex, so "Year must be exactly 4 digits" means the same thing and is
// enforced the same way everywhere.

export const YEAR_RE = /^\d{4}$/;
export const YEAR_ERROR = "Year must be exactly 4 digits.";

// A sane calendar range for every native <input type="date"> in the app —
// wide enough for a purchase date, a birth date, a booking, or a company
// valuation, but narrow enough that the year segment can never render or
// accept anything other than exactly 4 digits, whether the user picks a
// date from the calendar widget or types it directly. Add as `min`/`max` to
// a date input that doesn't already have its own more specific bound (e.g.
// "not a future birth date") — never loosen an existing, more specific one.
export const DATE_MIN = "1900-01-01";
export const DATE_MAX = "2099-12-31";

// Live-typing filter for a plain Year input: strips anything that isn't a
// digit and caps the result at 4 characters, so a letter, symbol, space,
// minus sign, decimal point, or a 5th+ digit can never land in the field —
// matches how Add Car / Edit Vehicle have always filtered this field.
export const sanitizeYearDigits = (raw) => String(raw ?? "").replace(/\D/g, "").slice(0, 4);

// Full-value format check for Save/Submit — returns the shared error message
// for anything that isn't exactly 4 digits (empty, "2", "20", "202", or,
// defensively, anything longer than 4 digits), or null when it's valid.
// Callers keep their own "required" and business-rule checks (e.g. "not a
// future year") separate — this only ever answers "is this 4 digits".
export const getYearFormatError = (value) => {
  const v = String(value ?? "").trim();
  return YEAR_RE.test(v) ? null : YEAR_ERROR;
};

// Defensive check for a native <input type="date"> value ("YYYY-MM-DD") —
// the DATE_MIN/DATE_MAX bounds above already keep a picker or typed value
// inside a sane 4-digit year, but anything that reaches this check with a
// malformed year (e.g. imported/legacy data) is rejected the same way
// rather than silently accepted.
export const getDateYearError = (value) => {
  if (!value) return null; // an empty date is a separate "required" concern
  const yearPart = String(value).split("-")[0];
  return YEAR_RE.test(yearPart) ? null : YEAR_ERROR;
};
