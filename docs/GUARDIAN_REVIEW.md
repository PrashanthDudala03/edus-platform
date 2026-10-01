# Guardian review hints

The directory guardian (`student_db.students.parent_guardian_id`) and verified
portal relationship (`suite.records`, `account-links`, `relationship=parent`)
remain separate. This change adds advisory checks, not synchronization.

- Parent signup review suggests students whose active directory guardian email
  matches the applicant's authoritative email, ignoring case and outer spaces.
  Selecting a student remains an explicit administrator action.
- Account-link editing and viewing show the directory guardian and matching or
  mismatching email. Missing/archived guardians and unavailable students are
  identified separately.
- `/control` lists active parent links needing review, with pagination. A second
  parent can legitimately differ from the single directory guardian.
- Platform administrators can inspect the same overview for a selected school.

`GET /api/control/guardian-review` accepts exactly one `userId` or
`signupRequestId`. It requires `account-links.manage` plus `users.view` or
`signup.review`, respectively. The account/request and student/guardian joins
are scoped to the authenticated school (or the platform-selected school).
`GET /api/control/guardian-mismatches` requires `users.view` and
`account-links.view`. Parent accounts cannot call either endpoint by default.

No schema migration, role changes, automatic linking, or token changes are
introduced. Guardian edits and archives update the hints on the next read but
do not silently grant or revoke portal access. No old QA-school cleanup is
included; focused tests remove only their own generated schools.

Validation: auth tests, frontend TypeScript/build, and the focused Playwright
suite `frontend/tests/guardian-review.spec.ts` (tenant isolation, unchanged
parent access, approval suggestions, link editor, and mobile overview).
