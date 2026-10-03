# EduOS Student 360

One place that answers "what is happening with this student?". It is a read model composed on the server from the
modules that own the data; nothing is copied into new storage and no table was added. Code:
`services/school-service/Suite.Student360.cs`, web `frontend/src/pages/Student360Page.tsx` (route `/student360`
and `/student360/{id}`), mobile `mobile/src/features/student360/Student360Screen.tsx` (`/student360`).

## What it composes

| Section | Source of truth | How it is read |
|---|---|---|
| Header | `student_db.students`, `account-links` records, `auth_db.users` | name, admission number, class, year, status; contact details and guardian emails only where the role may see them |
| Academics | `suite.student_classes`, classes, academic-years, teaching-assignments, `teacher_db.teachers` | current year, class, section, class teacher, subject teachers |
| Attendance | `school_db.attendance` (Attendance 2.0) | this month and the academic year (present, late, absent, excused, percent), the latest ten marked days with reasons; the Attendance tab pages months through the existing days endpoint |
| Homework | homework and submissions records (Homework 2.0 rules) | counts per state, completion, work due or missing, recent teacher feedback |
| Exams | exams and marks records (Exams 2.0 rules), the report card | upcoming scheduled exams; published results only, with components and grades; report card print on the web |
| Fees | `suite.charges`, `suite.payments` | applicable, paid, outstanding, overdue count, recent payments; office and family only |
| Documents | certificates records, `suite.documents` | certificates issued to the student with their file counts; opened through the existing print and document endpoints |
| Notices | circulars records | the newest five the student's family would read |
| Timeline | attendance history, submissions, homework, exams, charges, payments, certificates | composed per request, newest first, paged |

## API (under `/api/v1/suite`, tenant from the token)

| Call | Permission | Result |
|---|---|---|
| `GET /students/{id}/360` | reports.view, own scope | the whole picture with the first timeline page (20 events) |
| `GET /students/{id}/360/timeline?page=&pageSize=` | reports.view, own scope | more of the timeline; page size 1–100, default 20 |

Both check the caller's scope before any lookup: a student sees only themself, a parent only linked children, a
teacher only students of their classes, the office the whole school. Anything else answers 403 whether the id is in
this school, another school, or nowhere. Leadership asking for a student of another school gets 404. There are no
writes.

## What each role sees

| Role | Contact details | Guardians | Fees | Everything else |
|---|---|---|---|---|
| Administrator, Principal | yes | yes | yes | yes |
| Parent, Student | yes (own) | yes | yes | yes |
| Teacher | no | names only | no (the section explains why) | yes |

Unpublished results never appear: the exams section counts and lists published exams only, through the same report
card rule families use. Missing data is shown as "—" or a sentence, never a zero that was not recorded.

## Performance

One request builds the overview: each module's records are loaded once per kind (the suite's existing pattern) and
the per-student figures are derived in memory; the SQL for attendance, fees, guardians and the timeline is bound to
the school and the student. Each timeline source is capped at the newest 200 rows and the result is paged, so a long
history never loads whole. The web tabs reuse the one picture; only the Attendance month view and further timeline
pages make another call.

## Deferred

- A unified event store: the timeline composes module records today and will read the store the same way once one exists.
- Fees 2.0: the figures here are the authoritative charge and payment sums; instalment plans, discounts beyond concessions and ageing wait for Fees 2.0.
- Achievements, sports and activities: no records exist yet; a section is added when they do.
- Student photos: the student record has no photo; the avatar shows initials.
- Report-card print and document files open on the web; the mobile app shows the figures and says so.
