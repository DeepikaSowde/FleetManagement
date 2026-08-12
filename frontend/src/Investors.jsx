import { useState, useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from "recharts";
import { C, mono } from "./theme";
import { Card, CardHeader, Btn, KpiCard, Modal, Input, Select } from "./components";
import {
  TX_TYPES, flowForType, fmtINR, fmtPct, fmtShortDate,
  investorTotals, buildInvestorSummary, portfolioTotals, valueProgressSeries,
} from "./investorUtils";

// ============================================================================
// Investors — capital, dividends & XIRR tracking. List view (KPIs, value
// progress + composition charts, summary table) toggles to a per-investor
// detail view with six filtered-ledger tabs. All figures come from
// investorUtils (money math lives on the frontend, like the rest of the app).
// Currency is INR; the numbers are all derived from one unified transaction
// ledger, so the tabs are just filtered views of the same data.
// ============================================================================

const DONUT = ["#0EA5A0", "#2563EB", "#7C3AED", "#F59E0B", "#DB2777", "#16A34A", "#0891B2", "#DC2626"];
const DETAIL_TABS = ["Overview", "Investments", "Transactions", "Dividends", "Exit / Withdrawals", "Calculations"];
const flowColor = (flow) => (flow === "IN" ? C.green : C.red);
const todayISO = () => new Date().toISOString().slice(0, 10);

const blankInvestor = () => ({ name: "", status: "Active", investorSince: todayISO(), pan: "", email: "", phone: "", notes: "" });
const blankTx = (type = "Investment") => ({ type, date: todayISO(), amount: "", description: "", status: type === "Dividend" ? "Paid" : "" });

const th = { textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
const td = { padding: "10px 12px", fontSize: 12, borderBottom: `1px solid ${C.border}` };
const tdNum = { ...td, ...mono, textAlign: "right", whiteSpace: "nowrap" };

function FlowTag({ flow }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: flow === "IN" ? C.greenFaint : C.redFaint, color: flowColor(flow) }}>
      {flow}
    </span>
  );
}

function StatusPill({ status }) {
  const active = (status || "Active") === "Active";
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: active ? C.greenFaint : C.bg, color: active ? C.green : C.textMuted }}>
      {status || "Active"}
    </span>
  );
}

// ── Ledger table shared by the detail tabs ──────────────────────────────────
function LedgerTable({ rows, showStatus, onDelete }) {
  if (rows.length === 0) {
    return <div style={{ fontSize: 12.5, color: C.textMuted, padding: "16px 2px" }}>No records yet.</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Date</th><th style={th}>Type</th><th style={th}>Flow</th>
            <th style={{ ...th, textAlign: "right" }}>Amount</th><th style={th}>Description</th>
            {showStatus && <th style={th}>Status</th>}
            <th style={{ ...th, textAlign: "right" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((t) => (
            <tr key={t.id} data-testid="investor-tx-row" data-tx-id={t.id}>
              <td style={td}>{fmtShortDate(t.date)}</td>
              <td style={td}>{t.type}</td>
              <td style={td}><FlowTag flow={flowForType(t.type)} /></td>
              <td style={{ ...tdNum, fontWeight: 700, color: flowColor(flowForType(t.type)) }}>{fmtINR(t.amount)}</td>
              <td style={{ ...td, color: C.textSec }}>{t.description || "—"}</td>
              {showStatus && <td style={td}>{t.status || "—"}</td>}
              <td style={{ ...td, textAlign: "right" }}>
                <button data-testid="investor-tx-delete" onClick={() => onDelete(t.id)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: C.red, fontSize: 11, fontWeight: 600 }}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Investors({
  investors = [], transactions = [],
  onAddInvestor, onUpdateInvestor, onDeleteInvestor,
  onAddTx, onDeleteTx,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detailTab, setDetailTab] = useState("Overview");

  const [invModalOpen, setInvModalOpen] = useState(false);
  const [invEditingId, setInvEditingId] = useState(null);
  const [invForm, setInvForm] = useState(blankInvestor());

  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txForm, setTxForm] = useState(blankTx());
  const [txTypeLocked, setTxTypeLocked] = useState(false);

  const { rows } = useMemo(() => buildInvestorSummary(investors, transactions), [investors, transactions]);
  const totals = useMemo(() => portfolioTotals(investors, transactions), [investors, transactions]);
  const progress = useMemo(() => valueProgressSeries(transactions), [transactions]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && (r.status || "Active").toLowerCase() !== statusFilter) return false;
      if (!q) return true;
      return [r.name, r.pan, r.email].some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [rows, search, statusFilter]);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) || null, [rows, selectedId]);
  const selectedTx = useMemo(() => transactions.filter((t) => t.investorId === selectedId), [transactions, selectedId]);

  const composition = rows.filter((r) => r.currentValue > 0).map((r) => ({ name: r.name, value: r.currentValue }));

  // ── Investor add/edit ──
  const openAddInvestor = () => { setInvEditingId(null); setInvForm(blankInvestor()); setInvModalOpen(true); };
  const openEditInvestor = (inv) => { setInvEditingId(inv.id); setInvForm({ ...blankInvestor(), ...inv }); setInvModalOpen(true); };
  const submitInvestor = () => {
    if (!invForm.name.trim()) return;
    if (invEditingId) onUpdateInvestor(invEditingId, invForm);
    else { const created = onAddInvestor(invForm); if (created) setSelectedId((s) => s); }
    setInvModalOpen(false);
  };

  // ── Transaction add ──
  const openAddTx = (presetType) => {
    setTxForm(blankTx(presetType || "Investment"));
    setTxTypeLocked(!!presetType);
    setTxModalOpen(true);
  };
  const submitTx = () => {
    if (!selectedId || !txForm.amount) return;
    onAddTx({ ...txForm, investorId: selectedId });
    setTxModalOpen(false);
  };

  // ── Detail-view tab bodies ──
  const tabRows = (tab) => {
    if (tab === "Investments") return selectedTx.filter((t) => ["Investment", "Reinvestment"].includes(t.type));
    if (tab === "Dividends") return selectedTx.filter((t) => t.type === "Dividend");
    if (tab === "Exit / Withdrawals") return selectedTx.filter((t) => ["Exit", "Withdrawal"].includes(t.type));
    return selectedTx; // Transactions
  };

  // =========================================================================
  // DETAIL VIEW
  // =========================================================================
  if (selected) {
    const t = investorTotals(transactions, selected.id);
    const kpis = [
      { label: "Total Invested", value: fmtINR(t.totalInvested), sub: "All time", accent: C.teal },
      { label: "Current Value", value: fmtINR(t.currentValue), sub: "Capital in", accent: C.navy },
      { label: "Holding %", value: `${selected.holdingPct.toFixed(2)}%`, sub: "Of total pool", accent: "#7C3AED" },
      { label: "XIRR", value: fmtPct(selected.xirr), sub: "Since first inv.", accent: "#0891B2" },
      { label: "Dividends (OUT)", value: fmtINR(t.totalDividends), sub: "All time", accent: C.amber },
      { label: "Exit Paid (OUT)", value: fmtINR(t.totalExit), sub: "All time", accent: C.red },
    ];

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <button data-testid="investor-back" onClick={() => setSelectedId(null)}
          style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", color: C.teal, fontWeight: 700, fontSize: 12.5, padding: 0 }}>
          ← Back to investors
        </button>

        {/* Investor header */}
        <Card>
          <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={{ fontSize: 19, fontWeight: 800, color: C.navy }}>{selected.name}</div>
                <StatusPill status={selected.status} />
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, display: "flex", gap: 14, flexWrap: "wrap" }}>
                <span>Investor since {fmtShortDate(selected.investorSince)}</span>
                {selected.pan && <span>PAN {selected.pan}</span>}
                {selected.email && <span>{selected.email}</span>}
                {selected.phone && <span>{selected.phone}</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn id="investor-edit" onClick={() => openEditInvestor(selected)}>Edit Investor</Btn>
              <Btn primary id="investor-add-transaction" onClick={() => openAddTx()}>+ Add Transaction</Btn>
            </div>
          </div>
        </Card>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
          {DETAIL_TABS.map((tab) => (
            <div key={tab} data-testid={`investor-tab-${tab.split(" ")[0].toLowerCase()}`} onClick={() => setDetailTab(tab)}
              style={{ padding: "10px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", color: detailTab === tab ? C.teal : C.textMuted, borderBottom: `2px solid ${detailTab === tab ? C.teal : "transparent"}`, marginBottom: -1 }}>
              {tab}
            </div>
          ))}
        </div>

        {/* OVERVIEW */}
        {detailTab === "Overview" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
            </div>
            <Card>
              <CardHeader title="Recent Transactions" />
              <div style={{ padding: "0 18px 14px" }}>
                <LedgerTable rows={selectedTx.slice(-8)} showStatus onDelete={onDeleteTx} />
              </div>
            </Card>
          </>
        )}

        {/* LEDGER TABS */}
        {["Investments", "Transactions", "Dividends", "Exit / Withdrawals"].includes(detailTab) && (
          <Card>
            <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{detailTab}</div>
              {detailTab === "Investments" && <Btn primary small id="txn-add-investment" onClick={() => openAddTx("Investment")}>+ Add Investment</Btn>}
              {detailTab === "Transactions" && <Btn primary small id="txn-add-transaction" onClick={() => openAddTx()}>+ Add Transaction</Btn>}
              {detailTab === "Dividends" && <Btn primary small id="txn-add-dividend" onClick={() => openAddTx("Dividend")}>+ Add Dividend</Btn>}
              {detailTab === "Exit / Withdrawals" && <Btn primary small id="txn-add-exit" onClick={() => openAddTx("Exit")}>+ Add Exit</Btn>}
            </div>
            <div style={{ padding: "0 18px 16px" }}>
              <LedgerTable rows={tabRows(detailTab)} showStatus={detailTab !== "Investments"} onDelete={onDeleteTx} />
            </div>
          </Card>
        )}

        {/* CALCULATIONS */}
        {detailTab === "Calculations" && (
          <Card>
            <CardHeader title={`${selected.name} — how the figures are derived`} />
            <div style={{ padding: "6px 20px 20px", fontSize: 13, color: C.textPri, lineHeight: 2 }}>
              <Calc line="First Investment" value={fmtINR(t.firstInvestment)} />
              <Calc line="+ Total Reinvestment" value={fmtINR(t.totalReinvestment)} />
              <Calc line="= Total Invested (IN)" value={fmtINR(t.totalInvested)} bold />
              <div style={{ height: 10 }} />
              <Calc line="Current Value  (= capital in; dividends & exits excluded)" value={fmtINR(t.currentValue)} bold />
              <Calc line={`Holding %  (${fmtINR(t.currentValue)} ÷ ${fmtINR(totals.totalCurrent)})`} value={`${selected.holdingPct.toFixed(2)}%`} />
              <Calc line="Dividends paid (OUT)" value={fmtINR(t.totalDividends)} />
              <Calc line="Exit / withdrawals paid (OUT)" value={fmtINR(t.totalExit)} />
              <div style={{ height: 10 }} />
              <Calc line="XIRR  (all cash flows + current value at today)" value={fmtPct(selected.xirr)} bold accent />
            </div>
          </Card>
        )}

        {/* MODALS (also available from the detail view) */}
        <InvestorModal open={invModalOpen} editing={!!invEditingId} form={invForm} setForm={setInvForm} onClose={() => setInvModalOpen(false)} onSubmit={submitInvestor} />
        <TxModal open={txModalOpen} form={txForm} setForm={setTxForm} typeLocked={txTypeLocked} onClose={() => setTxModalOpen(false)} onSubmit={submitTx} />
      </div>
    );
  }

  // =========================================================================
  // LIST VIEW
  // =========================================================================
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: C.textMuted }}>Investors, their investments, dividends, exits and current holdings.</div>
        <Btn primary id="investor-add" onClick={openAddInvestor}>+ Add Investor</Btn>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <KpiCard label="Total Investors" value={totals.totalInvestors} sub={`${totals.activeCount} active`} accent={C.teal} />
        <KpiCard label="Current Total Value" value={fmtINR(totals.totalCurrent)} sub="After reinvestment" accent={C.navy} />
        <KpiCard label="Total Dividends (OUT)" value={fmtINR(totals.totalDividends)} sub="All time" accent={C.amber} />
        <KpiCard label="Total Exit Paid (OUT)" value={fmtINR(totals.totalExit)} sub="All time" accent={C.red} />
        <KpiCard label="Portfolio XIRR" value={fmtPct(totals.portXirr)} sub="All investors" accent="#0891B2" />
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <Card>
          <CardHeader title="Value Progress" subtitle="Invested value before & after each investment / reinvestment" />
          <div style={{ padding: "8px 12px 16px", height: 280 }}>
            {progress.length === 0 ? (
              <Empty>No investments recorded yet.</Empty>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={progress} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEE" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={{ stroke: "#E5E5E5" }} />
                  <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={70} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
                  <Tooltip formatter={(v, n) => [fmtINR(v), n === "invested" ? "Invested / Reinvested" : "Value After"]} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                  <Bar dataKey="invested" fill={C.green} radius={[4, 4, 0, 0]} barSize={26} />
                  <Line type="monotone" dataKey="after" stroke={C.navy} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Investment Composition" subtitle="By current value" />
          <div style={{ padding: "8px 12px 16px", height: 280, display: "flex", alignItems: "center" }}>
            {composition.length === 0 ? (
              <Empty>No holdings yet.</Empty>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={composition} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {composition.map((_, i) => <Cell key={i} fill={DONUT[i % DONUT.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmtINR(v)} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Summary table */}
      <Card>
        <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>Investor Summary</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="investor-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search investor…"
              style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: "inherit", outline: "none" }} />
            <select id="investor-filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: "inherit", background: C.surface, cursor: "pointer" }}>
              <option value="all">Status: All</option>
              <option value="active">Active</option>
              <option value="exited">Exited</option>
            </select>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Investor</th>
                <th style={{ ...th, textAlign: "right" }}>First Investment</th>
                <th style={{ ...th, textAlign: "right" }}>Reinvestment</th>
                <th style={{ ...th, textAlign: "right" }}>Current Value</th>
                <th style={{ ...th, textAlign: "right" }}>Holding %</th>
                <th style={{ ...th, textAlign: "right" }}>XIRR</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td style={{ ...td, color: C.textMuted }} colSpan={8}>No investors yet. Click “+ Add Investor” to start.</td></tr>
              ) : filteredRows.map((r) => (
                <tr key={r.id} data-testid="investor-row" data-investor-id={r.id}>
                  <td style={{ ...td, fontWeight: 700, color: C.navy }}>{r.name}</td>
                  <td style={tdNum}>{fmtINR(r.firstInvestment)}</td>
                  <td style={tdNum}>{fmtINR(r.totalReinvestment)}</td>
                  <td style={{ ...tdNum, fontWeight: 700, color: C.teal }}>{fmtINR(r.currentValue)}</td>
                  <td style={tdNum}>{r.holdingPct.toFixed(2)}%</td>
                  <td style={tdNum}>{fmtPct(r.xirr)}</td>
                  <td style={td}><StatusPill status={r.status} /></td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button data-testid="investor-row-view" onClick={() => { setSelectedId(r.id); setDetailTab("Overview"); }}
                      style={{ padding: "4px 12px", borderRadius: 7, border: "none", background: C.teal, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot>
                <tr style={{ background: C.bg }}>
                  <td style={{ ...td, fontWeight: 800, color: C.navy }}>TOTAL</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{fmtINR(filteredRows.reduce((s, r) => s + r.firstInvestment, 0))}</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{fmtINR(filteredRows.reduce((s, r) => s + r.totalReinvestment, 0))}</td>
                  <td style={{ ...tdNum, fontWeight: 800, color: C.teal }}>{fmtINR(totals.totalCurrent)}</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>100.00%</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{fmtPct(totals.portXirr)}</td>
                  <td style={td} colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      <InvestorModal open={invModalOpen} editing={!!invEditingId} form={invForm} setForm={setInvForm} onClose={() => setInvModalOpen(false)} onSubmit={submitInvestor} />
      <TxModal open={txModalOpen} form={txForm} setForm={setTxForm} typeLocked={txTypeLocked} onClose={() => setTxModalOpen(false)} onSubmit={submitTx} />
    </div>
  );
}

// ── Small helpers ────────────────────────────────────────────────────────────
const Empty = ({ children }) => (
  <div style={{ width: "100%", textAlign: "center", color: C.textMuted, fontSize: 12.5, alignSelf: "center" }}>{children}</div>
);

const Calc = ({ line, value, bold, accent }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 16, borderBottom: `1px dashed ${C.border}` }}>
    <span style={{ color: C.textSec }}>{line}</span>
    <span style={{ ...mono, fontWeight: bold ? 800 : 600, color: accent ? C.teal : C.navy }}>{value}</span>
  </div>
);

function InvestorModal({ open, editing, form, setForm, onClose, onSubmit }) {
  return (
    <Modal testId="investor-modal" open={open} title={editing ? "Edit Investor" : "Add New Investor"} onClose={onClose} onSubmit={onSubmit} submitText={editing ? "Save Changes" : "Add Investor"}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Input id="investor-name" label="Investor Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Investor A" />
        <Select id="investor-status" label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={[{ value: "Active", label: "Active" }, { value: "Exited", label: "Exited" }]} />
        <Input id="investor-since" label="Investor Since" type="date" value={form.investorSince || ""} onChange={(e) => setForm({ ...form, investorSince: e.target.value })} />
        <Input id="investor-pan" label="PAN / ID" value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value })} placeholder="e.g. ABCPA1234D" />
        <Input id="investor-email" label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="e.g. investorA@example.com" />
        <Input id="investor-phone" label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 98xxxxxx" />
      </div>
      <Input id="investor-notes" label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
    </Modal>
  );
}

function TxModal({ open, form, setForm, typeLocked, onClose, onSubmit }) {
  const isDividend = form.type === "Dividend";
  return (
    <Modal testId="txn-modal" open={open} title="Add Transaction" onClose={onClose} onSubmit={onSubmit} submitText="Add Transaction">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: C.textPri }}>Type</label>
          <select id="txn-type" value={form.type} disabled={typeLocked}
            onChange={(e) => setForm({ ...form, type: e.target.value, status: e.target.value === "Dividend" ? "Paid" : "" })}
            style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", background: typeLocked ? C.bg : C.surface }}>
            {TX_TYPES.map((t) => <option key={t} value={t}>{t} ({flowForType(t)})</option>)}
          </select>
        </div>
        <Input id="txn-date" label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <Input id="txn-amount" label="Amount (₹) *" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="e.g. 1000000" />
        {isDividend && (
          <Select id="txn-status" label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={[{ value: "Paid", label: "Paid" }, { value: "Pending", label: "Pending" }]} />
        )}
      </div>
      <Input id="txn-description" label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Reinvested returns" />
    </Modal>
  );
}
