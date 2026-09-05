/**
 * The chatbot does NOT authenticate users itself — PeoplePay360 remains the
 * sole authority (spec §9). This middleware only extracts whatever the
 * host frontend already attached (its existing auth token, plus the
 * current user's employeeId so adapter URLs can be built) and passes it
 * through untouched. Every downstream call to the real API carries this
 * same Authorization header, so PeoplePay360's own auth/authz decides what
 * the user can actually see.
 *
 * TODO(real-project): confirm how the host app's frontend stores/exposes
 * its auth token (Authorization: Bearer, or a cookie) and adjust this
 * extraction accordingly. X-Employee-Id is a placeholder — if the real
 * token already encodes the user id, this header may be unnecessary.
 */
function attachContext(req, res, next) {
  const authHeader = req.headers.authorization || null;
  const employeeId = req.headers['x-employee-id'] || req.body?.employeeId || null;

  if (!authHeader || !employeeId) {
    return res.status(401).json({
      success: false,
      type: 'ERROR',
      message: 'Missing authentication context.',
    });
  }

  req.ctx = { authHeader, employeeId };
  next();
}

module.exports = { attachContext };
