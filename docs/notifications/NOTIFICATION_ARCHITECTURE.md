# EduOS notifications: architecture

One notification engine for EduOS. Web, mobile and (later) push, email, WhatsApp and SMS all read from or are fed by
it. Status and open items are in [NOTIFICATION_PROGRESS.md](NOTIFICATION_PROGRESS.md); every event is listed in
[NOTIFICATION_EVENTS.md](NOTIFICATION_EVENTS.md); push preparation is in [PUSH_SETUP.md](PUSH_SETUP.md).

```
Business transaction commits (a record, a register, a charge)
  -> producer            decides the template, the values, the event key and who may receive it
  -> Send()              picks the wording: the school's own, otherwise the EduOS default; fills the values
  -> Notify()            the only writer. One transaction:
        notify.notifications   the final text, once per event key
        notify.recipients      one row per person = the in-app inbox (available at once)
        notify.deliveries      the outbox: one row per person, channel and target
  -> delivery worker     (not built) takes due outbox rows -> channel adapter -> result, retry or give up
```

Nothing is sent to an outside provider from the request that caused the event. In-app needs no sending: it is
delivered by being stored.

## Where it lives

A module of `school-service`, not a new service: it needs the same database and the same account-link and class
data the suite already has. No queue or broker is used; the outbox is a table in the same Postgres.

| File | Holds |
|---|---|
| `services/school-service/Suite.Notifications.cs` | rules, event keys, outbox and device rules, the writer, producers, inbox and device API |
| `services/school-service/Suite.NotificationTemplates.cs` | wording: defaults, placeholder rules, school wording, template API |
| `services/school-service/Suite.NotificationHistory.cs` | delivery history API |
| `services/school-service/NotificationSchema.sql` | schema `notify` (idempotent, applied by the service on start) |
| `services/shared/EduOS.ServiceAuth/FeatureCatalogue.cs` | which permission keys make up a module (shared with auth-service) |

## Rules that do not change

1. **The server chooses recipients.** No endpoint creates a notification or accepts a recipient. `Notify()` drops
   anyone outside the school, inactive accounts, the person who caused the event and anyone who muted the category.
2. **Targeting follows RBAC and existing relationships.** Recipients come from role data scope plus the permission the
   content needs (`UsersWith`), and from reviewed account links (class, staff profile, guardian). Role names are never
   used and no relationship is invented.
3. **Tenant isolation.** Every statement names the `school_id` (and, for an inbox, preferences or devices, the
   `user_id`) of the verified token. Another person's notification answers 404.
4. **One event, one notification.** See Idempotency.
5. **Notifications are immutable.** Only a recipient's own read state changes. The text is stored as sent.
6. **A notification carries a destination key, never a URL or screen path** (`NotificationRules.Routes`).
7. **A failed notification never affects the event.** Producers run after the business transaction commits, on their
   own connection; errors are logged.
8. **Wording is plain text with allow-listed placeholders.** Nothing in a template is evaluated.
9. **A school that does not have notifications gets none.** `Notify()` and every inbox endpoint check the school's
   boundary (see [../FEATURE_CONTROL.md](../FEATURE_CONTROL.md)).

## Idempotency

Every notification has an **event key**: `type : source record [: occurrence]`, built by `NotificationRules.EventKey`.

| Event | Key | Why |
|---|---|---|
| Circular, homework, leave requested, fee charged | `type:recordId` | The record is created once |
| Leave approved / rejected | `type:recordId:v<record version>` | A later, different decision is a new event; the same save never repeats |
| Student absent | `attendance.absent:studentId:yyyy-MM-dd` | Once per student and day, however often the register is saved or corrected |

`notify.notifications` has a unique index on `(school_id, event_key)` and the writer inserts with
`ON CONFLICT DO NOTHING`. A retry, a repeated save, an API retry, a restart or a producer run twice therefore creates
nothing the second time; this does not depend on any client. Recipients are unique per notification
(`PRIMARY KEY(notification_id, user_id)`), deliveries per recipient, channel and target.

Limits: an event whose producer fails after the commit (crash, database blip) is logged and not retried. Because
producers are idempotent, a later reconciliation job can safely run them again. Two *different* records created by a
double submit (for example two identical leave requests) are two events; that is for the creating API to prevent.

## Delivery outbox

`notify.deliveries`: notification, school, user, channel, target, `status`, `attempts`, `last_error`,
`next_attempt_at`, `delivered_at`, `created_at`, `updated_at`.

| Status | Meaning |
|---|---|
| `pending` | waiting for the worker (`next_attempt_at` = when) |
| `processing` | a worker has claimed it; abandoned claims become due again after 10 minutes |
| `delivered` | done (`delivered_at`). In-app rows are written in this state |
| `failed` | with `next_attempt_at`: will be retried (after 1, 5, 30, 120 minutes; 5 attempts). Without: given up, or a permanent failure such as a token the provider no longer knows |
| `skipped` | reserved: the channel was not applicable (for example muted) |

The transitions are `DeliveryRules` (pure, tested). The worker is not built. When it is, it is a background loop
inside `school-service` that claims due rows with `FOR UPDATE SKIP LOCKED`, calls the channel adapter and stores the
result; several instances can run without sending twice. `target` is the device id for push and empty otherwise.
Rows for a channel are written only once that channel is in `NotificationRules.Available`, so nothing queues up while
there is no worker.

## Templates (wording)

A template is one kind of notification. Its key is also the notification type (`leave.approved`).

**Two levels.** EduOS defaults are code (`NotificationTemplates.All`): they ship with a release, always exist and
cannot be edited through any API. A school's own wording is a row in `notify.template_overrides`
(school, key, channel, title, body, enabled, version, updated_by, updated_at). Resolution: the school's row when it
exists, is enabled and is still valid; otherwise the EduOS default. Each notification records which was used
(`wording`, `wording_version`). A school can never change the default or another school's wording.

**Placeholders.** `{{name}}`, letters and digits only. Global list: `studentName`, `teacherName`, `schoolName`,
`className`, `date`, `startDate`, `endDate`, `dateRange`, `reason`, `remark`, `amount`, `dueDate`, `subjectName`,
`homeworkTitle`, `examName`, `circularTitle`, `circularMessage`. Each template accepts its own subset.

| Case | Rule |
|---|---|
| Unknown or wrong-event placeholder, malformed placeholder (`{{ x`, `{{a.b}}`, `{{1+1}}`, `{{{x}}}`), formatting tag | Saving is refused with the reason |
| Length | Per channel (`NotificationRules.Limits`): in-app 200 / 1000, push 65 / 240, email 150 / 1000, WhatsApp 60 / 1000, SMS 60 / 160. Refused beyond; results are clipped with an ellipsis |
| Empty | A title is required and is one line. A message may be empty. A school wording whose title comes out empty falls back to the default |
| Missing value | Becomes empty. Only the template's own placeholders are replaced |
| Braces, tags or placeholders inside a value (for example a circular's own text) | Shown exactly as typed. Values are inserted once and never read as a template |
| Line breaks | Kept in the message (at most one blank line); a title is always one line |
| Unicode | Kept. Control and direction-override characters are removed; half of a broken character pair is dropped; clipping never splits a character pair |

Clients show title and message as plain text.

**Who may edit.** A school-scope role holding `notifications.manage`. Teachers, parents and students cannot.

## Data

| Table | Purpose |
|---|---|
| `notify.notifications` | school, type, category, title, body, destination, source, `event_key`, `wording`, `wording_version`, created_by, created_at |
| `notify.recipients` | notification, school, user, read_at. The inbox |
| `notify.deliveries` | the outbox (above) |
| `notify.preferences` | school, user, category, channel, enabled. A row exists only where the default (on) was changed |
| `notify.template_overrides` | a school's own wording per template and channel |
| `notify.devices` | a phone registered for push: school, user, installation id, platform, push token, app version, enabled, revoked_at, last_seen_at |

## API (all under `/api/v1/notifications`, caller = token)

Own inbox, preferences and devices: any school account, when the school has notifications. No permission needed.

| Call | Result |
|---|---|
| `GET ?page=&unread=` | `{ items[], unread, totalCount, page, pageSize }`, newest first, 30 a page |
| `GET /unread-count` | `{ unread }` |
| `POST /{id}/read`, `POST /read-all` | marks the caller's copy read; 404 if it is not theirs |
| `GET /preferences`, `PUT /preferences` | categories, channels with `available`; only available channels can be changed |
| `GET /devices` | the caller's devices (never the token) and `pushAvailable` |
| `PUT /devices` `{installationId, platform, pushToken, appVersion}` | registers or refreshes this device for the caller; any earlier owner of the same installation or token stops receiving |
| `DELETE /devices/{installationId}` | removes the caller's device (used at sign-out) |

Management: school scope and `notifications.manage`.

| Call | Result |
|---|---|
| `GET /templates`, `GET /templates/{key}` | templates with variables, limits, default, school wording and which is in force |
| `POST /templates/{key}/preview` | text filled with made-up sample values; nothing stored or sent |
| `PUT /templates/{key}`, `PUT /templates/{key}/enabled`, `DELETE /templates/{key}?channel=` | save, switch, reset the school's wording |
| `GET /history?page=&type=` | what was sent: template, wording used, time, people, read count, failed and waiting deliveries |
| `GET /history/{id}` | each recipient (name and kind of account only), read state, channel, status, attempts, last error |

History never returns contact details, account or device identifiers, or the message body. Super Admin access across
schools is not built: platform accounts are refused by every suite endpoint, as elsewhere in EduOS.

## Channels

`in-app` is the only delivering channel (`NotificationRules.Available`). The others exist in the schema, limits and
preferences so nothing changes shape later, but they cannot be enabled and no client shows them as working.
