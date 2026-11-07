// Request handling for /api/bookings.
const Booking = require("../models/bookingModel");
const AuditLog = require("../models/auditLogModel");

async function list(req, res, next) {
  try {
    res.json(await Booking.getAll());
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { id, plate } = req.body;
    if (!id || !plate) {
      return res.status(400).json({ message: "id and plate are required" });
    }
    res.status(201).json(await Booking.create(req.body));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const booking = await Booking.update(req.params.id, req.body);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    res.json(booking);
  } catch (err) {
    next(err);
  }
}

// POST /api/bookings/:id/change-car — see Booking.changeCar.
async function changeCar(req, res, next) {
  try {
    const actor = req.user?.name || req.user?.username || "System";
    const before = await Booking.getById(req.params.id);
    const booking = await Booking.changeCar(req.params.id, req.body || {}, actor);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    AuditLog.record(req, {
      module: "Bookings",
      action: "Change Car",
      description: `${booking.id} (${booking.customer || "—"}): ${before?.plate} → ${booking.plate} at ${req.body.swapAt}` +
        `${req.body.reason ? ` · Reason: ${req.body.reason}` : ""}`,
    });
    res.json(booking);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const ok = await Booking.remove(req.params.id);
    if (!ok) return res.status(404).json({ message: "Booking not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, changeCar, remove };
