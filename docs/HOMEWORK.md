# EduOS Homework & Assignments

One workflow on the existing `homework` and `submissions` suite records (no new tables, no file binaries in
PostgreSQL). Code: `services/school-service/Suite.Homework.cs` (rules and read models), the rules in
`Suite.Academic.cs` (`ValidateBusiness`), web `frontend/src/pages/suite/HomeworkPage.tsx`, mobile
`mobile/src/features/homework/HomeworkScreen.tsx`.

## Submission modes

Daily notebook homework must not need a photo or a file. The teacher chooses how work comes back; the default is
a tap, and uploads appear only when the teacher asks for them.

| Mode (`submissionMode`) | Student | Teacher | Upload shown |
|---|---|---|---|
| `Done` (default) · Mark as done | taps "Mark as done" | checks off Completed / Late / Missing / Excused | no |
| `Text` · Text response | writes an answer in the app | reviews the answer, gives marks and feedback; may check off | no |
| `File` · Online file submission | hands in with optional notes, uploads files on the web | reviews files, marks and feedback; may check off | yes (web) |
| `Physical` · Physical / in-class | shows the work in class | checks off Completed / Late / Missing / Excused | no |
| `None` · No online submission | reads it | nothing per student | no |

Assignments made before modes existed count as `Text`. The teacher's check is stored on the submission record as
`outcome` (`Completed`, `Late`, `Missing`, `Excused`) with `verifiedAt`; it needs no student action, no record
beforehand and no upload. Files use the existing Suite Documents store (`suite.documents` metadata, bytes in the
document store), never a PostgreSQL column.

## Workflow

```
Teacher drafts (title, class, subject, due date and time, marks, submission mode, instructions, resources)
  -> publishes                       homework.status Published, publishedOn set, families told (homework.assigned)
Student (Done/Text/File)             -> marks as done or hands in       submittedAt, late (server clock), status Submitted
  -> hands in again before review    previous answer kept in history (newest 10), submittedAt and late recomputed
Teacher (any tracked mode)           -> Completed | Late | Missing | Excused per student, one click, no upload
Teacher (Text/File, or any record)   -> marks and feedback               status Reviewed, reviewedAt; family told (homework.reviewed)
Teacher closes                       -> no more hand-ins; reopening is allowed
```

## Rules (`HomeworkRules`, tested)

| Rule | Detail |
|---|---|
| Lifecycle | Draft -> Published -> Closed; Closed -> Published reopens; Published -> Draft only while nothing was handed in. Records made before the lifecycle existed count as Published. |
| Who may set work | Teachers for their classes, and only for a subject they are assigned to teach there (the class teacher may set any subject). Leadership anywhere in the school. |
| Who sees it | Students and families see Published and Closed assignments of the student's class, never drafts. |
| Hand in | Modes Done, Text, File only; while Published; until reviewed or excused. Text needs a non-empty answer. After the due moment the hand-in is accepted and marked late by the server. A hand-in clears a teacher's "Missing" check. |
| Due moment | Due date at the due time, or the end of the due day (UTC; schools have no time zone yet). |
| Students never set | `outcome`, `grade`, `feedback`, `status`, `late`, `submittedAt`: the server overwrites whatever a client sends. |
| Review | Marks must be within the maximum when one is set. Marks or feedback make the work Reviewed; clearing both returns it to handed in. |
| State for a student | Reviewed wins; then the teacher's check (Excused, Missing, Late, Completed); then the student's hand-in (late or completed); then the calendar: overdue tracked work is missing, `None` work just closes. |
| Class figures | submitted = handed in, reviewed or checked Completed/Late; pending = Text/File work handed in and not yet reviewed or checked; missing = overdue students without a hand-in or an Excused check, or anyone checked Missing. |

## API (all under `/api/v1/suite`, tenant from the token)

| Call | Permission | Result |
|---|---|---|
| `POST`/`PUT /records/homework` | homework.manage | create or change; `status` drives the lifecycle, `submissionMode` the workflow |
| `POST`/`PUT /records/submissions` | submissions.manage | a student marks done or hands in (again); a teacher's PUT may carry `grade`, `feedback`, `outcome` |
| `GET /homework/board?studentId=` | homework.view (own students) | the student's assignments with group, submission, check, marks, feedback |
| `GET /homework/overview?status=&classId=&subjectId=` | homework.view (staff) | per assignment: assigned, submitted, late, reviewed, pending, missing, excused |
| `GET /homework/{id}/submissions` | homework.view (staff, own classes) | review list: every student of the class, their work and their check |
| `PUT /homework/{id}/verify/{studentId}` `{outcome, version?}` | homework.manage | the one-click check; `""` clears it; creates the record when none exists |
| `PUT /homework/{id}/review/{studentId}` `{grade, feedback, version?}` | homework.manage | marks and feedback; creates the record for in-class work |
| `GET`/`POST /documents?recordId=`, `GET /documents/{id}` | documents.* | resources on an assignment; files on a submission in `File` mode (existing store) |

Both staff calls run through the ordinary record save, so the same validation, scope, audit row and notifications apply.
The board and review shapes are what a future Student 360 reads for assignment and submission history.

## Notifications

`homework.assigned` on publish (once per assignment, however often it is reopened), `homework.reviewed` once per
review with marks or feedback (the record version is the event occurrence). A teacher's check (Completed, Late,
Missing, Excused) is shown on the family's board and sends nothing. `homework.due` stays blocked: it needs a
scheduled run; the rule it would use is `HomeworkRules.DueAt`. No delivery channel beyond in-app.

## Known gaps

- Files are uploaded and opened on the web; the mobile app hands in with notes and shows how many files there are.
- Due-soon reminders need a scheduler (see `docs/notifications/NOTIFICATION_EVENTS.md`).
- Homework marks are not part of exam results or report cards, by design.
- No family notification for a Missing or Excused check; add one if schools ask.
- Students cannot delete a hand-in; a teacher can archive a submission record on the web.
