// The one piece of arithmetic in the Investors module that has to be exactly
// right, kept out of the component so it can be reasoned about — and tested —
// on its own.
//
// A group does not negotiate percentages. It negotiates a valuation: "the
// business is worth ₹1.2 Cr, and Divya is putting in ₹30 L." Everything else
// follows from that one agreed number.

// Rounds computed shares to 2dp and puts the leftover fraction on the largest
// holder, so a table lands on exactly 100.00 rather than 99.99. The largest
// holder absorbs it because a hundredth of a point is proportionally smallest
// there — and because it has to go somewhere.
export function roundTo100(raw) {
  const ids = Object.keys(raw);
  if (ids.length === 0) return {};

  const out = {};
  ids.forEach((id) => { out[id] = Math.round((raw[id] + Number.EPSILON) * 100) / 100; });

  const sum = ids.reduce((s, id) => s + out[id], 0);
  const residual = Math.round((100 - sum) * 100) / 100;
  if (residual !== 0) {
    const biggest = ids.reduce((a, b) => (out[a] >= out[b] ? a : b));
    out[biggest] = Math.round((out[biggest] + residual) * 100) / 100;
  }
  return out;
}

/**
 * Works out what everyone holds after money goes in at an agreed valuation.
 *
 *     new % = (old % × pre-money + what they put in now) ÷ post-money
 *
 * which is one formula covering every case the module needs:
 *
 *   - a newcomer holds nothing beforehand, so they get their money ÷ post-money
 *   - anyone putting nothing in keeps old % × (pre-money ÷ post-money) — they
 *     are diluted in proportion, never by a dividend or by anyone's cash-out
 *   - an existing investor reinvesting gets their diluted stake PLUS the share
 *     their new money buys, which is what makes an off-percentage reinvestment
 *     land at a fair number instead of an argued one
 *
 * With no prior table there is nothing to dilute, so the split is simply the
 * ratio of the money going in — the right answer for an opening cap table, and
 * the same formula with every old % at zero.
 *
 * @param {Array<{id: string}>} investors        everyone who could hold a share
 * @param {Array<{investorId, pct}>} priorTable  holdings before this event
 * @param {number} preMoney                      the agreed valuation
 * @param {Object<string, number>} contributions money in now, by investor id
 * @returns {Object<string, number>|null}        percentages totalling 100, or
 *                                               null when there is not enough
 *                                               agreed yet to work it out
 */
export function splitFromValuation(investors, priorTable, preMoney, contributions) {
  const V = Number(preMoney) || 0;
  const moneyIn = investors.reduce((s, inv) => s + (Number(contributions[inv.id]) || 0), 0);
  const postMoney = V + moneyIn;

  const hasPriorTable = (priorTable || []).length > 0;
  // A valuation is only meaningful when there is an existing stake to dilute.
  // Without one, refusing to guess is the only safe answer: computing with a
  // zero valuation would silently wipe out every existing holder.
  if (postMoney <= 0 || (hasPriorTable && V <= 0)) return null;

  const oldPctOf = (id) => {
    const row = (priorTable || []).find((h) => h.investorId === id);
    return row ? Number(row.pct) : 0;
  };

  const raw = {};
  investors.forEach((inv) => {
    const share = (((oldPctOf(inv.id) / 100) * V) + (Number(contributions[inv.id]) || 0)) / postMoney * 100;
    // Someone who holds nothing and puts nothing in stays off the table
    // entirely, rather than appearing as a 0.00% row.
    if (share > 0) raw[inv.id] = share;
  });

  return roundTo100(raw);
}
