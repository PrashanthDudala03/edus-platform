# EduOS Exams & Report Cards

One workflow on the existing `exams` and `marks` suite records plus a new `assessment-schemes` record kind (no new
tables, no file binaries). Code: `services/school-service/Suite.Exams.cs` (rules, endpoints, report card), the
validation in `Suite.Academic.cs`, web `frontend/src/pages/suite/ExamsPage.tsx`, mobile
`mobile/src/features/academics/ExamsScreen.tsx` and `results/ResultsScreen.tsx`.

## Assessment schemes

Exams are not hard-coded as marks out of 100. A scheme (web: Exams → Assessment schemes) says how an exam is
assessed; an exam without a scheme is plain marks out of its own maximum with its own pass marks, as before.

| Type | Components (`Name:Max[:Pass]`, comma-separated) | Pass | Grades (`Label:MinPercent`, comma-separated) |
|---|---|---|---|
| Marks | one, or none (the exam's maximum) | pass percentage, or the exam's pass marks | optional; else the school's A–D thresholds |
| Components | two to eight, e.g. `Theory:70:28, Practical:30` or `Internal:20, External:80` | pass percentage; else the sum of component pass marks when every component has one; else the exam's pass marks. A component with its own pass mark must also be passed | as above |
| Grade | none | none | required, e.g. `A+:90, A:80, B+:70, B:60, C:50` |

A scheme used by published results cannot be changed; make a new one. Choosing a scheme on an exam sets its maximum
and pass marks (grade-only leaves them as entered).

## Lifecycle

```
Draft -> Scheduled -> MarksEntry -> Submitted -> Approved -> Published -> Closed
```

| Who | May |
|---|---|
| Administrator / Principal (`exams.manage`) | create and edit exams; move forward by any number of stages; return Submitted or Approved marks to MarksEntry with a reason; unpublish (Published -> Approved) with a reason; reopen Closed |
| Teacher (`marks.manage`, subject assigned in the class or class teacher) | enter and change marks while Draft, Scheduled or MarksEntry; submit for approval once at least one mark is entered |
| Leadership marks | may still correct marks until Published; never after |
| Students and parents | see exams once Scheduled (never drafts); see marks only once Published or Closed |

Each stage stamps who did it and when (`scheduledBy/At`, `submittedBy/At`, `approvedBy/At`, `publishedBy/At`,
`closedBy/At`, `returnedBy/At/returnReason`). Published exam details (class, subject, maximum, scheme) are locked.
Two exams of one class cannot overlap in time on one day.

## Marks

A mark carries `status` (Present, Absent, Exempt), `components` (`Theory=56; Practical=25`), `score` (the total,
worked out by the server), `grade` (from the scheme), `pass` and `remarks`. Absent scores 0 and grade AB; Exempt is
left out of totals (grade EX). Every change keeps the previous figures with who entered them (newest 10 in
`history`); the audit trigger records the row change as well. Marks never come from the client as totals or grades.

## API (all under `/api/v1/suite`, tenant from the token)

| Call | Permission | Result |
|---|---|---|
| `POST`/`PUT /records/exams` | exams.manage | create or change; `status` drives the lifecycle |
| `POST`/`PUT /records/assessment-schemes` | exams.manage | schemes (part of the exams module) |
| `POST`/`PUT /records/marks` | marks.manage | one mark; the scheme validates and totals it |
| `GET /exams/timetable?classId&yearId&term&from&to` | exams.view | the exams the caller may see, date order; families never see drafts |
| `GET /exams/overview?classId&yearId&term&status` | exams.view (staff) | per exam: assigned, entered, missing, absent, exempt, average, passed, failed, grade distribution; totals; students needing attention (leadership) |
| `GET /exams/{id}/marksheet` | exams.view (staff, own classes) | every student of the class with their mark, the scheme, and what the caller may do |
| `POST /exams/{id}/marksheet` `{entries:[{studentId,status,components,grade,remarks,version}], submit}` | marks.manage | fast class-wise entry: every row goes through the ordinary marks save; errors come back per student; `submit` then submits for approval |
| `POST /exams/{id}/transition` `{to, reason, version}` | checked per role | the one lifecycle call for schedule, submit, return, approve, publish, close, reopen |
| `GET /report-cards/{student}?examName&term&yearId` | reports.view (own students) | the report card: published results with components, totals where marks make them meaningful, attendance for the year, class teacher and principal |

The timetable, overview, marksheet and report-card shapes are what a future Student 360 reads for exam history,
subject performance, components and grades.

## Report card

Printed from the web (browser print to PDF) with the school's identity, student, year and term, each exam with
subject, marks, components, grade, result and remarks, totals and percentage where the schemes are marks-based,
subjects passed, attendance for the academic year from the register, and class teacher / principal / parent signature
lines. The data shape carries everything a school-specific template needs; templates are a later addition.

## Analytics (leadership)

Marks-entry completion, exams awaiting approval, open exams with gaps, pass rate, class and subject averages, grade
distribution, and students below pass marks in published exams. No ranks or leaderboards.

## Notifications

`exam.scheduled` when an exam leaves Draft (once per exam), `exam.rescheduled` when a scheduled exam's date, time or
room changes (once per new sitting), `result.published` when an exam with marks is published (existing, once per
exam). All to the students of the class and their linked parents with `exams.view` / `marks.view`; in-app only.

## Known gaps

- Report-card printing is web-only; the mobile app shows the same results and says so.
- Teachers are not notified when marks are returned for correction (the reason shows on their exam list).
- No school-specific report-card templates yet; the data shape is ready for them.
- Analytics are computed per request from the records; large schools may want a cached view later.
