import { useState, useEffect } from "react";
import { C } from "./theme";
import Earning from "./Earning";
import Expenses from "./Expenses";
import PlReport from "./pl report";

// Consolidated P&L module — one sidebar item ("P&L") fanning out into three
// Level 1 tabs (Earnings / Expenses / P&L). Each tab renders the same
// existing dashboard component exactly as it always has; this file only
// owns the tab switcher, never the dashboards' own content.
const TABS = [
  { key: "earnings", label: "Earnings" },
  { key: "expenses", label: "Expenses" },
  { key: "pl", label: "P&L" },
];

const PLModule = ({
  initialTab = "earnings",
  onInitialTabConsumed,
  earnings, fleet, bookings,
  onAddEarning, onUpdateEarning, onDeleteEarning, onLockEarning,
  expenses, onAddExpense, onUpdateExpense, onDeleteExpense,
  calculateMetrics, calculateMonthlyMetrics, calculateCarMetrics,
  plInitialView, onPlInitialViewConsumed,
  expenseOpenAddOnEntry, onExpenseOpenAddOnEntryHandled,
  // Role & Permission grants Earnings/Expenses/P&L as three independent
  // rows even though all three live as Level 1 tabs of this one page/sidebar
  // item (see FleetOpzApp's NAV_VIEW_CHECK — the page is reachable if any of
  // the three is granted). Defaulting all to true keeps this functional if
  // ever rendered standalone.
  canViewEarnings = true, canViewExpenses = true, canViewPl = true,
}) => {
  const CAN_VIEW_TAB = { earnings: canViewEarnings, expenses: canViewExpenses, pl: canViewPl };
  const visibleTabs = TABS.filter((t) => CAN_VIEW_TAB[t.key]);
  const [tab, setTab] = useState(CAN_VIEW_TAB[initialTab] ? initialTab : (visibleTabs[0]?.key || initialTab));
  // Same one-shot hand-off pattern PlReport itself already uses for
  // initialView below — consumed once on mount so a later plain sidebar
  // click doesn't get stuck reopening whichever tab a dashboard link last
  // requested.
  useEffect(() => { onInitialTabConsumed?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Falls back to the first still-allowed tab if the current one loses its
  // permission (e.g. after a relogin picks up a new Role & Permission grant).
  useEffect(() => {
    if (!CAN_VIEW_TAB[tab] && visibleTabs.length) setTab(visibleTabs[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewEarnings, canViewExpenses, canViewPl]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>P&amp;L</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Track your earnings, expenses and profitability.</div>
        </div>
        <div style={{ display: "flex", gap: 4, background: C.bg, padding: 4, borderRadius: 10 }}>
          {visibleTabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: "9px 20px", fontSize: 12.5, fontWeight: 700, borderRadius: 8, border: "none", cursor: "pointer",
              background: tab === t.key ? C.teal : "transparent", color: tab === t.key ? "#fff" : C.textSec,
            }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "earnings" && canViewEarnings && (
        <Earning
          earnings={earnings}
          fleet={fleet}
          bookings={bookings}
          onAddEarning={onAddEarning}
          onUpdateEarning={onUpdateEarning}
          onDeleteEarning={onDeleteEarning}
          onLockEarning={onLockEarning}
        />
      )}

      {tab === "expenses" && canViewExpenses && (
        <Expenses
          expenses={expenses}
          fleet={fleet}
          onAddExpense={onAddExpense}
          onUpdateExpense={onUpdateExpense}
          onDeleteExpense={onDeleteExpense}
          openAddOnEntry={expenseOpenAddOnEntry}
          onOpenAddOnEntryHandled={onExpenseOpenAddOnEntryHandled}
        />
      )}

      {tab === "pl" && canViewPl && (
        <PlReport
          fleet={fleet}
          bookings={bookings}
          earnings={earnings}
          expenses={expenses}
          calculateMetrics={calculateMetrics}
          calculateMonthlyMetrics={calculateMonthlyMetrics}
          calculateCarMetrics={calculateCarMetrics}
          initialView={plInitialView}
          onInitialViewConsumed={onPlInitialViewConsumed}
        />
      )}
    </div>
  );
};

export default PLModule;
