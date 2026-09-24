import { C } from "./theme";
import { validatePaymentReference } from "./paymentReference";

// Inline message under a Transaction ID / Reference Number input. Shown only
// once something has been typed, so an untouched required field isn't flagged
// before the user gets to it (the submit handler still blocks an empty one).
export default function PaymentRefError({ method, value }) {
  if (!String(value ?? "").trim()) return null;
  const msg = validatePaymentReference(method, value);
  return msg ? <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{msg}</div> : null;
}
