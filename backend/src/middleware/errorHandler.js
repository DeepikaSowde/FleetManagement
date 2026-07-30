// Central error handler — the last middleware in app.js. Any error thrown in a
// controller (or passed to next(err)) lands here, so every route reports errors
// in one consistent shape instead of each controller duplicating try/catch
// responses. Also maps a couple of common PostgreSQL error codes to friendly
// HTTP statuses.
function errorHandler(err, req, res, next) {
  console.error(err);

  // 23505 = unique_violation (e.g. duplicate plate / email)
  if (err.code === "23505") {
    return res.status(409).json({ message: "That record already exists." });
  }
  // 23503 = foreign_key_violation (e.g. booking references a missing car)
  if (err.code === "23503") {
    return res.status(400).json({ message: "Related record not found." });
  }

  res.status(err.status || 500).json({ message: err.message || "Server error" });
}

// 404 for any unmatched route.
function notFound(req, res) {
  res.status(404).json({ message: "Not found" });
}

module.exports = { errorHandler, notFound };
