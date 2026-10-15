// Admin sign-in for the upload page. Credentials live in Netlify environment variables
// (ADMIN_USER, ADMIN_PASSWORD), never in the site's JavaScript. A successful sign-in returns a
// signed token that expires after 8 hours.
import crypto from "node:crypto";

const TTL_SECONDS = 8 * 3600;

function configured(){
  const user = process.env.ADMIN_USER, pass = process.env.ADMIN_PASSWORD;
  return user && pass ? { user, pass } : null;
}
function secret(){ return process.env.SESSION_SECRET || "spread-scorecard:" + process.env.ADMIN_PASSWORD; }
function sign(body){ return crypto.createHmac("sha256", secret()).update(body).digest("base64url"); }
function same(a, b){
  const ha = crypto.createHash("sha256").update(String(a)).digest(), hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function login(user, pass){
  const c = configured();
  if (!c) return { status: 503, error: "Admin sign-in isn't set up. Add ADMIN_USER and ADMIN_PASSWORD in Netlify's environment variables." };
  const ok = same(user, c.user) & same(pass, c.pass); // both compared, so timing doesn't reveal which was wrong
  if (!ok) return { status: 401, error: "Wrong username or password." };
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS, body = Buffer.from(c.user + "|" + exp).toString("base64url");
  return { token: body + "." + sign(body), user: c.user, exp };
}

// Returns the signed-in user name, or null.
export function verify(req){
  if (!configured()) return null;
  const m = (req.headers.get("authorization") || "").match(/^Bearer ([\w-]+)\.([\w-]+)$/);
  if (!m || !same(sign(m[1]), m[2])) return null;
  const [user, exp] = Buffer.from(m[1], "base64url").toString().split("|");
  return +exp > Date.now() / 1000 ? user : null;
}

export function json(status, data){
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
