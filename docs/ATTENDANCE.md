# EduOS Smart Attendance

One daily register for the whole school. The existing table `school_db.attendance` (one row per student and day)
stays the single source of truth; the workflow around it is new. Code: `services/school-service/Suite.Attendance.cs`
(rules, endpoints, producers), `AttendanceSchema.sql` (additive schema), web `frontend/src/pages/suite/AttendancePages.tsx`,
mobile `mobile/src/features/attendance/RegisterScreen.tsx`.

## Workflow

```
Teacher opens the day and class  ->  marks everyone (one tap each, or "mark the rest present")
  -> adds a reason where it helps (Sick, Approved leave, Transport delay, Medical, School activity, Family, Other)
  -> submits the register for the class            school_db.attendance_registers: Submitted
  -> families are told (absent, late)              notification platform, once per student and day
Leadership sees every class: Not started / In progress / Marked / Submitted / Corrected, with totals
After submission a change is a correction          reason required; history row with the previous status;
                                                   register becomes Corrected; family told of the new status
```

| Rule | Where |
|---|---|
| Teachers mark only students of their linked classes; leadership marks the whole school | `Markable()` uses the existing account-link scope |
| A reason may go with Absent, Late or Excused, never Present; "Other" needs a remark | `AttendanceRules.ReasonProblem` |
| A correction (a change after the class register was submitted) always needs a reason | same |
| A teacher may correct their own register on the same day; earlier days are corrected by the office (Administrator or Principal) | `AttendanceRules.MayCorrect` |
| A register is submitted only when every student of the class has a status | `SaveRegister` |
| Saving the same register again changes nothing, writes nothing and notifies nobody | unchanged entries are skipped; notification event keys are unique per student and day |
| Every submission and correction is kept with actor, time, reason and previous status | `school_db.attendance_history` (also mirrored to `suite.audit` by trigger) |

## API (all under `/api/v1/suite`, tenant from the token)

| Call | Permission | Result |
|---|---|---|
| `GET /student-attendance?day=` | attendance.view | the caller's students with status, reason, remark |
| `POST /student-attendance` `{day, entries:[{studentId,status,reason?,remark?}], submit?, reason?, remark?}` | attendance.mark | saves changes; `submit` marks complete classes as Submitted; a correction needs `reason` or `remark` |
| `GET /student-attendance/registers?day=` | attendance.view (staff) | per class: expected, marked, present/absent/late/excused, state, teacher; school totals and percentage |
| `GET /student-attendance/history?day=&studentId=` | attendance.view (staff) | who changed what and why |
| `GET /reports/attendance/days?studentId=&month=` | reports.view (own students only) | each marked day with reason, monthly counts and percentage |
| `GET /reports/attendance/classes?month=&threshold=` | reports.view (staff) | month by class with percentage and students below the threshold (default 75%) |

Existing calls (`/reports/attendance`, `/operations/overview`, `/operations/attendance`, `/absence-notifications`) are unchanged.

## Notifications

`attendance.absent`, `attendance.late` and `attendance.corrected` templates (school wording editable on the web).
Sent only for a register of today or yesterday, through the existing producer rules.

## Known gaps

- No per-school switch to turn late notifications off; schools can only change the wording.
- The legacy "Issue absence notices" button still writes per-student message records and is unrelated to the platform notifications.
- No scheduled reminder for classes that have not submitted by a set time.
- Register completion is tracked per class name (`current_class`), as the register itself groups students.
