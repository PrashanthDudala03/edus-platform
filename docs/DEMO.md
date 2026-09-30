# Development demo accounts

**DEVELOPMENT / TEST ONLY. Never seed a real deployment.**

```
node scripts/seed-demo.mjs --confirm-demo
```

This creates "EduOS Demo School" through the public API, so passwords use the normal hashing. It refuses to run against anything but localhost, never changes an existing account, and changes nothing when re-run.

Password for every demo account: `EduOS@Demo2026!!`
The requested `EduOS@Demo2026!` is 15 characters, but EduOS requires at least 16. Override with `EDUOS_DEMO_PASSWORD` (16+ characters).

| Role | Sign-in | Portal |
|---|---|---|
| Super Admin | superadmin@eduos.local | /super-admin |
| Administrator | admin@demo.eduos.local | /admin |
| Principal | principal@demo.eduos.local | /principal |
| Teacher | teacher@demo.eduos.local | /teacher |
| Parent | parent@demo.eduos.local | /parent (two linked children) |
| Student | student@demo.eduos.local | /student |

`frontend/tests/roles.spec.ts` needs this seed.

## Role model

| Role | Reads | Writes | Never |
|---|---|---|---|
| SuperAdmin (platform tenant) | platform overview, schools | create, edit, activate or deactivate schools; create school administrators | any school data or school portal |
| Administrator | whole school | everything in the school: users and roles, configuration, fees, admissions, allocation, imports, archiving | platform |
| Principal | whole school, including fees (view only) | exams, marks, timetable, teaching assignments, circulars, calendar, messages, homework, leave approval, staff attendance, certificates, student attendance, noticeboard | users and roles, fees, school configuration, admissions acceptance, allocation, imports, platform |
| Teacher | assigned classes and their students | attendance, homework, feedback and marks for assigned classes; own leave; messages to linked families | other classes, fees, users, configuration |
| Parent | linked children only | homework submissions, circular acknowledgement | other children, staff data |
| Student | own record only | own homework submission, circular acknowledgement | other students, including siblings |

## Access control (IAM)

Roles are no longer fixed to the six names above. Each school role is created from a platform
**role template** (SuperAdmin sets the template's maximum permissions), limited by the school's
**permission boundary** (SuperAdmin decides what each school may delegate), and then configured
by the school administrator. `GET /api/v1/control/me` returns the signed-in user's effective
permissions; navigation and the portals are built from that list.

| Where | Who | What |
|---|---|---|
| `/super-admin/access-control` | SuperAdmin | permission catalogue, role templates and maximums, per-school boundaries, any school's users and roles |
| `/control` | Administrator (or any role granted `users.view`, `roles.manage`, `signup.review`…) | own school's users, roles, permission matrix, signup requests and access history |

### Signup review demo

The seed creates three pending access requests in the demo school:

| Requested role | Email |
|---|---|
| Teacher | pending.teacher@demo.eduos.local |
| Parent | pending.parent@demo.eduos.local |
| Student | pending.student@demo.eduos.local |

They share the demo password. Before approval, signing in returns "Your account is awaiting school
administrator approval." The school signup code is printed at the end of the seed and shown on the
`/control` overview; new applicants enter it on `/signup`.

Demo flow: sign in as `admin@demo.eduos.local` → `/control/signup-requests` → **Review request** for
the pending teacher → pick the **Teacher** role and the teacher profile → **Approve** → sign out → sign
in as `pending.teacher@demo.eduos.local` → the Teacher portal opens and only permitted modules appear.
Pending requests that nobody reviews within 30 days expire and cannot be approved afterwards.

Every IAM change (approval, rejection, role change, permission change, boundary change, profile link)
is written to `auth_db.iam_audit` and shown under **Access history**. Every change also bumps the
affected users' `token_version`, so their current JWT and refresh tokens stop working immediately.
