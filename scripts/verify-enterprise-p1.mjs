import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

// API-only regression checks. Never populate, reset accounts, delete records or run SQL.
const dir = 'artifacts/enterprise-simulation';
const audit = JSON.parse(readFileSync(`${dir}/enterprise-audit.json`, 'utf8'));
const pins = JSON.parse(readFileSync(`${dir}/reuse-verification.json`, 'utf8')).checks;
const school = code => {
  const s = audit.schools.find(s => s.code === code);
  assert(s && pins.some(p => p.code === code && p.schoolId === s.id));
  return s;
};
const sunrise = school('E2E-SUNRISE'), horizon = school('E2E-HORIZON');
const existing = sunrise.records.admissions.find(a => a.firstName === 'Nila' && a.status === 'Active');
const target = horizon.records.admissions.find(a => a.firstName === 'Nila' && ['Ready', 'Active'].includes(a.status));
const sibling = sunrise.records.admissions.find(a => a.firstName === 'Tejas' && a.onboarding?.guardian?.mode === 'existing');
assert(existing && target && sibling);
assert.equal(existing.guardianPhone, target.guardianPhone);
assert.notEqual(existing.guardianEmail, target.guardianEmail);
if (!process.argv.includes('--confirm')) {
  console.log('Plan: reuse Sunrise/Horizon IDs; activate only existing ready Horizon admission; verify cross-school shared phone, same-school duplicate refusal, school-scoped links, immediate JWT and tenant/RBAC refusals. No bulk population.');
  process.exit(0);
}
assert(process.env.EDUOS_SIM_PASSWORD, 'EDUOS_SIM_PASSWORD required');
const result = { startedAt: new Date().toISOString(), checks: [], requests: [] };
const auditRefreshTokens = new Map();
const save = () => writeFileSync(`${dir}/p1-targeted-verification.json`, JSON.stringify(result, null, 2));
function check(category, label, ok, detail = {}) {
  result.checks.push({ category, label, ok, ...detail }); save();
  if (!ok) throw new Error(`Verification stopped: ${label}`);
}
async function api(method, path, token, body) {
  const res = await fetch(`http://127.0.0.1:8080/api/v1${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000)
  });
  const json = await res.json().catch(() => ({}));
  result.requests.push({ method, path, status: res.status, challenge: res.headers.get('www-authenticate') }); save();
  return { status: res.status, data: json.data, message: json.message };
}
async function login(s, username) {
  const r = await api('POST', '/auth/login', null, { schoolId: s.id, username, password: process.env.EDUOS_SIM_PASSWORD });
  assert.equal(r.status, 200, `Sign-in blocked for ${s.code}`);
  auditRefreshTokens.set(s.id, r.data.refreshToken);
  return r.data.accessToken;
}
async function run(label, fn) {
  try { await fn(); } catch (e) {
    if (result.checks.at(-1)?.ok !== false) check('blocked', label, false, { error: e.message });
    throw e;
  }
}
let a, b;
await run('Administrator sign-ins', async () => {
  for (const s of [sunrise, horizon]) {
    const token = await login(s, `admin1@${s.code.slice(4).toLowerCase()}.e2e.eduos.local`);
    const r = await api('GET', '/users?pageSize=1', token); // No retry or delay hides JWT rejection.
    check('jwt', `${s.code} fresh token works immediately`, r.status === 200, { status: r.status });
    if (s === sunrise) a = token; else b = token;
  }
});
if (a && b) {
  await run('JWT negative controls', async () => {
    // Sign only refusal fixtures for the existing E2E identity. No token or key is saved.
    const encodedKey = process.env.JWT_PRIVATE_KEY ?? readFileSync('.env', 'utf8').match(/^JWT_PRIVATE_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
    assert(encodedKey, 'Existing signing key unavailable; stop before business writes');
    const key = createPrivateKey(Buffer.from(encodedKey, 'base64'));
    const [header, payload, signature] = a.split('.');
    assert(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey(key), Buffer.from(signature, 'base64url')), 'Fixture key must match the live issuer');
    const claims = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.equal(claims.school_id, sunrise.id);
    const fixture = changes => {
      const content = `${header}.${Buffer.from(JSON.stringify({ ...claims, ...changes })).toString('base64url')}`;
      return `${content}.${sign('RSA-SHA256', Buffer.from(content), key).toString('base64url')}`;
    };
    const expired = Math.floor(Date.now() / 1000) - 120;
    const cases = [
      ['Expired correctly signed token refused', fixture({ nbf: expired - 60, exp: expired })],
      ['Invalid signature refused', `${header}.${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`],
      ['Stale token-version correctly signed token refused', fixture({ token_version: String(Number(claims.token_version) - 1) })]
    ];
    for (const [label, token] of cases) {
      const r = await api('GET', '/users?pageSize=1', token);
      check('jwt', label, r.status === 401, { status: r.status });
    }
    const refreshToken = auditRefreshTokens.get(horizon.id);
    assert(refreshToken, 'Audit refresh token missing');
    const logout = await api('POST', '/auth/logout', b, { refreshToken });
    check('jwt', 'Only this audit refresh session signed out', logout.status === 200, { status: logout.status });
    const revoked = await api('POST', '/auth/refresh', null, { refreshToken });
    check('jwt', 'Revoked audit refresh token refused', revoked.status === 401, { status: revoked.status });
  });
  await run('Onboarding guardian boundaries', async () => {
    const foreign = sunrise.parents.find(p => p.email === existing.guardianEmail);
    assert(foreign, 'Existing Sunrise guardian missing');
    const before = await api('GET', `/suite/admissions/${target.id}`, b);
    assert.equal(before.status, 200);
    if (['Ready', 'Onboarding'].includes(before.data.status)) {
      const denied = await api('PUT', `/suite/admissions/${target.id}/onboarding`, b,
        { section: 'guardian', mode: 'existing', parentId: foreign.id, relationship: 'Mother', confirmed: true });
      check('tenant', 'Foreign guardian cannot be linked in Horizon', [400, 403, 404].includes(denied.status), { status: denied.status });
      assert([400, 403, 404].includes(denied.status), 'Unexpected foreign link outcome; stop activation');
      const unchanged = await api('GET', `/suite/admissions/${target.id}`, b);
      assert.equal(unchanged.data.onboarding.guardian.mode, before.data.onboarding.guardian.mode);
      assert.equal(unchanged.data.onboarding.guardian.parentId, before.data.onboarding.guardian.parentId);
      const activated = await api('POST', `/suite/admissions/${target.id}/activate`, b);
      check('guardian', 'Existing Horizon onboarding activates with cross-school phone', activated.status === 200, { status: activated.status });
    }
    const after = await api('GET', `/suite/admissions/${target.id}`, b);
    check('guardian', 'Horizon admission is Active', after.status === 200 && after.data.status === 'Active');
    const parents = await api('GET', '/parents?pageSize=100', b);
    const local = parents.data?.data?.find(p => p.email === target.guardianEmail);
    check('guardian', 'Shared phone belongs to separate school-scoped guardians', !!local && local.phoneNumber === foreign.phoneNumber && local.schoolId === horizon.id && foreign.schoolId === sunrise.id && local.id !== foreign.id);
    if (local) {
      const candidates = await api('GET', `/suite/admissions/${target.id}/candidates`, b);
      check('guardian', 'Matching-phone candidates exclude the other school guardian', candidates.status === 200 && candidates.data.guardians.some(p => p.id === local.id) && candidates.data.guardians.every(p => p.id !== foreign.id));
      const students = await api('GET', '/operations/directory/students?pageSize=100', b);
      check('guardian', 'Activated student remains in Horizon', students.status === 200 && students.data.data.some(s => s.id === after.data.studentId && s.schoolId === horizon.id));
      const duplicate = await api('POST', '/parents', b, { schoolId: horizon.id, firstName: 'E2E', lastName: 'DuplicateProbe', email: 'p1.duplicate@horizon.e2e.eduos.local', phoneNumber: local.phoneNumber });
      check('guardian', 'Same-school phone duplicate remains refused', duplicate.status === 409, { status: duplicate.status });
      const linked = await api('GET', `/suite/admissions/${sibling.id}/candidates`, a);
      check('guardian', 'Sibling guardian candidates remain school-scoped', linked.status === 200 && linked.data.guardians.some(p => p.id === sibling.onboarding.guardian.parentId) && linked.data.guardians.every(p => p.id !== local.id));
    }
  });
  await run('Tenant regression', async () => {
    for (const [path, expected] of [[`/parents?schoolId=${horizon.id}`, [403]], [`/suite/admissions/${target.id}`, [404, 403]]]) {
      const r = await api('GET', path, a); check('tenant', path, expected.includes(r.status), { status: r.status });
    }
    assert(existing.studentId, 'Existing Sunrise student ID missing');
    const path = `/suite/students/${existing.studentId}/360`;
    const own = await api('GET', path, a);
    check('control', 'Own-school existing student access works', own.status === 200, { status: own.status });
    const foreign = await api('GET', path, b);
    check('tenant', 'Cross-school existing student access refused', [403, 404].includes(foreign.status), { status: foreign.status });
  });
  await run('RBAC regression', async () => {
    const parent = sunrise.users.find(u => u.role === 'Parent'); assert(parent);
    const token = await login(sunrise, parent.username);
    for (const [method, path, body] of [['GET', '/suite/admissions/pipeline'], ['POST', '/parents', { schoolId: sunrise.id, firstName: 'E2E', lastName: 'RefusalProbe', email: 'p1.refusal@sunrise.e2e.eduos.local', phoneNumber: existing.guardianPhone }]]) {
      const r = await api(method, path, token, body); check('rbac', `Parent ${method} ${path} refused`, r.status === 403, { status: r.status });
    }
  });
}
result.finishedAt = new Date().toISOString(); save();
const totals = { passed: result.checks.filter(c => c.ok).length, failed: result.checks.filter(c => !c.ok && c.category !== 'blocked').length, blocked: result.checks.filter(c => c.category === 'blocked').length };
console.log(JSON.stringify(totals));
if (totals.failed || totals.blocked) process.exitCode = 1;
