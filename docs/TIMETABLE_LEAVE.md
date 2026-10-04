# EduOS Timetable 2.0 and Leave & Approvals 2.0

Two connected school operations: the timetable says who teaches which class when; leave says who is away; substitutions
join them so every lesson of an absent teacher is either covered or visibly uncovered. Code: `services/school-service/
Suite.Timetable.cs` (rules, effective timetable, operations, candidates, copy), `Suite.Leave.cs` (rules, balances, queue,
impact, decisions), schema in `SuiteSchemas.json`; web `frontend/src/pages/suite/TimetablePage.tsx` and `LeavePage.tsx`;
mobile `mobile/src/features/student/TimetableScreen.tsx` and `mobile/src/features/leave/LeaveScreen.tsx`.

## Timetable model

All timetable data is suite records (JSON in `suite.records`, audited by the `suite_audit` trigger). No tables were added.

| Record kind | Fields | Who writes |
|---|---|---|
| `period-slots` (Period structure) | name, order (1–24), startsAt, endsAt, type: Teaching, Break, Lunch, Assembly, Activity, Free | Administrator |
| `timetable` | classId, subjectId, teacherId, day (Monday–Sunday), slotId (optional), startsAt/endsAt (from the slot when one is chosen), room (optional free text), yearId (optional, defaults to the class's year) | Administrator, Principal |
| `substitutions` | date, timetableId, teacherId (the substitute), leaveId (optional, filled from the approved leave), note; server stamps `originalTeacherId` | Administrator, Principal |

Academic Year → Class (name + section) → Day → Period: a class belongs to a year; a lesson takes a period of the
school's structure (or its own times where a school has no structure yet). Non-teaching periods (break, lunch,
assembly, activity) belong to the structure and appear on every timetable; a teaching period with no lesson shows as
Free. Nothing about a school's timings is hard-coded.

## Conflict rules (`TimetableRules`, server side, 409 with the clashing lesson named)

- A period must end after it starts (400).
- Same day and same academic year, half-open overlap (ending at 10:00 does not clash with starting at 10:00):
  - teacher clash: "This teacher is already with Grade 6 - A at 09:00–09:45 on Monday."
  - class clash: "Grade 6 - A already has a period at …"
  - room clash (rooms compared trimmed, case-insensitively; empty rooms never clash): "Lab 1 is taken by …"
- A lesson without a year is checked against every year; lessons of different years never clash.
- A lesson needs a matching teaching assignment (class + subject + teacher) first.
- A lesson placed in a slot must use a Teaching slot; slots of one school cannot overlap each other or share a name.
- `POST /suite/timetable/copy {classId, fromDay, toDay}` copies a class's day onto an empty weekday, all or nothing, every copied lesson passing the same rules.

## Effective timetable (what readers see)

| Call | Permission | Scope |
|---|---|---|
| `GET /suite/timetable/week?classId|teacherId|room&date` | timetable.view | office: any; teacher: own teacher id or own classes; family: own class only; room views are office-only |
| `GET /suite/timetable/today?date&studentId|classId` | timetable.view | teacher: own lessons plus the periods they cover (`covering`, `originalTeacherName`); family: the class with the effective teacher |
| `GET /suite/timetable/operations?date` | substitutions.view, office only | teachers away (approved leave, or Absent/Excused in the staff register), affected lessons, covered / uncovered counts |
| `GET /suite/timetable/candidates?timetableId&date` | substitutions.manage, office only | every other teacher with `free` and the reason when not, subject/class teachers and lighter days first |
| Student 360 `timetable` section | reports.view | the class's day as the family reads it |

A family reads `effectiveTeacherName` and `substituted` only: no leave, no cover state, no reason. The office and the
teacher also get `away`, `status` (scheduled, covered, uncovered) and the substitution.

## Leave lifecycle

| Record kind | Fields |
|---|---|
| `leave-types` | name, code, paid (Paid/Unpaid), yearlyAllowance, tracksBalance (Yes/No), active (Yes/No); retained, never archived |
| `leave-requests` | teacherId, typeId (required once the school has active types), fromDate, toDate, halfDay (No / First half / Second half, single date), reason, status, approvalRemark; server stamps `days`, `submittedAt`, `decidedBy`, `decidedAt` |
| `leave-adjustments` | teacherId, typeId (must track a balance), direction (Add/Deduct), days, effectiveOn, reason; permanent history, never edited or archived |

Status: Pending → Approved | Rejected | Cancelled; Approved → Cancelled (leadership only). A teacher creates their own
Pending request and may withdraw it while pending (`POST /suite/leave/{id}/cancel`). Deciding needs
`leave-requests.approve` (`POST /suite/leave/{id}/decision {decision, remark, version}`), or a record edit by the same
rule; a rejection needs a remark. Decided leave is history: its teacher, type, dates, half day and reason cannot change
(409); only cancellation by leadership moves it. Overlapping Pending/Approved leave of one teacher is refused. Every save
goes through the ordinary record save, so the audit trigger records the actor and the notifications fire from it.

## Balance rules (server authoritative)

Counted in the current academic year (status Current), else the calendar year, by the request's first day.
`remaining = allowance + added − deducted − used`; `used` = approved days, `pending` = pending days, `afterPending =
remaining − pending`. A tracked type refuses a request or an approval that would exceed `remaining` (409 "Only n day(s)
of X remain."); a deduction cannot exceed `remaining`. `GET /suite/leave/balances?teacherId` (a teacher reads their own
only; the office names a staff member) returns every type with these figures and, for the office, the adjustment history.

## Approval workflow

`GET /suite/leave/queue` (office) lists pending requests with teacher, dates, type, days, reason, remaining balance and the
timetable impact summary. `GET /suite/leave/{id}/impact` lists each affected lesson (date, time, class, subject) with its
cover state. Impact is derived from the timetable at read time; nothing is copied into the leave record.

## Substitution workflow

For a teacher away on a date (approved leave, or Absent/Excused in the staff register), the office assigns a substitute
to one lesson for one date. The server refuses: the period's own teacher; a substitute who is away that day; one who
teaches at that time; one who already covers another lesson at that time; a date that is not the period's weekday; a
second substitution for the same lesson and date (change the existing one instead); any teacher, period or leave of
another school (404/400 before any rule runs). The substitute is told (`substitution.assigned`); a teacher who no longer
covers a lesson is told (`substitution.changed`). Families are not notified: their timetable carries the substitute's name.

## Permissions (IAM catalogue; granted to existing schools by `services/auth-service/Migrations/20261005_01_timetable_leave.sql`)

| Key | Default roles |
|---|---|
| timetable.view | all school roles |
| timetable.manage / .archive | Administrator, Principal / Administrator |
| period-slots.view / .manage | all / Administrator |
| substitutions.view / .manage | Administrator, Principal, Teacher / Administrator, Principal |
| leave-requests.view / .manage (request) | Administrator, Principal, Teacher |
| leave-requests.approve | Administrator, Principal |
| leave-types.view / .manage | Administrator, Principal, Teacher / Administrator |
| leave-adjustments.view / .manage | Administrator, Principal |

Effective permissions remain platform maximum → school allowed → school role → user token. Nothing was granted to make
a screen or test pass: teachers never approve, families never read leave.

## Security

Every statement names the school of the token (guarded by `TimetableRulesTests` and `LeaveRulesTests`). Scope is settled
from the token before any lookup. The live specs prove: School A cannot read School B's timetable, use B's teacher or
period in a substitution, read or decide B's leave, or read B's balances; a teacher cannot decide leave (not even their
own), alter another teacher's leave, or edit the timetable; students and parents cannot read leave, balances, the queue,
operations or substitutions, and their timetable payload never contains a leave reason.

## Notifications

Existing events reused: `leave.requested`, `leave.approved`, `leave.rejected`. Added: `substitution.assigned`,
`substitution.changed` (category and route `timetable`, in-app wording editable per school). Cancellation sends nothing.
`timetable.changed` stays reserved without a producer.

## Web

`/suite/timetable`: office tabs Today (cover for the day: away teachers, affected lessons, Assign/Change in one dialog
listing free teachers first), Class (week grid by period with add/edit/remove and Copy a day), Teacher, Room, Period
structure. Teacher: Today (now/next marked, periods covered) and My week. Student/Parent: Today and Week of the class,
with the child switcher. `/suite/leave-requests`: teacher Requests (withdraw) and Balance; leadership Pending approvals
(balance and impact per request, Impact dialog, Approve/Reject with remark), Calendar, Balances (with adjustments),
Cover today. Dashboards use the effective day; Student 360 shows today's class periods. Leave types and the period
structure are managed on their generic record pages.

## Mobile (Expo)

Timetable screen: one day at a time with week navigation, now/next, breaks, substitutes; teacher sees covered periods;
parent switches child. Leave screen: teacher balances, request with type and half day, withdraw; leadership queue with
balance and impact, approve/reject with remark, and Cover today with substitute assignment. Home shows the effective day.
Configuration (period structure, leave types, adjustments) stays on the web.

## Deferred

- Half-day leave counts as 0.5 days but affects every lesson of that day in the impact and cover views.
- Calendar holidays are not subtracted from leave days or impact (the calendar has no holiday flag yet).
- Supporting documents on a leave request; "return for correction"; multi-level approval.
- Removing a substitution archives the record without a notification to the substitute.
- Automatic timetable generation, room entities, per-term timetables with effective dates, timetable change notifications.
