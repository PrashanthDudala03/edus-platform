# EduOS Mobile: progress

The source of truth for what the mobile app does. Update it at the end of every mobile work session.
Architecture is in [MOBILE_ARCHITECTURE.md](MOBILE_ARCHITECTURE.md); running it is in [MOBILE_SETUP.md](MOBILE_SETUP.md).

Branch `feature/mobile-foundation`. The mobile app itself needs no backend change; the notification engine (phase 3) adds
backend code that is written but not deployed (see `docs/notifications/`).

## Status words

- **IMPLEMENTED**: works against the existing API and covers the module's main use on a phone.
- **PARTIAL**: usable, with a stated part missing.
- **BLOCKED BY API**: cannot be built without a server change; nothing is faked in its place.
- **FUTURE**: planned, not started.

## Shell

| Area | Status | Notes |
|---|---|---|
| Sign-in, secure session, restore, refresh, sign-out | IMPLEMENTED | Confirmed on a Samsung Galaxy S24 Ultra (Expo Go, SDK 57) by the owner. |
| Multi-school sign-in | PARTIAL | The app has the "Choose your school" sheet and signs in again with the chosen school. The server side is written (`POST /auth/login` answers 409 with `schools: [{ id, name }]` once the password is proved) but not deployed; until auth-service is rebuilt the app explains this and never asks for a school id. No mobile change was needed. |
| Create account (request access with a school code) | IMPLEMENTED | Same endpoint and rules as the web (`POST /auth/signup`). Sends a request that a school administrator must approve; not yet tried against the live service from the phone (it would create a real request). |
| Reset password (recovery code) | IMPLEMENTED | Same endpoint as the web (`POST /auth/reset-password`): one-time code from a school administrator plus the new password. EduOS has no email reset link, on web or mobile. |
| Switching account or school | IMPLEMENTED | Sign-out and every sign-in clear the query cache and the image cache, so no data, branding or photograph carries over. |
| School Home (native, branded, images) | IMPLEMENTED | Refined in phase 2 (status-bar shade, logo and greeting row, compact achievements). Look on device still to be reviewed. |
| Role Home (command centre) | IMPLEMENTED | Phase 3 redesign: branded header with shortcuts and the bell, one summary of the role's key figures, today, then what is coming up. |
| Navigation | IMPLEMENTED | Home + up to three role tabs + Profile; other modules open from Home or Profile "More". |
| Profile | IMPLEMENTED | Identity, school, role, More, sign out. Changing a password while signed in: BLOCKED BY API (no endpoint); the recovery code is the only way. |
| Offline notice, errors, loading and empty states | IMPLEMENTED | No offline writes. |
| Notification Centre (bell, unread badge, inbox, mark read, settings, tap to open) | PARTIAL | Built against the new `/notifications` API. Shows "not switched on yet" until the backend is deployed. |
| Push notifications | FUTURE | Device-registration seam only; no Firebase or push package. |
| Feature control | PARTIAL | Navigation follows server permissions only. `GET /control/features` is written on the server (not deployed); the app does not call it yet and needs no change until the device review. |

## Parent

| Module | Status | API | Notes |
|---|---|---|---|
| Children | IMPLEMENTED | `GET /suite/reports/attendance`, `GET /suite/allocations` | Linked children with class. |
| Attendance | IMPLEMENTED | `GET /suite/reports/attendance?month=`, `GET /suite/reports/attendance/days` | Monthly totals per child, plus each marked day with the reason the school recorded (absent, late and excused days first; "show all" for the month). |
| Homework | IMPLEMENTED | `GET /suite/homework/board` | Board per child: due today, upcoming, completed, late, missing, excused, reviewed; the teacher's check, marks and feedback. Parents read only. Files are counted, opened on the web. |
| Timetable | IMPLEMENTED | `GET /suite/records/timetable`, `GET /suite/options` | Weekly, by day. |
| Results | IMPLEMENTED | `GET /suite/report-cards/{student}` | Published exams with components (Theory + Practical), grade, absent/exempt, overall percent and grade, attendance for the year. Printable report card: web only. |
| Fees | IMPLEMENTED (view) | `GET /suite/fees` | Charges, received, outstanding. Online payment: BLOCKED BY API (does not exist in EduOS). Receipts download: FUTURE. |
| Notices | PARTIAL | `circulars`, `calendar`, `messages` records, `POST /suite/circulars/{id}/acknowledge` | Read and acknowledge. Whether a circular was already acknowledged: BLOCKED BY API (no endpoint returns it), so the tick lasts for the session only. |
| Calendar / events | IMPLEMENTED | `GET /suite/records/calendar` | Inside Notices. |
| Exams | IMPLEMENTED | `GET /suite/exams/timetable` | Timetable: upcoming and held, with time and room; never a draft. |

## Teacher

| Module | Status | API | Notes |
|---|---|---|---|
| My classes | IMPLEMENTED | `GET /suite/records/classes` | Tap a class to open its register. Shows the first 20 (API page size). |
| Mark attendance | IMPLEMENTED | `GET`/`POST /suite/student-attendance`, `GET /suite/student-attendance/registers` | Per-student status, "mark the rest present", structured reason per student, submit the class register, correction with a reason once submitted, register state badge. REQUIRES DEVICE TEST. |
| Attendance history | PARTIAL | same | The last 7 days can be opened and corrected. Older days and monthly staff reports: FUTURE. |
| Homework | IMPLEMENTED | `GET /suite/homework/overview`, `GET /suite/homework/{id}/submissions`, `PUT /suite/homework/{id}/verify|review/{studentId}` | Every assignment with handed in, to review and missing counts; student-by-student check (Completed, Late, Missing, Excused) and marks with feedback. Setting homework stays on the web. |
| Timetable | IMPLEMENTED | `GET /suite/records/timetable` | |
| Student / class view | PARTIAL | register rows | Students appear in the register by class. A student profile screen: FUTURE. |
| Notices | PARTIAL | as Parent | |
| Leave | IMPLEMENTED | `leave-requests` records | Own requests and "Request leave". Needs the account linked to a staff profile. |
| Exams | IMPLEMENTED | `GET /suite/exams/timetable`, `GET /suite/exams/overview`, `GET`/`POST /suite/exams/{id}/marksheet`, `POST /suite/exams/{id}/transition` | Timetable; marks entry per class with Present / Absent / Exempt, component fields, running total and grade; save as draft; submit for approval. Exam setup stays on the web. |

## Student

| Module | Status | API | Notes |
|---|---|---|---|
| Timetable | IMPLEMENTED | as above | |
| Homework | IMPLEMENTED | `GET /suite/homework/board`, `POST`/`PUT /suite/records/submissions` | Board with state per assignment; Mark as done, hand in a written answer, hand in again (earlier work kept on the server), late decided by the server; the teacher's check, marks and feedback. File uploads: web only (counted in the app). |
| Attendance | IMPLEMENTED | `GET /suite/reports/attendance`, `GET /suite/reports/attendance/days` | Monthly totals and each marked day with its reason. |
| Results | IMPLEMENTED | `GET /suite/report-cards/{student}` | As for parents, own record only. |
| Notices, calendar | PARTIAL / IMPLEMENTED | as Parent | |
| Exams | IMPLEMENTED | `GET /suite/exams/timetable` | Scheduled exams (server rule); results only once published. |

## Principal / Administrator

| Module | Status | API | Notes |
|---|---|---|---|
| School overview | IMPLEMENTED | `GET /operations/overview` | Enrolment, staff, today's attendance, by class. |
| Attendance overview | IMPLEMENTED | `GET`/`POST /suite/student-attendance`, `GET /suite/student-attendance/registers` | Whole-school register by class and day; today's registers (submitted, in progress, not started) on the Overview screen; corrections with a reason. REQUIRES DEVICE TEST. |
| Academics | IMPLEMENTED | `GET /suite/exams/timetable`, `GET /suite/exams/overview`, `GET /suite/exams/{id}/marksheet`, `POST /suite/exams/{id}/transition` | Timetable; every exam's stage with marks entered, awaiting approval and published counts; open a sheet to approve, return with a reason, or publish. Analytics and exam setup stay on the web. |
| Fee overview | IMPLEMENTED (view) | `GET /suite/fees` | Totals and charges. Issuing charges and recording payments stay on the web. |
| Leave approvals | IMPLEMENTED | `PUT /suite/records/leave-requests/{id}` | Approve or reject with a remark; version-checked. |
| Notices, calendar | PARTIAL / IMPLEMENTED | as Parent | Publishing circulars from the app: FUTURE. |
| Configuration, users, admissions, imports, certificates | Not for mobile | | Web only by design. |

## API gaps (documented, not worked around)

| Gap | Effect on mobile |
|---|---|
| No "my acknowledgement" on circulars | Acknowledged state is not remembered between sessions. |
| No online fee payment | Fees are view only. |
| No self-service password change | Not offered in Profile. |
| `/suite/records/{kind}`: 20 per page, no filters, filtered in memory | Lists read up to 10 pages; classes shows the first page. Will not scale to large schools. See "API contract review" below. |
| `GET /suite/options` is heavy and gives students few teacher names | Names for subjects and classes work; teacher names are often blank for students. |
| School choice at sign-in is written but not deployed | An account whose sign-in name exists in several schools cannot choose one until auth-service is rebuilt. |
| Login limited to 10 a minute per IP; refresh token lasts 7 days; no per-device revocation | Sign-in friction on shared networks; weekly password entry if unused. |
| School Home images served at original size | Extra data use on mobile. |
| No LMS, transport or advanced analytics in EduOS | Not present in the app. |

## API contract review (2026-10-03, nothing changed in the APIs)

Read-only audit of the endpoints the app uses. Tenant and permission enforcement were found consistent: every endpoint
takes the school from the token, maps to a permission in `PermissionAccess`, and scopes families and teachers through
reviewed account links.

| Endpoint | Finding | Minimum improvement |
|---|---|---|
| `GET /suite/records/{kind}` (homework, submissions, exams, circulars, calendar, messages, leave-requests, timetable, classes) | Loads every record of the kind for the school, filters in memory, fixed page of 20, `search` is a substring match over the whole record. The app reads up to 10 pages (200 records) to build one list | Add `pageSize` (up to 100) and filters applied in SQL: `classId`, `studentId`, `from` / `to` on the record's date field. That removes the 10-page loop without a new endpoint |
| Every suite endpoint for a teacher, parent or student | `Access()` reloads account links, classes, teaching assignments, enrolments, exams and homework for the whole school on each request | Narrow the queries to the caller's links; or cache per request burst |
| `GET /suite/fees` | Returns every charge of the school, filtered in memory; no pagination | Filter by the caller's students in SQL; add `page` |
| `GET /suite/options` | Heavy: many full lists for one call; students get few teacher names | A small `names` endpoint (ids to labels) for subjects, classes and teachers |
| `POST /suite/records/leave-requests` | A repeated request (double tap, retry) creates a second identical request, and a second notification | Refuse a pending request with the same staff member and dates, or accept an idempotency key |
| `POST /suite/records/homework` (web today) | Same: a repeated request creates a duplicate | Same |
| `POST /suite/records/submissions`, `POST /suite/student-attendance`, `POST /suite/circulars/{id}/acknowledge` | Safe to repeat (unique per homework and student; upsert; ignored if present) | None |
| Errors | Suite and notification endpoints answer `{ message }`; auth answers `{ statusCode, message }` (plus `errors` or `schools`). Every error has `message`, which is all the app reads | None needed; keep `message` in every new error |
| `GET /suite/home/images/{id}` | Original size | A sized variant, later |

## Verification

- 2026-10-04 (Student 360): new Student 360 screen on `GET /suite/students/{id}/360` and its timeline page: a student opens their own profile, a parent picks a child, teachers and leadership find a student in scope; overview, academics, attendance, homework, exams (published only), fees (office and family only), documents and timeline sections. Reached from Home and Profile, not a tab. `npm run typecheck` clean; `npm test` 68 passing. Not yet seen on a device.
- 2026-10-04 (Exams & Report Cards 2.0): Exams screen rewritten on the exam timetable, overview, marksheet and transition endpoints; Results screen shows components, grades, absent/exempt and attendance; leadership sees exam status and can approve, return or publish; exam notification routes added. `npm run typecheck` clean; `npm test` 65 passing. Not yet seen on a device.
- 2026-10-03 (Homework & Assignments 2.0): Homework screen rewritten on `GET /suite/homework/board|overview|{id}/submissions`, `PUT /suite/homework/{id}/verify|review/{studentId}` and the submissions record save; submission modes (Mark as done, Text, File, Physical, None), one-tap Completed / Late / Missing / Excused check for teachers, hand in and hand in again for students; Home shows what needs attention and what is to review. `npm run typecheck` clean; `npm test` 61 passing. Not yet seen on a device.
- 2026-10-05 (Smart Attendance): `npm run typecheck` clean; `npm test` 56 passing (register entries with reasons, correction detection, notification routes). Register, Children and Overview changes are not yet seen on a device.

- 2026-10-03 (layout and profile pass): the Home identity block (avatar, greeting, name, role) opens Profile for every role; sheet actions (Approve, Reject) sit side by side; Profile shows sign-in name, email, school and role in label and value rows; the account-type choice on Create account wraps instead of scrolling sideways. Marker is now "Build 5". Typecheck clean, 53 tests passing; not yet confirmed on the device. On the web the same pass added My account (`/account`, `/super-admin/account`) behind the header identity, and tables that become labelled cards below 900px; `frontend/audit-responsive.mjs` re-checks every role at a given width against the live API (read-only).
- 2026-10-03 (sign-in parity): Create account and Reset password screens added; sign-in screen links to them. `npm run typecheck` clean; `npm test` 53 passing (request payload and endpoint, account types, school code, password rule, recovery code, refusals, disabled account and school messages, no admin-only route or call in the app). Metro serves it as "Build 4". Not yet confirmed on the device.
- 2026-10-03 (notification foundation): no mobile file changed. `npm run typecheck` clean; `npm test` 42 passing.

- 2026-10-02 (backend foundations): notification types changed (`leave.decided` became `leave.approved` and `leave.rejected`, `attendance.marked` became `attendance.absent`, `homework.due` and `fee.overdue` added); only `src/notifications/routes.ts` and tests changed. `npm run typecheck` clean; `npm test` 42 passing. No screen changed.
- 2026-10-02 (phase 3): `npm run typecheck` clean; `npm test` 42 passing; `expo-doctor` 21/21; production export builds. Nothing from phases 2 or 3 has been seen on a device yet.
- 2026-10-02 (phase 2): `npm run typecheck` clean; `npm test` 36 passing; `expo-doctor` 21/21; Android bundle builds (dev server and a one-off production export); every endpoint above answers for the demo Parent, Student, Teacher and Administrator with the fields the app reads (read-only check).
- **Not yet verified on a device for phase 2:** the new Home, tabs and the seven new screens, including the write actions (save attendance, hand in homework, request and decide leave, acknowledge a circular). The phase 1 flow was confirmed on device by the owner.
- iOS has not been run.

## Runtime notes

- 2026-10-02: the phone kept showing the phase 1 app although phases 2 and 3 were written. Cause: the PC moved to another network (the phone's hotspot), Metro still advertised its old address, and Expo Go kept running the bundle it had already loaded. Metro now runs in tunnel mode (`npx expo start --tunnel`), which does not depend on the PC's address or the firewall.
- `mobile/src/build.ts` holds a temporary build marker shown on the sign-in screen and Home (now "Build 4"); clear it once the device review confirms the latest code loads.
- 2026-10-03: Metro runs in LAN mode on the home Wi-Fi (`exp://192.168.0.14:8081`); the tunnel stalled on the phone and was stopped.

- Runs in Expo Go on Android. The phone and PC share Wi-Fi; Windows Firewall must allow TCP 8081 on the private network.
- `mobile/.env` holds the HTTPS tunnel address of the gateway (gitignored).

## Next

1. Owner reviews phase 2 on the phone; fix what the device shows.
2. Finish the PARTIAL items that already have APIs: teacher homework (set, feedback), submission attachments, marks entry, receipts and report-card documents.
3. Notification service (server), then inbox and push in the app.
4. Feature-control endpoint and preferences (server), then read them in navigation.
5. EAS development build; app icon and splash; confirm the application id.
