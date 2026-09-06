// Confines the 'investor' role to its own corner of the API.
//
// Every other route in this app is guarded by requireAuth alone, which is fine
// while every account belongs to the business. An investor login does not — it
// belongs to an outside party who may see their stake and nothing else. Rather
// than annotate fifteen route files (and rely on nobody forgetting the next
// one), this runs once, in front of all of them, as a deny-by-default
// allowlist: an investor may reach exactly the paths below and gets 403 on the
// rest, including any route added later.
//
// Anyone who is not an investor passes straight through.

// [method, path matcher] pairs an investor is allowed to reach.
const ALLOWED = [
  ["GET", /^\/api\/auth\/me\/?$/],
  ["POST", /^\/api\/auth\/logout\/?$/],

  // Their own stake, holdings history and pending sign-offs — one endpoint
  // that returns only what belongs to them (see ownershipController.mine).
  ["GET", /^\/api\/ownership\/me\/?$/],

  // Answering a change that is waiting on them. The controller additionally
  // forces the decision onto their own investor id, so this cannot be used to
  // vote for anybody else.
  ["POST", /^\/api\/ownership\/[^/]+\/decide\/?$/],
];

function investorScope(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();
  if (role !== "investor") return next();

  const path = req.baseUrl ? req.baseUrl + req.path : req.path;
  const permitted = ALLOWED.some(([method, re]) => req.method === method && re.test(path));
  if (permitted) return next();

  return res.status(403).json({ message: "Investor accounts can only access their own investment record." });
}

module.exports = { investorScope, ALLOWED };
