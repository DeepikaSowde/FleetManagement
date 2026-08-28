import React, { useMemo, useState } from "react";
import { Users, TrendingUp, PiggyBank, Landmark, Coins } from "lucide-react";

const INVESTOR_COLORS = {
  1: "#C9A227",
  2: "#4FA8A0",
  3: "#6FA8DC",
  4: "#A98CD9",
  5: "#8FBF6B",
  6: "#D98FB0",
};

const fmt = (n) =>
  "₹" +
  Math.round(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtPct = (n) => (n || 0).toFixed(2) + "%";

export default function InvestorNavLedger() {
  const [issuePrice, setIssuePrice] = useState(100);

  const [founders, setFounders] = useState([
    { id: 1, name: "Investor 1", amount: 2500000 },
    { id: 2, name: "Investor 2", amount: 2000000 },
    { id: 3, name: "Investor 3", amount: 1500000 },
    { id: 4, name: "Investor 4", amount: 1000000 },
  ]);

  const [newRounds, setNewRounds] = useState([
    { id: 5, name: "Investor 5", amount: 3000000, year: 1 },
    { id: 6, name: "Investor 6", amount: 4000000, year: 2 },
  ]);

  const [yearlyOps, setYearlyOps] = useState([
    { year: 1, revenue: 6000000, expenses: 4200000, dividendPct: 25, evAdj: 500000 },
    { year: 2, revenue: 8000000, expenses: 5300000, dividendPct: 25, evAdj: 900000 },
    { year: 3, revenue: 10500000, expenses: 6800000, dividendPct: 20, evAdj: 1200000 },
    { year: 4, revenue: 13000000, expenses: 8200000, dividendPct: 20, evAdj: 1500000 },
    { year: 5, revenue: 16000000, expenses: 9900000, dividendPct: 20, evAdj: 2000000 },
  ]);

  const updateFounder = (id, val) =>
    setFounders((f) => f.map((x) => (x.id === id ? { ...x, amount: Number(val) || 0 } : x)));

  const updateNewRound = (id, field, val) =>
    setNewRounds((r) =>
      r.map((x) => (x.id === id ? { ...x, [field]: field === "year" ? Number(val) || 1 : Number(val) || 0 } : x))
    );

  const updateOp = (year, field, val) =>
    setYearlyOps((ops) => ops.map((o) => (o.year === year ? { ...o, [field]: Number(val) || 0 } : o)));

  // ---------- Simulation ----------
  const { yearResults, allInvestorIds, investorMeta } = useMemo(() => {
    const meta = {};
    founders.forEach((f) => (meta[f.id] = { name: f.name, color: INVESTOR_COLORS[f.id], joinYear: 0 }));
    newRounds.forEach((n) => (meta[n.id] = { name: n.name, color: INVESTOR_COLORS[n.id], joinYear: n.year }));

    let shares = {};
    founders.forEach((f) => (shares[f.id] = f.amount / issuePrice));
    let totalShares = founders.reduce((s, f) => s + f.amount, 0) / issuePrice;
    let paidUpCapital = founders.reduce((s, f) => s + f.amount, 0);
    let reserves = 0;
    let evCum = 0;
    const cumDividend = {};
    Object.keys(meta).forEach((id) => (cumDividend[id] = 0));

    const results = [];

    results.push({
      year: 0,
      revenue: 0,
      expenses: 0,
      profit: 0,
      dividend: 0,
      reserves,
      evCum,
      paidUpCapital,
      nav: paidUpCapital + reserves + evCum,
      navPerShare: issuePrice,
      totalShares,
      injection: null,
      holdings: Object.keys(shares).map((id) => ({
        id,
        name: meta[id].name,
        shares: shares[id],
        pct: (shares[id] / totalShares) * 100,
        dividendThisYear: 0,
        cumDividend: 0,
        value: shares[id] * issuePrice,
      })),
    });

    yearlyOps.forEach((op) => {
      const profit = op.revenue - op.expenses;
      const dividend = Math.max(0, profit * (op.dividendPct / 100));
      const retained = profit - dividend;
      reserves += retained;
      evCum += op.evAdj;

      const navBefore = paidUpCapital + reserves + evCum;
      const navPerShare = totalShares > 0 ? navBefore / totalShares : issuePrice;

      const divThisYear = {};
      Object.keys(shares).forEach((id) => {
        const d = dividend * (shares[id] / totalShares);
        divThisYear[id] = d;
        cumDividend[id] = (cumDividend[id] || 0) + d;
      });

      const injecting = newRounds.find((n) => n.year === op.year);
      let injection = null;
      if (injecting) {
        const newShares = injecting.amount / navPerShare;
        shares[injecting.id] = (shares[injecting.id] || 0) + newShares;
        totalShares += newShares;
        paidUpCapital += injecting.amount;
        if (cumDividend[injecting.id] === undefined) cumDividend[injecting.id] = 0;
        injection = { name: injecting.name, amount: injecting.amount, newShares, navPerShare };
      }

      const navAfter = paidUpCapital + reserves + evCum;

      results.push({
        year: op.year,
        revenue: op.revenue,
        expenses: op.expenses,
        profit,
        dividend,
        reserves,
        evCum,
        paidUpCapital,
        nav: navAfter,
        navPerShare,
        totalShares,
        injection,
        holdings: Object.keys(shares).map((id) => ({
          id,
          name: meta[id].name,
          shares: shares[id],
          pct: (shares[id] / totalShares) * 100,
          dividendThisYear: divThisYear[id] || 0,
          cumDividend: cumDividend[id] || 0,
          value: shares[id] * navPerShare,
        })),
      });
    });

    return { yearResults: results, allInvestorIds: Object.keys(meta), investorMeta: meta };
  }, [founders, issuePrice, newRounds, yearlyOps]);

  const finalYear = yearResults[yearResults.length - 1];

  return (
    <div
      style={{
        background: "#10161D",
        color: "#ECE8DE",
        minHeight: "100vh",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
      className="p-4 pb-10"
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@600;700&family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;500;600&display=swap');
        .serif { font-family: 'Source Serif 4', Georgia, serif; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        input[type=number] {
          background: #1B2430; border: 1px solid #2E3A48; color: #ECE8DE;
          border-radius: 6px; padding: 4px 6px; width: 100%; font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
        }
        input[type=number]:focus { outline: 2px solid #C9A227; }
        .panel { background: #1B2430; border: 1px solid #2E3A48; border-radius: 10px; }
        table.ledger { border-collapse: collapse; width: 100%; font-size: 12px; }
        table.ledger th, table.ledger td { padding: 6px 8px; text-align: right; white-space: nowrap; }
        table.ledger th:first-child, table.ledger td:first-child { text-align: left; position: sticky; left: 0; background: #1B2430; }
        table.ledger thead th { color: #8B95A1; font-weight: 500; border-bottom: 1px solid #2E3A48; }
        table.ledger tbody tr:not(:last-child) td { border-bottom: 1px solid #212B38; }
      `}</style>

      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Landmark size={20} color="#C9A227" />
          <h1 className="serif" style={{ fontSize: 22, fontWeight: 700 }}>
            Investor NAV Ledger
          </h1>
        </div>
        <p style={{ color: "#8B95A1", fontSize: 13 }}>
          Founding capital → annual operations → reserves & enterprise value → new-round dilution → dividends.
          New investors buy in at that year's NAV per share, so incoming capital never dilutes existing
          investors' rupee value — only their percentage ownership.
        </p>
      </div>

      {/* Founding capital */}
      <Section title="Founding Capital (Year 0)" icon={<Users size={16} color="#C9A227" />}>
        <div className="flex items-center gap-2 mb-3">
          <label style={{ fontSize: 12, color: "#8B95A1" }}>Issue price / share</label>
          <input
            type="number"
            style={{ maxWidth: 100 }}
            value={issuePrice}
            onChange={(e) => setIssuePrice(Number(e.target.value) || 1)}
          />
        </div>
        <div className="grid gap-2">
          {founders.map((f) => (
            <Row key={f.id} color={INVESTOR_COLORS[f.id]} label={f.name}>
              <input type="number" value={f.amount} onChange={(e) => updateFounder(f.id, e.target.value)} />
              <span className="mono" style={{ fontSize: 11, color: "#8B95A1", minWidth: 90, textAlign: "right" }}>
                {(f.amount / issuePrice).toLocaleString("en-IN", { maximumFractionDigits: 0 })} sh
              </span>
            </Row>
          ))}
        </div>
      </Section>

      {/* New rounds */}
      <Section title="New Capital Rounds" icon={<Coins size={16} color="#4FA8A0" />}>
        {newRounds.map((n) => (
          <div key={n.id} className="flex items-center gap-2 mb-2">
            <span style={{ width: 10, height: 10, borderRadius: 99, background: INVESTOR_COLORS[n.id], flexShrink: 0 }} />
            <span style={{ fontSize: 13, minWidth: 76 }}>{n.name}</span>
            <input type="number" value={n.amount} onChange={(e) => updateNewRound(n.id, "amount", e.target.value)} />
            <span style={{ fontSize: 12, color: "#8B95A1" }}>after year</span>
            <input
              type="number"
              style={{ maxWidth: 56 }}
              value={n.year}
              onChange={(e) => updateNewRound(n.id, "year", e.target.value)}
            />
          </div>
        ))}
        <p style={{ fontSize: 11, color: "#8B95A1", marginTop: 4 }}>
          Shares issued = investment ÷ NAV per share at end of that year (before the round is added).
        </p>
      </Section>

      {/* Annual operations */}
      <Section title="Annual Operations & Policy" icon={<TrendingUp size={16} color="#6FA8DC" />}>
        <div className="overflow-x-auto">
          <table className="ledger">
            <thead>
              <tr>
                <th>Metric</th>
                {yearlyOps.map((o) => (
                  <th key={o.year}>Year {o.year}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <OpRow label="Revenue" field="revenue" ops={yearlyOps} onChange={updateOp} />
              <OpRow label="Expenses" field="expenses" ops={yearlyOps} onChange={updateOp} />
              <OpRow label="Dividend payout %" field="dividendPct" ops={yearlyOps} onChange={updateOp} narrow />
              <OpRow label="Enterprise value add" field="evAdj" ops={yearlyOps} onChange={updateOp} />
            </tbody>
          </table>
        </div>
      </Section>

      {/* Ownership ledger — signature visual */}
      <Section title="Ownership Ledger by Year" icon={<PiggyBank size={16} color="#A98CD9" />}>
        <div className="flex flex-wrap gap-3 mb-3">
          {allInvestorIds.map((id) => (
            <div key={id} className="flex items-center gap-1">
              <span style={{ width: 9, height: 9, borderRadius: 2, background: investorMeta[id].color }} />
              <span style={{ fontSize: 11, color: "#8B95A1" }}>{investorMeta[id].name}</span>
            </div>
          ))}
        </div>
        <div className="grid gap-3">
          {yearResults.map((yr) => (
            <div key={yr.year}>
              <div className="flex justify-between mb-1" style={{ fontSize: 11, color: "#8B95A1" }}>
                <span>
                  Year {yr.year}
                  {yr.injection ? ` — ${yr.injection.name} enters` : ""}
                </span>
                <span className="mono">
                  NAV {fmt(yr.nav)} · {fmt(yr.navPerShare)}/sh
                </span>
              </div>
              <div style={{ display: "flex", height: 22, borderRadius: 5, overflow: "hidden", border: "1px solid #2E3A48" }}>
                {yr.holdings.map((h) => (
                  <div
                    key={h.id}
                    title={`${h.name}: ${fmtPct(h.pct)}`}
                    style={{
                      flexGrow: Math.max(h.pct, 0.3),
                      background: investorMeta[h.id].color,
                      opacity: h.shares > 0 ? 1 : 0,
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* NAV composition table */}
      <Section title="Net Asset Value Composition" icon={<Landmark size={16} color="#C9A227" />}>
        <div className="overflow-x-auto">
          <table className="ledger">
            <thead>
              <tr>
                <th>Year</th>
                {yearResults.map((y) => (
                  <th key={y.year}>{y.year === 0 ? "Start" : `Y${y.year}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Paid-up capital</td>
                {yearResults.map((y) => (
                  <td key={y.year} className="mono">{fmt(y.paidUpCapital)}</td>
                ))}
              </tr>
              <tr>
                <td>Reserves (retained profit)</td>
                {yearResults.map((y) => (
                  <td key={y.year} className="mono">{fmt(y.reserves)}</td>
                ))}
              </tr>
              <tr>
                <td>Enterprise value add</td>
                {yearResults.map((y) => (
                  <td key={y.year} className="mono">{fmt(y.evCum)}</td>
                ))}
              </tr>
              <tr style={{ fontWeight: 600 }}>
                <td>Company NAV</td>
                {yearResults.map((y) => (
                  <td key={y.year} className="mono" style={{ color: "#C9A227" }}>{fmt(y.nav)}</td>
                ))}
              </tr>
              <tr>
                <td>NAV / share</td>
                {yearResults.map((y) => (
                  <td key={y.year} className="mono">{fmt(y.navPerShare)}</td>
                ))}
              </tr>
              <tr>
                <td>Total shares</td>
                {yearResults.map((y) => (
                  <td key={y.year} className="mono">{Math.round(y.totalShares).toLocaleString("en-IN")}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* Dividends table */}
      <Section title="Dividends Paid by Year" icon={<Coins size={16} color="#4FA8A0" />}>
        <div className="overflow-x-auto">
          <table className="ledger">
            <thead>
              <tr>
                <th>Investor</th>
                {yearResults.slice(1).map((y) => (
                  <th key={y.year}>Y{y.year}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {allInvestorIds.map((id) => (
                <tr key={id}>
                  <td>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: investorMeta[id].color, marginRight: 6 }} />
                    {investorMeta[id].name}
                  </td>
                  {yearResults.slice(1).map((y) => {
                    const h = y.holdings.find((hh) => hh.id === id);
                    return (
                      <td key={y.year} className="mono">
                        {h && h.dividendThisYear > 0 ? fmt(h.dividendThisYear) : "—"}
                      </td>
                    );
                  })}
                  <td className="mono" style={{ color: "#4FA8A0" }}>
                    {fmt(finalYear.holdings.find((h) => h.id === id)?.cumDividend || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Final position cards */}
      <Section title={`Final Position — Year ${finalYear.year}`} icon={<Users size={16} color="#8FBF6B" />}>
        <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {finalYear.holdings.map((h) => (
            <div key={h.id} className="panel p-3">
              <div className="flex items-center gap-1 mb-1">
                <span style={{ width: 8, height: 8, borderRadius: 99, background: investorMeta[h.id].color }} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{h.name}</span>
              </div>
              <div className="mono" style={{ fontSize: 18, color: "#ECE8DE" }}>{fmtPct(h.pct)}</div>
              <div style={{ fontSize: 11, color: "#8B95A1" }}>
                {Math.round(h.shares).toLocaleString("en-IN")} shares · value {fmt(h.value)}
              </div>
              <div style={{ fontSize: 11, color: "#4FA8A0" }}>+{fmt(h.cumDividend)} dividends received</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <div className="panel p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 style={{ fontSize: 14, fontWeight: 600, letterSpacing: 0.2 }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Row({ color, label, children }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ width: 10, height: 10, borderRadius: 99, background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 13, minWidth: 76 }}>{label}</span>
      {children}
    </div>
  );
}

function OpRow({ label, field, ops, onChange, narrow }) {
  return (
    <tr>
      <td>{label}</td>
      {ops.map((o) => (
        <td key={o.year}>
          <input
            type="number"
            style={{ maxWidth: narrow ? 56 : 110 }}
            value={o[field]}
            onChange={(e) => onChange(o.year, field, e.target.value)}
          />
        </td>
      ))}
    </tr>
  );
}
