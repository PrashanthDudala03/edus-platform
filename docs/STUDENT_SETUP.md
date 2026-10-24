# Student account connections

Open Access control → Users and choose **Complete student setup** beside an active student-scope account. The existing login is always reused; this flow does not create another student login.

## Two paths

- **Link existing student:** search by name, email or admission number, select the existing record and confirm that it belongs to the account holder. Matching emails are suggestions, not automatic links. Existing profile names, email and birth date are kept.
- **Create missing student profile:** names, email and phone come from the selected account. Enter the actual birth date, gender and optional address. Creation is refused if a live student record already has that email. Repeating a request after creation returns the existing profile instead of creating another.

Select a class and section or allocate later. Choose an existing guardian, create a guardian record, or keep the current guardian. Explicit relationship verification is required for guardian changes and parent-login connections. Parent logins offered for linking must match the selected guardian's email. Existing parent connections are shown and retained; changing a directory guardian does not revoke previously verified parent access. Existing profile links are not silently transferred or removed.

If the verified guardian has no parent login, an operator with account-creation, account-update and role-view access can create one using the existing account system. A random password is never displayed; a one-time recovery code is shown for private sharing. The login is created immediately, while child access is granted only after saving setup. Cancelling does not delete that login; it can be selected next time.

Review the connections before saving. Student/guardian records, allocation, access links and audit entries are committed together. New links invalidate the affected account's sessions so the new scope applies on its next sign-in. A parent can link to multiple children. A student account cannot be moved to another student, and a student already connected to another login cannot be claimed here.

## Permissions and scope

Setup is restricted to school-scope operators with users.view, students.view, parents.view, classes.view and account-links.manage. Creating a profile additionally requires students.create; new guardian records require parents.create; updating an existing student's guardian requires students.update; allocation requires allocations.manage. School and account scope are checked on the server. Platform-wide accounts do not use this school setup endpoint.

## Verification

Frontend production build and school-service compilation passed. Two new route permission cases passed. A real-service Playwright regression in frontend/tests/security.spec.ts verifies both profile paths through Access control, new/existing guardians, class assignment, existing parent login reuse, parent-login creation/recovery, child visibility after sign-in, duplicate prevention and cross-school/role denials. It uses temporary QA schools and cleans its records. No real student's setup is changed by this test.
