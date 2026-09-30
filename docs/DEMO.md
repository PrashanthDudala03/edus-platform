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
