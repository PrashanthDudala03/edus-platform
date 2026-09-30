# Validation performed

Checked locally on 2026-09-30 against Docker Desktop Linux containers at http://localhost:8080.

| Check | Result |
| --- | --- |
| Complete API/browser regression | 21 tests passed in the final full run |
| Additional concurrent administrator race | 1 focused test passed; concurrent attempts cannot disable both remaining administrators |
| Authentication unit tests | 7 passed |
| Frontend production build | TypeScript check and Vite build passed |
| Changed backend projects | School, authentication and gateway builds passed |
| Docker application images | Rebuilt and started successfully |
| Runtime health | All nine default containers running and healthy |
| Frontend dependency audit | npm audit: no known vulnerabilities reported |
| Backend dependency audit | All six services: no vulnerable packages reported, including transitives |
| Backup/restore | Paired database and document backup; isolated database restore and registered-document verification passed |
| Accessibility | Automated axe WCAG 2 A/AA checks passed on the school-module screen |
| Visual/layout review | Desktop and mobile screenshots inspected; mobile page has no horizontal overflow |
| Repository patch check | git diff --check passed |

The 22 integration tests currently in the repository include the 21-test full regression and the additional focused administrator race test. CI is configured to run them together on future changes; the remote CI job has not been executed from this workspace.

## Covered behavior

- Anonymous access, school scope, malformed JSON and duplicate scope protection.
- Student/staff/guardian creation, edits, archive behavior and date-of-birth preservation.
- Admission acceptance creates student, guardian and class allocation atomically; repeat acceptance is rejected.
- Academic setup, role/profile boundaries, targeted circular acknowledgements and private records.
- Student/staff attendance, transactional rollback, leave approval and deduplicated in-app absence notices.
- Exact fee balances, concessions, duplicate charge rejection, concurrent idempotent payments, overpayment rejection and receipt access.
- Bounded marks, unpublished-result privacy, optimistic update conflicts and published report cards.
- Homework, student submissions, teacher feedback, attachment access and extension validation.
- Atomic import rollback plus actual browser XLSX import/export.
- Timetable overlap rejection, capacity rollback, class allocation consistency and preserved issued-certificate details.
- Browser module navigation, record creation, family portal, print-to-PDF document view and mobile layout.
- Single-use refresh rotation, immediate disabled-account checks, one-time recovery and old-session revocation.
- Paired backup/restore with a real uploaded QA document; live school database was not replaced.

## Artifacts and limits

Private screenshots are in .local/screenshots/release-desktop.png and release-mobile.png. Playwright's local report describes the most recent invocation; a focused invocation replaces the prior report. Backups and test artifacts are Git-ignored.

Tests create random isolated QA schools, then remove their records and uploaded files. Test backup bundles may retain that temporary QA school; the final post-test backup captures the current deployment after cleanup.

No live restore over the school database, public HTTPS deployment, external payment/messaging integration, browser matrix, load test, independent penetration test or enterprise certification was performed. Vulnerability reports are point-in-time package checks, not container OS scans or proof that the application has no defects.

See [DEPLOYMENT_READINESS.md](DEPLOYMENT_READINESS.md) for the remaining production gates.
