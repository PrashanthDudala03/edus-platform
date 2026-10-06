# EduOS notifications: progress

Update at the end of every session that touches notifications. Design is in
[NOTIFICATION_ARCHITECTURE.md](NOTIFICATION_ARCHITECTURE.md); events are in
[NOTIFICATION_EVENTS.md](NOTIFICATION_EVENTS.md); push preparation is in [PUSH_SETUP.md](PUSH_SETUP.md).

## Status (2026-10-03)

**Written and unit-tested. Not deployed: the tables do not exist yet and the running services do not have the code.
None of the SQL has run against a database.**

| Part | Status |
|---|---|
| Schema `notify` (6 tables: notifications, recipients, deliveries, preferences, template_overrides, devices) | Written; applied automatically when school-service next starts |
| Inbox API (list, unread count, mark read, mark all read), preferences API | Written |
| Templates: 10 EduOS defaults, placeholder rules, per-channel limits, school wording, fallback, template API | Written |
| Producers: circular published, leave requested / approved / rejected, student absent, homework assigned, result published, fee due | Written |
| Producers: homework due, fee overdue | Blocked: need a scheduler (see the event catalogue) |
| Idempotency: event key, unique per school, single writer | Written |
| Delivery outbox (status, attempts, last error, next attempt, delivered time) and delivery rules | Written; worker written (2026-10-06), no outside channel registered |
| Device registration API (register, list, remove) | Written; nothing is sent to devices |
| Delivery history API | Written |
| Feature gate: a school without notifications in its boundary has no inbox and receives nothing | Written |
| Permission `notifications.manage` (catalogue, grant migration, endpoint map) | Written |
| `GET /control/features` (auth-service) | Written |
| Web: Notification wording and Notification history pages | Written; checked in a browser against a mocked API |
| Mobile Notification Centre | Written earlier; shows "not switched on yet" until the backend is deployed. Not changed in this pass |
| Web inbox | Written (2026-10-06): `/notifications` with the bell in the header |
| Delivery worker | Written (`Suite.NotificationWorker.cs`); FCM adapter, push wording, mobile device registration: not started (see PUSH_SETUP.md) |
| Email, WhatsApp, SMS adapters | Not started |
| Editing EduOS defaults from the Super Admin console; Super Admin history across schools | Not started |

## To deploy (needs the owner's approval)

1. Rebuild and restart `auth-service`: adds permission `notifications.manage` to the catalogue and, once, grants it
   to each school's Administrator role and boundary (**school Administrators are signed out once**); serves
   `GET /control/features`; sign-in returns the school list for a name used in several schools.
2. Rebuild and restart `school-service`: creates schema `notify` (6 tables, additive, nothing existing is altered),
   serves the API, and starts producing notifications for new events.
3. Rebuild and restart `api-gateway`: adds the route and the permission-map entries.
4. Rebuild `frontend` for the two notification pages and the sign-in school choice.

Order: auth-service first (so every school's boundary holds `notifications.manage` before school-service checks it),
then school-service and api-gateway, then frontend.

Rollback: deploy the previous images; optionally `DROP SCHEMA notify CASCADE;` and remove the permission (see
`docs/MIGRATIONS.md`).

## Tests

- `services/school-service.tests`: 82 passing. Rules, templates and their edge cases, event keys, absence timing,
  safe text, outbox transitions, device validation, and a source guard: every notification statement names the
  school (and the person for inbox, preferences and devices), one writer with `ON CONFLICT DO NOTHING` on the event
  key, no outside provider in the request path, no device token returned.
- `services/shared/EduOS.ServiceAuth.Tests`: 93 passing. Endpoint permissions (inbox and devices open to every school
  scope; wording and history need `notifications.manage`), feature availability.
- `services/auth-service.tests`: 77 passing, including multi-school sign-in.
- `frontend`: 30 unit tests; `tests/notification-templates.spec.ts` (mocked API, real browser).
- **Not tested:** anything that needs a database: producers' recipient queries, the unique event key in practice,
  inbox and read state, preferences, wording rows, devices, history. First run is the deployment.
- `school-service.tests` is not yet in `.github/workflows/ci.yml`.

## Known gaps

- A producer that fails after the business transaction commits is logged, not retried (it is safe to re-run later).
- Existing records from before deployment produce no notifications; only new events do.
- A circular or homework edited after creation does not notify again.
- The older manual actions (fee reminder, absence notice) still write per-student message records and do not use this engine.
- An absence is announced only for a register of today or yesterday (UTC); schools have no time zone setting.
- Publishing an exam notifies once per exam record, which is one subject.
- No retention or clean-up of old notifications or revoked devices.
- Preferences are per category for in-app only.
- Wording changes are not written to the audit log; the row keeps who changed it last and when.

## Next

1. Deploy; verify each producer with one real action, a school wording, the history page and the feature switch.
2. Web inbox (bell in the shell).
3. Push: follow PUSH_SETUP.md.
4. Scheduler for homework due and fee overdue.
