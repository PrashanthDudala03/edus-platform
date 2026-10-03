# EduOS notification event catalogue

Every event EduOS notifies about, or plans to. Design is in
[NOTIFICATION_ARCHITECTURE.md](NOTIFICATION_ARCHITECTURE.md). Update this when a template or producer is added.

## Status words

- **IMPLEMENTED**: template and producer are written and unit-tested. (Not deployed yet; see NOTIFICATION_PROGRESS.md.)
- **READY FOR PRODUCER**: the template exists and EduOS already has the event; only the call from the event is missing.
- **BLOCKED BY DOMAIN EVENT**: the template exists but EduOS has nothing that reliably raises the event.
- **FUTURE**: no template or type yet.

Default channel is `in-app` for every event; no other channel delivers today. The destination is a key each app maps
to its own screen.

| Event | Event key | Recipient (resolved on the server) | Destination | Variables | Status |
|---|---|---|---|---|---|
| Circular published | `circular.published` | The circular's audience by data scope, holding `circulars.view`; with a class set, that class's families and teachers (plus leadership when the audience is All) | `notices` | circularTitle, circularMessage, className, schoolName, date | IMPLEMENTED |
| Announcement | none yet | To decide: announcements (`/operations/announcements`) are a staff-side list that overlaps with circulars | `notices` | to define | FUTURE |
| Student absent | `attendance.absent` | Parent accounts linked to the student (account link `relationship = parent`) whose role holds `reports.view` | `attendance` | studentName, className, date, schoolName | IMPLEMENTED |
| Student late | `attendance.late` | As student absent | `attendance` | studentName, className, date, schoolName | IMPLEMENTED |
| Attendance corrected | `attendance.corrected` | As student absent, when a submitted register is corrected for the student and the status changed | `attendance` | studentName, className, date, status, reason, schoolName | IMPLEMENTED |
| Homework assigned | `homework.assigned` | Student and parent accounts linked to students allocated to the class, whose role holds `homework.view` | `homework` | homeworkTitle, subjectName, className, dueDate, teacherName, schoolName | IMPLEMENTED |
| Homework due | `homework.due` | As homework assigned | `homework` | homeworkTitle, subjectName, className, dueDate, schoolName | BLOCKED BY DOMAIN EVENT |
| Submission received | none yet | The teacher(s) assigned to the homework's class and subject | `homework` | to define | FUTURE |
| Result published | `result.published` | Student and parent accounts linked to the students who have a mark in the exam, whose role holds `marks.view` | `results` | examName, subjectName, className, schoolName | IMPLEMENTED |
| Exam scheduled | none yet | Students of the class, their families and its teachers | `home` until an exams destination exists | to define | FUTURE |
| Fee due | `fee.due` | Parent accounts linked to the student whose role holds `fees.view` | `fees` | studentName, amount, dueDate, schoolName | IMPLEMENTED |
| Fee overdue | `fee.overdue` | As fee due | `fees` | studentName, amount, dueDate, schoolName | BLOCKED BY DOMAIN EVENT |
| Payment received | none yet | Parent accounts linked to the student | `fees` | to define | FUTURE |
| Leave requested | `leave.requested` | School-scope accounts holding `leave-requests.manage` | `leave` | teacherName, dateRange, startDate, endDate, reason, schoolName | IMPLEMENTED |
| Leave approved | `leave.approved` | Accounts linked to the staff member's profile | `leave` | teacherName, dateRange, startDate, endDate, remark, schoolName | IMPLEMENTED |
| Leave rejected | `leave.rejected` | Accounts linked to the staff member's profile | `leave` | teacherName, dateRange, startDate, endDate, remark, schoolName | IMPLEMENTED |

## Producers: the event and its guard against repeats

| Event | Raised by | After | Sent once per |
|---|---|---|---|
| Circular published | a circular record is created | the record save commits | circular |
| Leave requested | a leave request record is created | the record save commits | request |
| Leave approved / rejected | a leave request's status changes to Approved or Rejected | the record save commits | request version (a later, different decision is announced; the same save never twice) |
| Student absent / late | `POST /suite/student-attendance` stores a student as Absent or Late for the first time that day | the register transaction commits | student and day, for a register of today or yesterday only. Saving again does not repeat it; a later correction is announced as a correction instead. Older registers notify nobody |
| Attendance corrected | a submitted register is corrected and the student's status changes | the correction commits | correction (a new event key each time; saving the same correction again sends nothing because nothing changes) |
| Homework assigned | a homework record is created (homework has no draft state) | the record save commits | homework |
| Result published | an exam's Publication changes to Published and the exam has marks | the record save commits | exam. Unpublishing to correct a mark and publishing again does not repeat it |
| Fee due | `POST /suite/fees/charges` issues a charge to a student (amount after concession above zero) | the charge transaction commits | charge |

Viewing or calculating a balance raises nothing. The manual fee reminder (`POST /suite/fees/{id}/remind`) and the manual
absence notice (`POST /suite/absence-notifications`) are older actions that write per-student message records; they are
unchanged and do not use this engine.

## Result published: what an exam's Publication switch means

An exam record is one class, one subject, one date, with `Publication` = Draft or Published. In the code:

| Rule | Where |
|---|---|
| Marks can be entered or corrected only while the exam is a Draft ("Unpublish this exam before correcting marks") | `Suite.Academic.cs` marks rule |
| Parents and students see the exam only when it is Published (teachers also see drafts) | `Suite.Core.cs` `Access()` |
| A family can read their child's marks only for an exam they can see, so only once it is Published | `Suite.Core.cs` `Readable("marks")` |
| Report cards include only Published exams | `Suite.Reports.cs` |
| Once Published, class, subject and maximum marks cannot change | `Suite.Academic.cs` exam rule |

So publishing an exam **that has marks** is the moment those marks are final (they cannot change while it is
published) and become readable by families: that is "results published", and it is what the producer announces.
Publishing an exam with **no** marks only makes the exam visible (an upcoming exam); the producer sends nothing then.
Because an exam record is one subject, families are told once per subject; the wording names the subject and class,
not a student or a mark.

## Blocked events

### Homework due, fee overdue: need a schedule

Nothing in EduOS runs on a timer. A future scheduler needs:

| Need | Detail |
|---|---|
| A daily run per school | at a fixed local time; schools have no time zone setting yet, so that must be added or one assumed |
| Homework due | homework whose due date is tomorrow; recipients as homework assigned, minus students who already submitted; key `homework.due:homeworkId:dueDate` |
| Fee overdue | charges past their due date with a balance; recipients as fee due; key `fee.overdue:chargeId:dueDate` (or per week, if reminders should repeat) |
| Safety | the event keys already make a run that happens twice harmless; the run must be claimed by one instance (a row lock or an advisory lock) |
| Decision | whether the manual fee reminder should become this event |

## Other events not yet connected

| Event | Where the event is in EduOS | Before switching on |
|---|---|---|
| Announcement, Submission received, Exam scheduled, Payment received | Records are created (an exam becomes visible when Published; payments by `POST /suite/fees/payments`) | Add the type, template and recipients; for submissions, resolve the teacher from teaching assignments |

Reserved types without a template yet: `message.received`, `timetable.changed`, `school-home.published`.
