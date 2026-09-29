# EduOS School Workspace

EduOS is a school administration application with a React/TypeScript interface, six ASP.NET Core services, PostgreSQL, and an Nginx gateway. The local deployment runs in Docker Desktop at **http://localhost:8080**.

## Local access

Open the private, Git-ignored **.local/ACCESS.txt** file for your generated administrator username and password. The school starts as **My School**; update its name and principal in **School settings**. No students or fictional dashboard totals are seeded into your school.

## Included workflows

- Live enrollment, staff, guardian, class, and attendance summaries.
- Searchable and paginated student, teacher, and guardian directories.
- Validated create/edit forms, archive confirmation, and CSV export of the current page.
- Daily attendance with class filters, present/absent/late/excused statuses, corrections, and atomic saving.
- Administration noticeboard with priority and removal confirmation.
- School profile and administrator/principal account creation and access control.
- Database-triggered activity history and CSV export.
- RSA-signed authentication, single-use refresh-token rotation, live disabled-account checks, school isolation at the gateway, and login rate limiting.
- Persistent PostgreSQL storage, service readiness checks, restart policies, bounded container logs, and backup tooling.

## Start and stop

Docker Desktop must be running with Linux containers.

~~~powershell
docker compose up -d --build --wait
docker compose ps
~~~

The included run.bat and run.sh also start the stack. Stop containers while retaining records:

~~~powershell
docker compose stop
~~~

Do not remove the PostgreSQL volume to fix an application error. It holds your school data.

## Fresh checkout

Install Node.js 24 and Docker Desktop, then:

~~~powershell
node scripts/setup-local.mjs
docker compose up -d --build --wait
~~~

Setup generates a fresh signing key and random passwords, preserves an existing .env, and writes the initial login to .local/ACCESS.txt. Bootstrap variables initialize an empty database; changing them later does not change an existing user's password.

Only Nginx is published, on 127.0.0.1:8080. Database and service ports stay inside Docker. pgAdmin is an optional observability profile.

## Development tools installed on this machine

Node.js 24 and .NET SDK 9 are installed privately in .tools. Use this PowerShell session setup:

~~~powershell
Set-ExecutionPolicy -Scope Process Bypass
. .\scripts\dev-shell.ps1
npm --prefix frontend ci
npm --prefix frontend run build
dotnet test services/auth-service.tests/auth-service.tests.csproj -c Release
~~~

Run the frontend development server with npm --prefix frontend run dev. It proxies API requests to Docker on port 8080.

## Tests

With Docker running, from a configured developer shell:

~~~powershell
cd frontend
npx playwright install chromium
npx playwright test
~~~

The integration/browser suite creates its own random QA school, exercises real services and desktop/mobile browsers, and deletes only that QA school's records afterward. It tests authentication, tenant isolation, malformed input, CRUD, attendance transactions, refresh replay/concurrency, disabled users, and last-administrator protection. Test reports are in frontend/playwright-report and screenshots in .local/screenshots.

## Backup and recovery

~~~powershell
node scripts/backup.mjs
~~~

This creates a PostgreSQL custom-format dump in the ignored backups directory and verifies that pg_restore can read its catalog. Store encrypted copies off this computer. Keep .env and signing keys separately in a secure location.

Restore into a **new empty database or separate PostgreSQL instance**, verify record counts and application access, then deliberately switch the deployment to it. Never restore over an existing school database without a verified backup and a planned recovery window. A valid dump catalog is not a substitute for a tested full restore.

## Deployment boundaries

This is a working local administration edition, not a claim of audited enterprise certification or universal absence of defects. Before using real school data on a network:

- Configure a domain and trusted HTTPS at the ingress; the current bind is intentionally localhost.
- Establish a data-retention policy, offsite backups, restore drills, monitoring, and access review.
- Both built-in roles can administer the school. Fine-grained permissions, SSO/MFA, parent/student self-service, fee payments, timetable scheduling, and messaging integrations are not implemented.
- The database activity log records the affected record, operation, and time. It is not a staff-attributed, tamper-proof compliance audit.
- Review local student privacy requirements and hosting controls with your school.
- Archived data remains in the database; restoration and permanent erasure require an administrator-operated database procedure.
- CSV exports are explicitly limited to the displayed page.
- Dependency and runtime updates remain ongoing maintenance.

See VALIDATION.md for checks actually run on this deployment.
