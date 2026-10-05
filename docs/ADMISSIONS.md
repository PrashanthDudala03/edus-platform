# EduOS Admissions 2.0 and Student Onboarding 2.0

One workflow from application to active student. Code: `services/school-service/Suite.Admissions.cs` (rules, pipeline,
decisions, onboarding plan, checklist, activation), schema in `SuiteSchemas.json`; web
`frontend/src/pages/suite/AdmissionsPage.tsx`; mobile `mobile/src/features/admissions/AdmissionsScreen.tsx`.

## Data model

No tables were added. Applications are suite records (kind `admissions`), audited by the `suite_audit` trigger.

| Kind | Fields |
|---|---|
| `admissions` | academic year (defaults to the class's year), class applied for, first and last name, date of birth, gender, student email and phone, previous school, guardian name, relationship, email and phone, address, source, applicant notes, admission number (optional until activation), status, internal review notes. Server-kept: `applicationNumber` (APP-yyyy-nnnnnn), `answers`, `history`, `onboarding` plan, `submittedAt`, `decidedBy/At`, `studentId`, `parentId`, `activatedAt/By` |
| `admission-fields` | the school's own questions: label, key, type (Text, Paragraph, Number, Date, Dropdown, Single choice, Multiple choice, Checkbox, Document), choices, required, enabled, order |

Document questions form the onboarding document checklist; a school without any gets Birth certificate (required),
Proof of address (required) and Previous school transfer certificate (optional). Files are Suite Documents attached to
the application, read through the same protected endpoint.

## Lifecycle (server authoritative)

```
Draft → Submitted → Under Review → Approved → Onboarding → Ready → Active
                  ↘ Rejected   ↘ Waitlisted (→ Under Review | Approved | Rejected)
Draft, Submitted, Under Review, Waitlisted, Approved, Onboarding, Ready → Withdrawn
```

- Decisions use `POST /suite/admissions/{id}/transition {to, reason, version, acknowledgeDuplicates}`. Submitting, starting review and withdrawing need `admissions.manage` (an approver may also start review); approving, waitlisting and rejecting need `admissions.approve`. Rejecting, waitlisting and withdrawing need a reason. Repeating the current status changes nothing.
- Onboarding, Ready and Active are reached only through onboarding operations. A generic record edit never changes the status (409), and Active, Rejected and Withdrawn applications are never edited again (409).
- Every move is appended to `history` with actor, time and reason; every write is also an audit row.
- Applications accepted before 2.0 carry status "Accepted" and are read as Active.

## Duplicate detection

On every read of an application and before approval, the school's other live applications and its students are
compared: same admission number, same name and date of birth, same student email, or same first name with the same
guardian email or phone. A sibling (same guardian, different first name) is not a duplicate. Approval with possible
duplicates needs `acknowledgeDuplicates` (409 otherwise). Nothing is ever merged. Every query is bound to the school of the
token, so another school's records are never searched.

## Onboarding (a plan, then one activation)

`POST /onboarding/start` turns an approved application into a plan and creates nothing. `PUT /onboarding {section, …}`
fills it, each section validated server-side:

| Section | Rule |
|---|---|
| details | details confirmed; an admission number, if given, unused by any application or student |
| guardian | a guardian of this school whose email or phone is the application's (never a name match), or a new one from the application; relationship confirmed |
| documents | per document: Verified (needs an uploaded file), Rejected / Not applicable (need a note), Uploaded, Required |
| academics | a class of this school in the application's academic year; free places checked live |
| fees | fee structures of that class (needs `fees.manage`), or "no fees apply" with a reason; amounts come from the structures |
| accounts | optional: existing parent or student accounts of this school whose email matches the application and which are not linked to another student |

After each section the server recomputes the checklist: no blockers means Ready, otherwise Onboarding.

`POST /admissions/{id}/activate` (`onboarding.manage`) runs under the school lock in one transaction: it re-checks every
blocker, reuses or creates the guardian, creates the student (status Active, the chosen or next ADM number), allocates
the class (capacity checked again), issues one charge per chosen structure through the same code the Fees office uses,
creates the account links (sessions revoked so the new access applies), and marks the application Active. Any failure
rolls everything back. Activating again returns the same student and creates nothing; a second concurrent start or
activation waits for the lock and then finds the work done.

The pre-2.0 `POST /admissions/{id}/accept` remains as express acceptance for a submitted or approved application (guardian
by email, its class, no fees or accounts) through the same transaction; it needs `admissions.approve` and
`onboarding.manage`.

Account creation reuses the existing account system: the web creates the account with `POST /users` (users.create,
roles.assign) and a password nobody sees, then issues a one-time recovery code shown once to the office. No plaintext
password is shown or stored.

## API

| Call | Permission |
|---|---|
| `GET /suite/admissions/pipeline?status&yearId&classId&search&missingDocuments&page` | admissions.view (office) |
| `GET /suite/admissions/{id}`, `GET /suite/admissions/{id}/candidates` | admissions.view (office) |
| `POST /suite/admissions/{id}/transition` | admissions.view at the gateway; manage or approve per decision in the service |
| `POST /suite/admissions/{id}/onboarding/start`, `PUT /suite/admissions/{id}/onboarding`, `POST /suite/admissions/{id}/activate` | onboarding.manage |
| `POST /suite/admissions/{id}/accept` | admissions.manage (plus approve and onboarding.manage in the service) |
| `/suite/records/admissions`, `/suite/records/admission-fields` | the record permissions |

## Permissions

| Key | Default roles |
|---|---|
| admissions.view | Administrator, Principal |
| admissions.manage | Administrator |
| admissions.approve (new) | Administrator, Principal |
| onboarding.manage (new) | Administrator |
| admission-fields.view / .manage / .archive (new) | Administrator, Principal / Administrator / Administrator |

Granted to existing schools by `services/auth-service/Migrations/20261006_01_admissions_onboarding.sql` (applies on the
next auth-service start). Teachers, parents and students hold none of these.

## Privacy and security

- Office endpoints require a school-scope account with `admissions.view` before any lookup; foreign ids answer 404.
- Families never see applications, review notes, decision reasons or history. Before activation no family account is linked, so a parent cannot see a child that is not yet a student.
- Student 360 shows an `admission` section: admission number and date for teachers; plus application number, status and document counts for the office and the family. Never notes, reasons or history (guarded by tests).

## Notifications

`admission.submitted` (approvers), `admission.approved` and `onboarding.ready` (office with onboarding.manage),
`student.activated` (the family's linked accounts). In-app wording is editable per school; category `school`. Rejection
and waitlisting send nothing (applicants have no accounts yet).

## Web and mobile

Web: `/suite/admissions` with summary cards, status tabs with counts, search, class and missing-document filters, duplicate
flags; the application page with details, answers, history, documents, decisions, and the onboarding stepper (Applicant,
Guardian, Documents, Academics, Fees, Accounts, Review & activate) showing what is done, what blocks activation and what
comes next. The admission form is configured at `/suite/admission-fields`. Tested at 1440, 1024, 768, 390 and 360 px.

Mobile (leadership): the pipeline summary, applications to decide, an applicant's summary with duplicates and onboarding
blockers, and review / approve / waitlist / reject where permitted. Configuration, onboarding steps and activation stay
on the web. Parents and students see nothing of admissions; after activation their usual screens include the student.

## Deferred

- Online application by families (public form) and parent document upload.
- Roll numbers separate from admission numbers; sections managed apart from classes.
- Concessions at onboarding (given in Fees after activation); reviewer assignment; admission tests or interviews.
- Notifications to applicants without accounts (email/SMS).
