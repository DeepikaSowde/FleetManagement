// Shared Contact / Phone Number country codes and validation helpers.
// Used by the New Booking wizard's Customer Details step (FleetOpzApp.jsx) and
// the Add / Edit Customer form (Customers.jsx) so both offer the same
// country-code dropdown, digit rules, and error messages.
//
// Each entry's `digits` is the number of digits the user types into the field
// (excludes the dial code itself) — drives both the "N digits required" helper
// text and the length validation. `prefix`, when set, is a fixed local prefix
// baked into the stored value (Singapore's legacy format is "65" + 8 digits).
export const CONTACT_COUNTRY_CODES = [
  { code: "+65", country: "Singapore", flag: "🇸🇬", prefix: "65", digits: 8 },
  { code: "+91", country: "India", flag: "🇮🇳", digits: 10 },
  { code: "+1", country: "US / Canada", flag: "🇺🇸", digits: 10 },
  { code: "+44", country: "United Kingdom", flag: "🇬🇧", digits: 10 },
  { code: "+61", country: "Australia", flag: "🇦🇺", digits: 9 },
  { code: "+971", country: "UAE", flag: "🇦🇪", digits: 9 },
  { code: "+966", country: "Saudi Arabia", flag: "🇸🇦", digits: 9 },
  { code: "+974", country: "Qatar", flag: "🇶🇦", digits: 8 },
  { code: "+965", country: "Kuwait", flag: "🇰🇼", digits: 8 },
  { code: "+968", country: "Oman", flag: "🇴🇲", digits: 8 },
  { code: "+973", country: "Bahrain", flag: "🇧🇭", digits: 8 },
  { code: "+60", country: "Malaysia", flag: "🇲🇾", digits: 9 },
];

export const contactCountryEntry = (dialCode) =>
  CONTACT_COUNTRY_CODES.find(c => c.code === dialCode) || CONTACT_COUNTRY_CODES[0];

export const contactDigitsRequired = (dialCode) => contactCountryEntry(dialCode).digits;

export const contactPrefix = (dialCode) => contactCountryEntry(dialCode).prefix || "";

export const contactHelperText = (dialCode) => {
  const { prefix, digits } = contactCountryEntry(dialCode);
  return prefix ? `${prefix} + ${digits} digits required` : `${digits} digits required`;
};

export const contactErrorMsg = (dialCode) => {
  const { prefix, digits } = contactCountryEntry(dialCode);
  return prefix
    ? `Contact number must be ${prefix.length + digits} digits and start with ${prefix}`
    : `Contact number must be exactly ${digits} digits`;
};

// The customer/customer-directory backend persists a single `contact` string
// (no separate country-code column), so the full international number is stored
// there: dial-code digits + the local digits (e.g. +65 "98765432" → "6598765432").
export const combineContact = (dialCode, local) => {
  const digits = (local || "").replace(/\D/g, "");
  if (!digits) return "";
  return `${dialCode.replace(/\D/g, "")}${digits}`;
};

// Parse a stored `contact` back into { contactCountryCode, contact } for the
// two-part editor. Matches a country when the stored value starts with its dial
// digits AND the remainder is exactly that country's digit count; otherwise
// falls back to Singapore with the raw digits clamped to its length.
export const splitContact = (stored) => {
  const digits = (stored || "").replace(/\D/g, "");
  if (!digits) return { contactCountryCode: "+65", contact: "" };
  for (const c of CONTACT_COUNTRY_CODES) {
    const dial = c.code.replace(/\D/g, "");
    if (digits.startsWith(dial) && digits.length - dial.length === c.digits) {
      return { contactCountryCode: c.code, contact: digits.slice(dial.length) };
    }
  }
  return { contactCountryCode: "+65", contact: digits.slice(0, contactDigitsRequired("+65")) };
};
