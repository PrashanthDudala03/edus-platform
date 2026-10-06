# EduOS Communication 2.0 and Notification Delivery 2.0

One communication system for the school: a staff communication or a business event is resolved to an audience on the
server, worded from a template, stored once, placed in each person's in-app inbox, read, optionally acknowledged, and
reported back to leadership. Code: `services/school-service/Suite.Communications.cs` (rules, workspace, publication,
scheduling, read and acknowledgement tracking, scheduler), `Suite.Notifications.cs` (engine and producers),
`Suite.NotificationWorker.cs` (channel contract and delivery worker); web `frontend/src/pages/suite/CommunicationsPage.tsx`
and `frontend/src/pages/notifications/NotificationInboxPage.tsx`; mobile `mobile/src/features/notices/NoticesScreen.tsx`.
The notification engine itself is described in [notifications/NOTIFICATION_ARCHITECTURE.md](notifications/NOTIFICATION_ARCHITECTURE.md).

## What is implemented, and what is not

| Implemented | Architecture-ready / future |
|---|---|
| In-app delivery (web inbox with bell, mobile Notification Centre), read state, unread counts, mark read, mark all read | Push (FCM / APNs / Expo), email, SMS, WhatsApp: the outbox, the retry rules, the worker and the channel contract exist; **no provider is registered and nothing is sent outside EduOS** |
| Communications: draft, publish now, schedule, cancel, archive; priority; acknowledgement; expiry; attachments | Online acknowledgement reminders, applicant (no-account) messaging, academic-year audience, hand-picked recipient lists (use Targeted messages) |
| Audience resolution on the server; audience snapshot at publication; read and acknowledgement counts; outstanding list | Super Admin reading school communications (not authorised by the existing architecture; refused) |
| Durable scheduler and delivery worker loops inside school-service | A separate worker process, a broker or queue (not needed at this scale) |

## Data model

No tables were added and nothing existing was altered. A communication is the existing `circulars` suite record
(audited by the `suite_audit` trigger) with these fields:

| Field | Meaning |
|---|---|
| title, message | plain text; shown as text everywhere, never rendered as HTML |
| type | Circular, Notice, Announcement, Alert, Event |
| priority | Normal, Important, Urgent |
| audience, classId | All, Staff, Teacher, Parent, Student, Family; optionally narrowed to one class (a class record is one section) |
| requiresAcknowledgement, dueDate | "Yes" asks every recipient to acknowledge, optionally by a date. A pre-2.0 circular with an acknowledge-by date counts as requiring acknowledgement |
| status | Draft, Scheduled, Published, Archived, Cancelled. A pre-2.0 circular without a status is Published |
| publishAt, expiresOn | the scheduled moment (ISO 8601, UTC when no offset is given); an optional expiry shown as "expired", never hidden |
| server-kept | authorId, history, publishedAt/By, scheduledBy, snapshot, archivedAt, cancelledAt, cancelReason |

Publishing raises the existing `circular.published` event once (event key `circular.published:<record>`). The
notification's `notify.recipients` rows are the record of who it was for; `suite.acknowledgements` holds who
acknowledged. Delivery rows live in `notify.deliveries` as before.

## Lifecycle (server authoritative)

```
Draft → Scheduled → Published → Archived
  ↘ Cancelled   ↘ Cancelled, or back to Draft
```

- `POST /suite/communications/{id}/publish | schedule | unschedule | cancel | archive` with `{version, publishAt?, reason?}`,
  or the generic record save with a status. Both run the same rules under the school lock with a version check, so a
  double click or two people cannot cross; publishing something already published changes nothing and answers 200.
- Scheduling needs a future time within a year. Cancelling needs a reason. An expiry cannot precede publication.
- After publication the audience, class, type, priority and acknowledgement rule are frozen (409); the wording, the
  acknowledge-by date and the expiry may change and that is audited and never notifies again. Archived and cancelled
  communications never change.
- Every status move is appended to `history` (who, when, reason).

## Audience targeting and snapshot

The server resolves people from role data scope holding `circulars.view` (`UsersWith`) and from reviewed account links
when a class is set (families allocated to the class, teachers teaching it; leadership only for All and Staff). No
endpoint accepts a recipient id. A class of another school answers 404 before any rule runs.

At publication the record stores `snapshot` (count, time, audience in words) and the notification stores one recipient
row per person. Later class or role changes never rewrite either. The office reads intended (snapshot), notified
(recipient rows), read, acknowledged, outstanding and failed per communication, in three set-based queries for the
whole school, never one per recipient.

A parent with several children in the same class is one account and receives one copy.

## Priority and preferences

Normal communications respect a person's in-app mute of the "notices" category. Urgent communications and any that
require acknowledgement are school-required: they reach everyone addressed regardless of the mute, and the inbox title
starts with "Urgent:". Priority never bypasses authorisation. Only school leadership may send Urgent.

## Read and acknowledgement

| Action | Call | Semantics |
|---|---|---|
| Read | `POST /suite/communications/{id}/read`, or the inbox `POST /notifications/{id}/read` | marks the caller's own recipient row, once; both routes write the same row |
| Acknowledge | `POST /suite/circulars/{id}/acknowledge` | one row per person and communication (primary key); a second tap is a no-op; only a published communication addressed to the caller; nobody can acknowledge for someone else |
| Feed | `GET /suite/communications/feed` | the caller's published communications with their own readAt and acknowledgedAt, and how many still need acknowledging |

## Delivery states (exact semantics)

| Channel | Row | Meaning |
|---|---|---|
| in-app | written `delivered` in the publishing transaction | available in the inbox. "Read" is the recipient row's `read_at`. Nothing is claimed beyond that |
| others | `pending` → `processing` → `delivered` / `failed` | written only for channels in `NotificationRules.Available` (none besides in-app today). `delivered` is set only when a channel reports success; `failed` with a next attempt is retried after 1, 5, 30 and 120 minutes (5 attempts); a permanent failure, or a channel with no provider, stops at once and is counted |

The worker (`Suite.NotificationWorker.cs`) claims due rows school by school with `FOR UPDATE SKIP LOCKED`, hands each
to `DeliveryChannels.For(channel)` and stores the outcome by `DeliveryRules`; an abandoned claim becomes due again
after ten minutes. Provider errors are stored on the row and shown to notification managers only.

## Scheduling

Scheduled communications are database state (`status = Scheduled`, `publishAt`). A loop inside school-service
(`Suite.StartBackgroundWork`, every 30 seconds) publishes due ones as the person who scheduled them, under the school
lock, re-checking that nothing cancelled or published them meanwhile. A restart loses nothing: the next tick finds what
is due. Limitation: publication happens within the tick after the scheduled moment, not at the exact second, and a
scheduled communication whose expiry has passed by then is left scheduled and logged each tick until corrected.

## Idempotency

| Case | Guard |
|---|---|
| publish double click, two staff, scheduler and a manual publish | school advisory lock + version check + "already published" answer |
| the same event processed twice, retry, restart | unique `(school_id, event_key)` with `ON CONFLICT DO NOTHING` in the single writer |
| acknowledgement double tap | primary key `(school, record, user)` with `ON CONFLICT DO NOTHING` |
| mark read twice | `UPDATE … WHERE read_at IS NULL` |
| worker running twice | `FOR UPDATE SKIP LOCKED` claims, lease on abandoned claims |

## API

| Call | Permission |
|---|---|
| `GET /suite/communications?status&page`, `GET /suite/communications/{id}`, `GET …/{id}/acknowledgements`, `POST /suite/communications/audience`, `POST …/{id}/publish|schedule|unschedule|cancel|archive` | `circulars.manage` (a teacher given it sees and moves only what they wrote) |
| `GET /suite/communications/attention` | `circulars.manage` and a school-wide role |
| `GET /suite/communications/feed`, `POST /suite/communications/{id}/read` | `circulars.view` |
| `POST /suite/circulars/{id}/acknowledge` | `circulars.acknowledge` |
| `/suite/records/circulars` | the record permissions |
| `/notifications`, `/notifications/unread-count`, `/notifications/{id}/read`, `/notifications/read-all` | any school account (own inbox) |

No new permission key: the existing `circulars.view / manage / archive / acknowledge` and `notifications.manage` cover
everything, so no auth migration is needed.

## Roles

| Role | May |
|---|---|
| Administrator, Principal (`circulars.manage`) | compose, publish, schedule, cancel, archive any audience; see the attention summary, counts and who is outstanding |
| Teacher | read what is addressed to them; if the school grants `circulars.manage`, address the parents or students (or both) of one of their own classes, never staff, the school, another class or Urgent |
| Parent, Student | read their feed and inbox, acknowledge where asked; see nothing of drafts, scheduled or cancelled communications, history or figures |
| Super Admin | nothing: platform accounts are refused by every suite endpoint |

## Tenant isolation and family privacy

Every statement names the school of the token; foreign communications, classes and notifications answer 404 and leak
nothing. A recipient's feed, read marks and acknowledgements are bound to the token's user. The outstanding list shows
names and kind of account only, never contact details, account or device identifiers. Tested in
`frontend/tests/security.spec.ts` ("communications stay inside the school and the family") and `suite.spec.ts`.

## Audit

`suite.audit` receives `communication.published`, `communication.scheduled`, `communication.unscheduled`,
`communication.cancelled`, `communication.archived`, `communication.audience` (audience changed before publication)
and `communication.edited` (wording, expiry or acknowledge-by changed after publication), in the same transaction as the
write, in addition to the record trigger. Reads, inbox polling and acknowledgements are not audited; they are
notification and acknowledgement data.

## Templates

Unchanged: `circular.published` uses the school's own wording or the EduOS default with the allow-listed placeholders;
preview, validation, enable, disable and reset remain at `/notifications/templates`. Unknown placeholders are refused.

## Deep links

A notification carries a destination key, never a path. The web maps it to the first page the account may visit
(`frontend/src/pages/notifications/inbox.ts`); a notice opens the feed with the record id, and the server authorises
the record again. Mobile uses `resolveNotificationRoute` as before.

## Web and mobile

Web: `/suite/communications` is the workspace for managers (attention summary, status tabs, compose stepper Message →
Audience → Delivery → Review, detail with counts, history, attachments and outstanding list) and the feed for everyone
else; `/notifications` is the inbox, reached from the bell in the header. Tested at 1440, 1024, 768, 390 and 360 px.

Mobile: Notices shows the feed with priority and acknowledgement badges, records the read on opening, acknowledges once,
and shows leadership a short "needs attention" card. Composing, scheduling and history stay on the web.

## Performance

Audience resolution is a handful of set-based queries; recipients and in-app delivery rows are inserted with `unnest`;
counts for the whole school come from three grouped queries. No per-person request or write exists.
