# Deployment readiness and enterprise roadmap

This release provides the requested core school workflows locally. A production enterprise edition also needs operational ownership, stronger authorization, recovery evidence, and tested integrations.

## Current boundaries

- Fixed roles: SuperAdmin and Principal administer the school; teachers are scoped to assigned classes; parents/students are scoped by profile links. There is no configurable permission matrix, MFA, SSO, or separation of finance/HR duties yet.
- Admission forms are entered by school staff. A public applicant portal, application fees, waitlists, and multi-step approvals are future work.
- Staff leave is supported. Student leave approval and substitution planning are future work.
- Fees form a received-payment ledger. There is no online payment collection, refund/reversal workflow, settlement reconciliation, accounting integration, or bulk billing wizard. Do not modify recorded financial rows manually.
- Messages, reminders and absence notices are in-app. No SMS, email or WhatsApp provider is connected. Notifications currently require an administrator action; there is no delivery/retry scheduler.
- Printing uses browser Print / Save as PDF. Official signatures, school-specific transfer-certificate fields, QR verification, board formats, photos, and a visual template designer need school-specific implementation.
- Promotion updates the current class; audit history retains the change event, but a full historical enrollment transcript is a follow-up.
- Generic module search/filtering loads school records before paging; large-school performance needs measured database query optimization. Module Excel exports explicitly cover the displayed page. Report exports cover the returned report.
- Documents are restricted by record permissions, file signatures, extensions and size. No antivirus/content-disarm service is configured.
- Suite audit events include the actor where available; legacy activity records and allocation events do not always identify the staff member. Audit storage is not tamper-proof.
- Backup/restore tools exist; automatic scheduling, encryption, offsite retention and alerting remain deployment responsibilities.
- UI and API tests exercise selected workflows, not every possible school policy, browser, input or failure mode.

## Ordered implementation plan

| Priority | Deliverable | Acceptance gate |
| --- | --- | --- |
| P0 | Stage the release on a dedicated Linux host, HTTPS domain, secrets storage, restricted network access | No application/database service exposed directly; TLS and restore tested |
| P0 | Move the runtime to .NET 10 LTS and establish patch updates | All tests and container scans pass on supported patched images |
| P0 | Automated encrypted offsite backups, monitoring, restore drills and incident runbook | Demonstrate agreed recovery time and acceptable data-loss window |
| P0 | School pilot with administrator, teacher and parent reviewers | Signed-off admission, fees, attendance and report-card scenarios using representative data |
| P1 | Fine-grained permissions and approval limits; MFA, session revocation and verified recovery | Negative authorization tests per role/action/record and concurrent-change tests |
| P1 | Financial corrections, refund/reversal approvals, bulk billing and payment reconciliation | Immutable ledger, balanced totals, idempotent webhooks and audit evidence |
| P1 | Admission review stages, student leave, promotion history and result approval | Complete end-to-end flows with corrections and rollback rules |
| P1 | Queue-backed notification delivery and provider integrations | Retries, deduplication, verified callbacks, delivery/failure visibility |
| P1 | Database-level tenant protection and tamper-resistant audit export | Independent review against the agreed security requirements |
| P1 | Performance budgets, indexing, pagination, caching and load tests | Meet the school's measured peak attendance/fee-day workload |
| P2 | Transport, library, inventory, payroll, multi-campus controls | Add only after the school defines ownership and required workflows |
| P2 | Mobile/PWA experience, localization and richer dashboards | Role-specific usability and accessibility acceptance |

Do not label a release enterprise-ready solely because these options appear in a menu. Release gates should include reproducible evidence and named operational owners.

## Reference basis

- Use [OWASP ASVS](https://owasp.org/projects/asvs) to define and verify security requirements; this project has not been independently assessed or certified against it.
- [Microsoft's support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core), checked 2026-09-30, lists .NET 9 support ending 2026-11-10 and .NET 10 LTS support through 2028-11-14. Upgrade before a long-lived production deployment.
- Docker proxy address refresh follows the [Nginx proxy_pass/resolver documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).
- XLSX tooling uses the maintainers' [read-excel-file](https://github.com/catamphetamine/read-excel-file) and [write-excel-file](https://github.com/catamphetamine/write-excel-file) APIs.
