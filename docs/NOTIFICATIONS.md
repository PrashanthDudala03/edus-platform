# Built-in school notifications

Open the top-bar bell, then **Notification preferences**. Each account can mute routine categories and opt into browser alerts on its current device. Browser permission must be granted. Urgent notices and those requiring acknowledgement can bypass routine mutes.

The feature uses EduOS's own database and server. No external messaging account, paid delivery provider, or AI tokens are required. Existing hosting and database resources are still used. Browser alerts require the app to remain running; this is not background push after all tabs are closed. SMS, WhatsApp, email and mobile push remain unavailable.

## Access

- Authenticated school accounts receive only notifications addressed to them in their current school. Preferences affect only their own account.
- Existing module permissions control who can publish a circular or trigger other business events; the live connection cannot send announcements or select recipients.
- Accounts with `notifications.manage` can manage school wording and inspect delivery history. Existing school and data-scope checks remain in force.
- Platform accounts do not connect to a school inbox. Live groups are derived from verified school/user claims, with no client-accessible group-join operation.

## Delivery

Existing attendance, homework, results, fees, leave, communications, substitutions and admission producers write durable inbox entries. Scheduled communications use the existing worker. A stored event is deduplicated per school; recipient preferences and active-account checks apply before delivery.

After commit, the server sends a SignalR long-poll hint to the recipients. It contains only the notification ID. The browser fetches content through the scoped inbox API, updates the bell, and displays an in-app toast. Optional desktop alerts use generic text to avoid displaying school or student details on a lock screen. Reading an item also updates other connected tabs for that account.

The client reconnects automatically and refreshes the inbox. Existing 60-second unread polling remains a fallback when live delivery is unavailable. Failed live hints do not undo stored notifications. Access tokens stay in authorization headers; connection authentication expires with the token and refresh uses the existing sign-in flow.

## Verification

- Production frontend build and school-service Docker build pass; both services healthy on port 8081.
- 86 focused backend notification/delivery checks pass.
- `frontend/tests/security.spec.ts`, test `free notification live delivery, preferences and tenant isolation`, uses temporary QA schools and verifies unauthorized negotiation, forbidden client group joining, muted notices, live toast delivery, cross-user/cross-school isolation, read sync and device browser opt-in. Fixtures delete notification rows after testing.

Run the integration test against the local stack with `EDUOS_TEST_URL=http://localhost:8081` and Playwright's installed Chromium. No demo-school recipients are used by this test.

## School-wide delivery switches

Open Notifications → Notification delivery (/notifications/settings). Each implemented event has a school-wide delivery switch. Disabling an event blocks new inbox entries and live alerts, including required alerts for that event; stored inbox items and the original business records remain. Re-enabling applies to future producer calls and does not bulk resend old events. Unimplemented events are labelled unavailable.

Editing and viewing change history require school data scope and the separate notifications.settings.manage permission. The one-time migration grants it to standard Administrator and Principal roles; later restarts do not restore revoked grants. School boundaries still apply. Existing sessions may need to sign in again after the new permission is deployed.

Every disable asks for confirmation. Notice/message events additionally require explicit server-validated risk confirmation because urgent and acknowledgement-required alerts are affected. Settings use version checks to reject stale saves. Each successful change stores the actor, event, new state and time in the same transaction; the page displays the latest 100 changes for the current school.
`nDelivery settings verification: 86 backend notification checks and 126 shared permission/feature checks passed. Both real-service browser tests passed: live delivery/preferences and school-wide delivery controls (permission denials, risk confirmation, stale-save conflict, urgent suppression, school isolation, restored delivery, audit history and mobile overflow).

## Scheduled announcements

Open Communications, expand School scheduling timezone, and save the school's IANA timezone (the initial default is UTC). School-scope accounts with circulars.manage can change this setting; other communication managers use the saved zone. Changing it does not move already scheduled UTC instants.

Choose New communication ? Message ? Audience ? Delivery ? Schedule for later. Enter a date and time in the labelled school timezone, then review the server-resolved recipient estimate before saving. The final audience is resolved when published. Scheduling is limited to the next year. Daylight-saving gaps and repeated wall-clock times are rejected; choose an unambiguous time instead.

Use the Scheduled tab to open a notice, Change time, return it to draft, publish immediately or cancel with a reason. Existing lifecycle permissions, tenant checks, version conflicts and history apply. The existing worker checks due notices every 30 seconds, so publication can follow the chosen instant by one tick. School delivery switches and personal preferences still control notification alerts; the original communication remains readable to its audience.

Verification: production build passed; 35 communication/notification-tenancy backend checks, 9 frontend helper tests and 12 communications browser checks passed. A real-service QA test verified persisted school timezone isolation, a browser-independent UTC conversion, recipient preview, rescheduling, cancellation, automatic worker publication and exactly one matching recipient alert. QA fixtures removed their records afterwards.

## Acknowledge a notice from the inbox

Required school notices show Review & acknowledge in the notification inbox. This opens the full current notice; confirming records the signed-in account's acknowledgement through the existing circular acknowledgement endpoint, marks the alert read, and refreshes Communications tracking. Acknowledged badges persist after reload. Opening the review alone does not acknowledge it.

Review requires circulars.view plus ownership of the notification and current access to the live communication. Confirmation requires circulars.acknowledge. School and recipient scope are rechecked on the server. An account without the acknowledgement grant can read but cannot confirm. No new role permission is introduced. Both the client submission guard and the existing database uniqueness constraint protect against duplicate acknowledgements. If acknowledgement succeeds but marking read fails, the UI reports that distinction and keeps the acknowledgement confirmed.

Verification: production build and 35 targeted backend checks passed. Three existing communications/inbox browser regressions passed. A real-service test verified full-notice confirmation, no acknowledgement before confirmation, persistent badge after reload, mobile layout, cross-school/cross-recipient 404 responses, revoked permission denial and one acknowledgement after a repeated API submission. All recipients were isolated QA accounts.
