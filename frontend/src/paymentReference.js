// One rule set for the "Transaction ID / Reference Number" field, used by every
// screen that records a payment (booking payment, collect rent at pickup,
// extension payment, daily/monthly collection, security deposit collection,
// refunds/deductions), so the format checks can never differ between them.
//
//   Cash             optional
//   Card             required, 6–30 alphanumeric   e.g. TXN8F72K91
//   Bank Transfer    required, 6–35 alphanumeric   e.g. FT260921A83921  (FAST)
//   PayNow           required, 6–35 alphanumeric   e.g. PN260921783452
//   Payment Gateway  required, 6–50 alphanumeric   e.g. pi_3ABC82X91K
//
// The gateway example contains "_", which is why Payment Gateway (and only
// that method) also accepts underscores and hyphens — those are part of real
// gateway ids (Stripe pi_…, etc.). Every other method is strictly A–Z/0–9.

export const REFERENCE_LABEL = "Transaction ID / Reference Number";

const ALNUM = /^[A-Za-z0-9]+$/;
const GATEWAY = /^[A-Za-z0-9_-]+$/;

const RULES = {
  Card: { min: 6, max: 30, pattern: ALNUM, example: "TXN8F72K91", chars: "letters and numbers" },
  "Bank Transfer": { min: 6, max: 35, pattern: ALNUM, example: "FT260921A83921", chars: "letters and numbers" },
  PayNow: { min: 6, max: 35, pattern: ALNUM, example: "PN260921783452", chars: "letters and numbers" },
  "Payment Gateway": { min: 6, max: 50, pattern: GATEWAY, example: "pi_3ABC82X91K", chars: "letters, numbers, _ and -" },
};
const FALLBACK = { min: 6, max: 35, pattern: ALNUM, example: "", chars: "letters and numbers" };
const CASH_MAX = 50;

export const isCash = (method) => !method || String(method).trim().toLowerCase() === "cash";
const ruleFor = (method) => RULES[String(method || "").trim()] || FALLBACK;

// Returns "" when valid, otherwise the message to show next to the field.
export function validatePaymentReference(method, value) {
  const v = String(value ?? "").trim();
  if (isCash(method)) {
    if (v.length > CASH_MAX) return `Reference Number must be ${CASH_MAX} characters or fewer.`;
    return "";
  }
  const r = ruleFor(method);
  if (!v) return `${REFERENCE_LABEL} is required for ${method}.`;
  if (!r.pattern.test(v)) return `${REFERENCE_LABEL} can contain only ${r.chars} (no spaces or other symbols).`;
  if (v.length < r.min || v.length > r.max) return `${REFERENCE_LABEL} must be ${r.min}–${r.max} characters for ${method}.`;
  return "";
}

// Label text: "Transaction ID / Reference Number" plus a required marker for
// non-cash methods. Callers render the marker in their own style.
export const referenceRequired = (method) => !isCash(method);
export const referenceMaxLength = (method) => (isCash(method) ? CASH_MAX : ruleFor(method).max);
export function referencePlaceholder(method) {
  if (isCash(method)) return "Optional for Cash";
  const r = ruleFor(method);
  return r.example ? `e.g. ${r.example}` : "Required";
}
