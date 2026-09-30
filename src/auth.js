const crypto = require('crypto');

const COOKIE = 'ld_admin';
const SESSION_HOURS = 12;

function createAuth({ password, secret }) {
  const key = secret || crypto.randomBytes(32).toString('hex');

  const sign = (payload) => crypto.createHmac('sha256', key).update(payload).digest('hex');

  function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  function readCookie(req) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return decodeURIComponent(v.join('='));
    }
    return null;
  }

  function isLoggedIn(req) {
    const token = readCookie(req);
    if (!token) return false;
    const [expires, sig] = token.split('.');
    if (!expires || !sig || !safeEqual(sig, sign(expires))) return false;
    return Number(expires) > Date.now();
  }

  function cookieFlags(req) {
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    return `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  }

  function login(req, res) {
    const supplied = req.body && req.body.password;
    if (!supplied || !safeEqual(supplied, password)) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    const expires = String(Date.now() + SESSION_HOURS * 3600 * 1000);
    res.setHeader('Set-Cookie', `${COOKIE}=${expires}.${sign(expires)}; Max-Age=${SESSION_HOURS * 3600}; ${cookieFlags(req)}`);
    res.json({ ok: true });
  }

  function logout(req, res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
    res.json({ ok: true });
  }

  function requireAdmin(req, res, next) {
    if (isLoggedIn(req)) return next();
    res.status(401).json({ error: 'Please log in.' });
  }

  return { login, logout, requireAdmin, isLoggedIn };
}

module.exports = { createAuth };
