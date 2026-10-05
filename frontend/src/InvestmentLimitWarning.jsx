// Cross-check between the Fleet and Investor modules: the money put into the
// fleet shouldn't exceed the money investors have put in. Warning ONLY — it
// never blocks a save and changes no calculation; both totals are the same
// figures the modules already show.
import { C, totalInv } from "./theme";

// Fleet: every car's Investment (Purchase + Advance + Insurance + Registration
// + Other Charges), as in the Fleet table.
export const totalFleetInvestment = (fleet = []) => fleet.reduce((s, c) => s + totalInv(c), 0);

// Investors: Total Invested = First Investment + Reinvestment, as in the
// Investors module.
const INVESTED_TYPES = ["First Investment", "Reinvestment"];
export const totalInvestorInvestment = (investorTx = []) =>
  investorTx.reduce((s, t) => s + (INVESTED_TYPES.includes(t.type) ? Number(t.amount) || 0 : 0), 0);

const sgd = (n) => `SGD ${Math.round(n).toLocaleString()}`;

// `investorTotal` is null when the current user can't see investor data —
// then there is nothing to compare against, so nothing is shown.
export default function InvestmentLimitWarning({ fleetTotal, investorTotal, style }) {
  if (investorTotal === null || investorTotal === undefined) return null;
  if (!(fleetTotal > investorTotal)) return null;
  return (
    <div role="alert" style={{ background: C.amberFaint, border: `1px solid ${C.amber}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12.5, color: C.textSec, ...style }}>
      <div style={{ fontWeight: 800, color: C.amber, marginBottom: 2 }}>⚠️ Investment Limit Exceeded</div>
      Total Fleet Investment cannot be greater than the total investor investment. Please review the investment amount.
      <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4 }}>
        Total Fleet Investment {sgd(fleetTotal)} · Total Investor Investment {sgd(investorTotal)}
      </div>
    </div>
  );
}
