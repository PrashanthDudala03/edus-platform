# Workflow audit — 23 October 2026

Work one portal/module at a time. Recheck completed items only when relevant code, permissions, or API behavior changes. Keep save/publish/delete checks separate from navigation checks. Use isolated temporary records for write tests.

## Completed: teacher portal navigation

Local deployment: http://localhost:8081. Real Chromium and seeded teacher account. No school records changed.

- 22 unique sidebar destinations opened successfully, including dashboard, classes, timetable, Student 360, attendance, homework, submissions, exams/marks, reports, communication, calendar and leave.
- Pages settled without JavaScript exceptions, failed API responses or persistent workspace loading.
- At 390px viewport width, none of these pages caused document-level horizontal overflow. Desktop navigation also checked.
- Teacher request to the fee-summary API returned HTTP 403 as expected.
- No application fix or rebuild needed for this navigation pass.
- Evidence: teacher-navigation-2026-10-23.json. Audit timings include an intentional 400ms render-settling allowance and are not API latency measurements.

## Previously verified

- Student 360: teacher click → picker → profile → return → refresh; single-child parent cached redirect; role-specific visibility.
- Student 360 card padding/wrapping: live desktop, tablet and phone bounds checked.
- AI routing and staff/leave/finance lookups: recorded in ai/LOCAL_SETUP.md.

## Completed: teacher attendance checks - 23 October 2026

- Five existing browser tests passed: class marking/submission, reason validation for corrections, leadership registers, family days, and 390px layout. Browser tests use isolated mocked records.
- 21 focused AttendanceRulesTests passed, including reason/status constraints, register states, correction dates and school-scoped SQL guards.
- Real demo-school API: invalid status and Other-without-remark rejected (400); unknown student rejected (403); Present entries submitted on initially empty test date 2001-01-02; reloaded statuses and Submitted state verified; repeated save changed zero rows; historical correction rejected (403).
- All temporary attendance, register and attendance-history rows removed in a finally block; zero remaining rows verified. Audit records retained. Only Present entries were saved, avoiding family notifications.
- Fixed low text contrast in workspace heading labels/descriptions; all five browser tests then passed. Frontend alone rebuilt/restarted.
- No exhaustive cross-school or valid-other-teacher roster attack test performed in this pass. No real current-day attendance changed.

## Completed: teacher homework and submission review - 23 October 2026

- Seven existing browser scenarios checked: creation/publishing, notebook checks, student submission/resubmission, done-without-upload, parent-only viewing, teacher feedback/marks, and mobile layout. Six passed initially; creation scenario failed only text contrast and passed its targeted rerun after the fix.
- 28 focused HomeworkRulesTests passed after the change.
- Confirmed live defect: first teacher notebook check returned 403 because write authorization required an existing submission. Fixed to allow a blank-response record for an assigned student/homework pair. Existing student responses and submission identifiers remain immutable; business validation still enforces assignment membership.
- Real API verification with unpublished temporary drafts: Completed check persisted, Excused update persisted, first staff review grade/feedback persisted, invalid outcome/over-limit marks rejected, forged new and modified student responses rejected (403), unknown student rejected (400).
- Drafts and their submissions removed in finally blocks and zero remaining records verified; audit retained. No publishing or family notification sent during live checks. Browser publishing/submission flows use mocks. Second staff-review edit was not live-tested to avoid notifying families.
- Fixed low contrast on summary captions. Rebuilt/restarted school-service and frontend only; both healthy.
- Reusable real API check: scripts/verify-homework-live.cjs (requires demo password environment variable). Cross-school isolation and full student live submission/resubmission remain outside this bounded pass.

## Completed: exams and marks - 23 October 2026

- 41 focused ExamRulesTests passed: lifecycle, marks/component validation, grading and visibility rules.
- Five browser scenarios checked: leadership exam creation/lifecycle; teacher component marks, absence and submission; student timetable/published results; parent child selection; 390px layout. Three passed initially; two failed only panel-description contrast. Fixed that contrast and reran only those two, both passing.
- Live unpublished temporary exam: teacher marksheet editable; score above maximum returned row error with zero saved; valid score 17/20 saved and reloaded; teacher approve/publish transitions rejected (409); parent timetable hid the draft and parent staff marksheet request returned 403.
- Temporary exam and marks removed in finally blocks, zero remaining records verified; audit retained. No exam scheduled/published or family notified during live checks. Successful approval/publishing and student result views were covered by isolated browser/rule tests, not live publishing.
- Frontend alone rebuilt for the contrast fix. No exam backend change needed. Reusable API check: scripts/verify-exams-live.cjs.

## Completed: communication and notices - 23 October 2026

- 28 focused CommunicationRulesTests passed.
- Twelve browser scenarios checked: compose/publish, delivery/acknowledgement summary, scheduled publication, teacher class restrictions, parent read/acknowledge, bell clearing, and layouts at 1440/1024/768/390/360px. Nine passed initially; three stopped at low-contrast supporting text. Fixed dash-list and toolbar text contrast, reran only those three, all passed.
- Live API: count-only audience preview; temporary draft create/edit/reload; draft absent from parent feed; parent draft-detail/audience requests denied (403); teacher school-wide audience preview denied (403).
- Temporary drafts removed with cleanup verification, audit retained. No live sending, publishing, read receipts or acknowledgements performed. Those actions were checked in isolated browser/rule tests.
- No backend change needed. Frontend rebuilt for contrast only. Reusable live check: scripts/verify-communications-live.cjs.

## Completed: teacher leave checks - 23 October 2026

- Four focused LeaveRulesTests passed: spans/durations, transitions, balances and server scoping guards.
- Three browser scenarios checked: leadership queue/impact/approval; teacher balance/request/withdrawal; mobile layout. Two passed initially; teacher scenario stopped at low table-heading contrast. Fixed heading contrast, reran that scenario, passed including request and withdrawal.
- Live API verified own balance/type retrieval; other-profile balance denial; teacher leadership-queue denial; parent balance denial; reversed-date validation; teacher self-approval rejection. Requests before/after were identical.
- No live leave request created, cancelled or decided, and no notifications sent. Successful request persistence, cancellation and approval were covered only by mocked browser tests/rules; full database lifecycle remains unverified.
- No backend fix needed. Frontend rebuilt for contrast. Reusable read/validation-only script: scripts/verify-leave-live.cjs.

## Completed: parent and student portal read workflows - 23 October 2026

- Real Chromium: 18 unique sidebar pages per role (36 total) opened without captured JavaScript/API errors or document-level mobile overflow at 390px. Main role navigation checked at desktop width. School Home excluded.
- Parent dashboard child switching verified against both linked children, including Student 360 target links. Student options returned exactly one linked student.
- Authorized fee ledgers and report cards loaded; school fee-summary and leadership leave queue denied (403) for both roles.
- Student sibling Student 360 and fee ledger requests denied (403).
- One existing payment receipt readable by its parent and linked student. No sibling payment existed in seeded data, so sibling receipt denial was not exercised. Printed receipt layout/payment actions not tested.
- Reused prior isolated homework/exam visibility and acknowledgement checks. No live mutations, acknowledgements, read receipts, payments or new records performed. No application fix or rebuild needed.
- Evidence: family-navigation-2026-10-23.json. Reusable scripts: audit-family.cjs and verify-family-receipts.cjs under scripts. Client navigation waits include 400ms settling time, not API timing.

## Completed: administrator directories - 23 October 2026

- Real Chromium tested administrator student, teacher and guardian directories using one temporary record each.
- Required empty fields blocked form submission. Create returned 201, edit returned 200, saved names survived page reload, and search found each record.
- Student birth date remained 2014-03-12 after edit/reload. Principal DELETE attempts returned 403 for all three record types.
- Archive returned 200 and removed the record from the active search results. No document-level horizontal overflow at 390px.
- All three temporary profiles physically removed after archiving in a finally block; audit retained. No accounts linked, notices sent or existing profiles changed.
- No application fix or rebuild needed. This does not cover every validator, duplicate conflict, bulk import/export, cross-school scope or all pagination cases.
- Evidence: directory-workflows-2026-10-23.json. Reusable check: scripts/verify-directories-live.cjs.

## Completed: administrator admissions checks - 23 October 2026

- Eight existing isolated browser scenarios passed: principal duplicate acknowledgement before approval, office onboarding/checklist/activation, parent denial, and 1440/1024/768/390/360px layouts.
- Seven focused AdmissionRulesTests passed.
- Live API with one temporary application: future DOB rejected (400), Draft created (201), edited surname persisted after reload, teacher approval attempt denied (403), parent detail denied (403), Draft withdrawal persisted.
- Temporary application removed in finally and zero remaining records verified; audit retained. No live submission/approval announcement, onboarding, accounts, activation or invitations. Successful review/onboarding activation was exercised only with browser mocks/rules, not a live database lifecycle.
- No application fix or rebuild needed. Reusable check: scripts/verify-admissions-live.cjs.

## Completed: class allocation and promotion checks - 23 October 2026

- Live API with two temporary students and classes of capacities 2 and 1: initial batch placement, successful promotion, reload, repeated same placement, and student-directory class-label consistency passed.
- Moving both pupils into capacity 1 returned 409 and preserved both prior placements, verifying transactional rollback. Empty and malformed selections returned 400. Teacher allocation attempt returned 403.
- Chromium verified loaded student selection controls and no document-level overflow at 1440px and 390px. No real student placement submitted through UI; end-to-end UI submit/confirmation was not exercised.
- Temporary allocations, students and classes removed in finally; audit retained. Existing student placements unchanged. No application fix or rebuild needed.
- Reusable checks: scripts/verify-allocation-live.cjs and scripts/check-allocation-ui.cjs. Cross-year downstream effects on existing homework/fees and cross-school allocation not exercised in this bounded pass.

## Completed: finance workflow checks - 23 October 2026

- 19 focused FeeRulesTests passed.
- Eight browser scenarios checked: collection/receipt/reversal, outstanding/daily reports, principal read-only, family receipt/online availability, mocked Razorpay checkout, fee-head access, role navigation labels and mobile layout. Seven passed initially; daily report failed only empty-state contrast. Fixed text contrast and reran only that scenario, passed.
- Live API checked two seeded charges: outstanding nonnegative, balance = net - paid for active charges, outstanding = max(0,balance), ledger outstanding sum matches totals.
- Zero-amount payment rejected (400); principal and parent collection attempts denied (403). Summary totals and today/month collection unchanged after checks. Existing receipt reads were already verified in the family audit and not repeated.
- No real/manual payment recorded, no reversal/concession applied, no external provider contacted. Successful payments/reversals/checkout tested with browser mocks and fee rules only, not a live transaction lifecycle. Fee-structure creation and all financial edge cases not covered by this bounded pass.
- Fixed empty-report guidance contrast; frontend alone rebuilt. Reusable check: scripts/verify-finance-live.cjs.

## Completed: library catalogue and loans - 23 October 2026

- Eleven AdvancedRulesTests passed (positive whole quantities, capacity and loan dates). Reuse this result for inventory/transport unless those shared rules change.
- Live temporary book/loans: fractional stock rejected, duplicate code rejected, checkout/reload passed, over-capacity checkout rejected, retirement while issued rejected, return/reload passed, reopening completed return rejected, invalid due date rejected, available copy reissued after return, teacher catalogue write denied.
- Temporary book and loans deleted in finally and zero remaining records verified; existing loans unchanged and audit retained.
- Chromium catalogue and loan forms: required fields blocked empty save, no document-level overflow at 1440px and 390px. Successful form submission not tested end to end; lifecycle saves were through real APIs. Concurrent checkout and overdue reporting not exercised in this bounded pass.
- No application fix or rebuild needed. Reusable checks: scripts/verify-library-live.cjs and scripts/check-library-ui.cjs.

## Completed: inventory and assets - 23 October 2026

- Live temporary asset: zero stock/fractional issue quantity rejected; duplicate code rejected; assignment/reload passed; over-allocation rejected; stock reduction below issued quantity and retirement while issued rejected.
- Issued quantity cannot be edited; early return date rejected; valid return persisted; completed return cannot reopen; returned stock reissued; teacher assignment write denied.
- Temporary asset/assignments removed in finally and zero remaining rows verified; audit retained. Existing assets unchanged.
- Chromium asset/assignment forms: empty required fields prevented save; no document-level overflow at 1440px and 390px. Successful form submits were not tested end to end; saves were exercised through real APIs. Concurrent issues and cross-school scope not exercised.
- Reused 11 passing AdvancedRulesTests from library because shared code did not change. No application fix or rebuild needed.
- Reusable checks: scripts/verify-inventory-live.cjs and scripts/check-inventory-ui.cjs.

## Completed: transport routes and assignments - 23 October 2026

- Live API with two temporary pupils, routes and one stop: invalid capacity rejected, duplicate stop order rejected, mismatched route/stop rejected; passenger assignment and reload passed.
- Duplicate active passenger and over-capacity second passenger rejected; occupied route deactivation and occupied-stop route move rejected; teacher assignment write denied.
- Passenger deactivation persisted and freed-seat reuse passed. Temporary routes/stops/assignments/pupils removed in finally, audit retained. Existing transport records unchanged.
- Chromium route/stop/assignment forms: required-field validation and no document-level overflow at 1440px/390px. Successful UI submit, concurrent seat claims, cross-school scope and all scheduling edge cases not covered.
- Reused the 11 passing shared AdvancedRulesTests; no shared code changed. No application fix or rebuild needed.
- Reusable checks: scripts/verify-transport-live.cjs and scripts/check-transport-ui.cjs.

## Completed: analytics and dashboard consistency - 23 October 2026

- Read-only live checks compared operational analytics with paginated source records: library title/issued/overdue counts, inventory types/assigned units, transport routes/passengers/capacity all matched.
- Admissions pipeline counts matched source application statuses. Administrator dashboard student/teacher/parent counts matched directories; class distribution summed to student count; daily marked/present-and-late totals matched the register for 2026-10-23.
- Teacher operational analytics access denied (403). Chromium analytics page settled without JavaScript errors or document overflow at 1440px/390px.
- Finance arithmetic checks reused from the completed finance pass. No records changed, no application fix or rebuild needed. Reusable check: scripts/verify-analytics-live.cjs.
- Coverage limits: seeded dataset only; no high-volume/concurrent totals, spreadsheet export verification, every dashboard metric, or custom permission-combination tests. A passing seeded comparison is not complete production readiness.

## Completed: final three audit areas - 23 October 2026

1. Health/backups: all 11 EduOS containers healthy, HTTP health 200. Primary database/documents backup created at backups/eduos-2026-10-23T11-03-33-731Z. Project backup briefly drained nginx/gateway and restarted them. Isolated restore rehearsal passed, temporary database removed, live DB never replaced. Zero registered documents in snapshot: nonempty file recovery not exercised.

2. Security: 11 live scenarios passed in isolated QA schools: tenant, role, header spoofing, family scope, admission/fee/communication boundaries, revoked sessions and bearer enforcement. Network test falsely flagged unrelated Ansys Minerva SubmissionService on host port 5000. Corrected frontend/tests/security.spec.ts to inspect this project Docker PortBindings, including AI; targeted rerun passed. All 12 scenarios now pass; unrelated services untouched.

3. Selected lifecycle/recovery gaps: security suite exercised real submissions/acknowledgements, fee and admission boundaries in temporary QA schools with fixture cleanup. Separate AI backup restored nine tables into temporary AI database, then removed. Backup retained at backups/ai-rehearsal-282dcac17cbf4c3e80a589028cefaba6 with SHA256 manifest. Main backup script still excludes AI; these are separate snapshots, not an atomic cross-database recovery point.

No production restore or external payment provider contacted. No matching Windows backup scheduled task found. This audit did not establish scheduled backups, encrypted/offsite retention or failure alerts. AI table restoration verified; full restored AI/document retrieval not exercised. Reusable AI backup check: scripts/verify-ai-backup.cjs.

## Remaining operational follow-ups

- Integrate AI into managed backup procedures and define cross-database consistency.

- Configure backup schedules, retention, protected offsite copies and failure alerts.

- Rehearse nonempty document recovery and complete application behavior against restored copies.

- Address load/performance and the per-module coverage limits above before production rollout.

## Not covered by this pass

See per-module coverage limits above. School Home, every modal/input, full keyboard accessibility, nonempty document recovery, production load and complete restored-application behavior remain unverified. Prior Student 360 contrast findings were not fully rerun. Passing selected checks is not full production readiness.

## Access control action alignment - 24 October 2026

Create account, Create role and Create role template use a common page action row outside content cards. Verified matching action x/y/height on Users, Roles and Role permissions at 1440px and 390px; dialogs opened and no page overflow. No accounts or roles created. Frontend build/typecheck passed and deployed on localhost:8081. Reusable read-only check: scripts/check-access-layout.cjs.

## Access control usability - 24 October 2026

Added a shared tab title/count/description/action toolbar; debounced account search with name/email/username hint, role/status filters, Clear filters, loading counts and empty results; Role permissions now offers a read-only role selector and effective permissions grouped/filterable by module with readable labels. Account search trims input and matches case-insensitively in the auth API. Real Chromium checks passed for uppercase search, empty results, filter reset, role/status controls, toolbar placement, create dialogs, module grouping against effective API keys and settled 390px layout. No access records changed during tests. Frontend typecheck/build passed; auth-service and frontend rebuilt and healthy. Reusable check: scripts/check-access-improvements.cjs.

## Access control follow-up - 24 October 2026

Added account role/scope and enable-disable permission previews, role-edit permission diffs, Active/Disabled/Never signed in account labels and never-signed-in filter, server-side access-history person/action/UTC-date filters, and consistent Cancel/Save footers. Forms show save errors within dialogs and guard busy dismissal; opening another form clears stale errors. Preview uses effective permissions and existing ceilings; server authorization remains authoritative. Signup requests remain the existing separate review queue; no invitation-delivery workflow or invitation status was invented.

Verified live history search/action/date results across 13 existing audit rows, reversed-date rejection, teacher and foreign-school denial, never-signed-in results, account role/disable preview, role preview and mobile layout. Verified Cancel issues no writes; simulated account/template save conflicts were intercepted and did not reach the server. No accounts, roles, templates or permissions were changed. Frontend build/typecheck passed; auth-service and frontend rebuilt/deployed. Focused checks saved in scripts/check-access-followup.cjs, scripts/check-access-form-error.cjs and scripts/check-template-form.cjs.
