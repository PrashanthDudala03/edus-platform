# EduOS School Workspace

A locally deployable school ERP built with React/TypeScript, ASP.NET Core, PostgreSQL, and Docker. Open **http://localhost:8080**. Your generated login is in the private, Git-ignored **.local/ACCESS.txt** file.

## Start, rebuild, and stop

Run these in the project directory with Docker Desktop using Linux containers:

~~~powershell
docker compose down
docker compose up -d --build --wait --wait-timeout 180
docker compose ps
~~~

Normal `down` retains the database and document volumes. Do not add `-v` unless you intentionally want to delete school data. After an ordinary stop, `docker compose up -d --wait` starts the existing images.

## School workflows

The searchable sidebar exposes the workflows directly; **All school modules** groups them by function.

| Area | Available workflow |
| --- | --- |
| Admissions | Application form, PDF/image attachments, admission number, guardian details, acceptance that atomically creates the student/guardian and class allocation |
| Academics | Academic years, classes/sections, capacity, subjects, class teachers, teaching assignments, allocation and promotion |
| Attendance | Student registers, teacher-scoped marking, corrections, staff attendance, staff leave requests/approval, monthly reports, in-app absence notices |
| Fees | Class fee structures and instalments, concessions, charges, received payments, permanent numbered receipts, outstanding balances, in-app reminders |
| Exams | Schedules, draft/published results, bounded marks, remarks, configurable grade thresholds, report cards printable or saved as PDF |
| Communication | Administration notices, targeted circulars, acknowledgements, calendar, messages to linked accounts |
| Homework | Class/subject assignments, due dates, attachments, parent/student submissions, teacher feedback and grades |
| Teachers | Profiles, class/subject assignments, attendance and leave approval |
| Timetable | Weekly periods with teacher/class overlap checks |
| Role workspaces | Administrator, principal, teacher, parent and student; families see linked students, teachers see assigned classes |
| Certificates | Numbered student IDs, bonafide and transfer certificates; branded browser printing / Save as PDF |
| Excel tools | Student/staff XLSX or CSV import with preview and atomic commit; attendance, marks, admissions and fee exports |
| Settings/security | School profile, print identity/footer, account creation/disable, profile links, fixed role policies, one-time password recovery, activity history, paired backup and restore tools |

Payments record money already received; this app does not collect online payments. Notifications are in-app, with no claim that SMS or email was sent. Print formats use school details/footer and configurable grades, rather than a visual template designer.

## Initial school setup

1. Set school details in **School settings & accounts** and **Branding & print settings**.
2. Create teacher profiles, an academic year, classes/sections and subjects.
3. Add teaching assignments and timetable periods.
4. Enter admissions or import students, then allocate them to classes.
5. Create teacher, parent and student login accounts. In **Account profile links**, connect each account to the correct record. Parents can have multiple child links.
6. Create fee structures and exam schedules; begin attendance and homework.
7. Publish exam results when reviewed. Give families their login privately.

No fictional students or payments are inserted into your school. Test data uses separate temporary QA schools.

## Fresh checkout and development

Install Node.js 24 and Docker Desktop:

~~~powershell
node scripts/setup-local.mjs
docker compose up -d --build --wait --wait-timeout 180
~~~

Setup preserves an existing .env; on a fresh checkout it generates signing keys and random passwords. Changing bootstrap variables later does not reset an existing account.

On this machine, private Node and .NET tools are in .tools:

~~~powershell
Set-ExecutionPolicy -Scope Process Bypass
. .\scripts\dev-shell.ps1
npm --prefix frontend ci
npm --prefix frontend run build
dotnet test services/auth-service.tests/auth-service.tests.csproj -c Release
cd frontend
npx playwright install chromium
npx playwright test
~~~

The browser/API tests use real Docker services and temporary school records. Reports are in frontend/playwright-report. The frontend development server proxies requests to localhost:8080.

## Backup and restore

From a developer shell:

~~~powershell
node scripts/backup.mjs
node scripts/restore.mjs backups/eduos-<timestamp>
~~~

Backup briefly stops external access, then saves a matching database dump and uploaded-document archive with SHA-256 hashes. Access restarts afterward. The restore command defaults to a rehearsal: it restores into a temporary database and validates registered document names and sizes without replacing the school database.

An intentional live restore requires both flags:

~~~powershell
node scripts/restore.mjs backups/eduos-<timestamp> --apply --confirm edus
~~~

Use the actual POSTGRES_DB value instead of edus if changed. Live restore first makes a fresh rollback backup, then stops services and restores. A failure leaves services stopped for deliberate recovery. Test the procedure on staging before a real recovery. Store encrypted backups off this computer; keep .env and signing keys separately. Earlier database-only .dump files do not include documents and are not accepted as paired bundles.

## Deployment status

The current deployment binds only to **127.0.0.1:8080**. Internal services and PostgreSQL have no published host ports. Local functional validation is not enterprise certification.

See [DEPLOYMENT_READINESS.md](DEPLOYMENT_READINESS.md) for the production roadmap and known limits, and [VALIDATION.md](VALIDATION.md) for checks actually performed.
