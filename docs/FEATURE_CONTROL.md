# EduOS feature control

How a module is switched on or off for a school and for a role. There is one system: the existing permission
chain. Nothing here adds a second one.

## The chain

```
1. Platform   Super Admin sets the school's boundary        auth_db.school_access.allowed   PUT /control/boundary
2. School     School Administrator gives roles permissions   auth_db.role_permissions        inside boundary and role template maximum
3. RBAC       effective permission = role ∩ template maximum ∩ boundary ∩ enabled            auth_db.effective_permissions
4. Token      effective permissions and data scope are claims in the access token
5. Enforce    gateway and each service map the endpoint to a permission                       PermissionAccess.Required (unknown path = refused)
6. Clients    web (canVisit, menus) and mobile (navigationFor, tabs) hide what the token lacks
7. Person     notification preferences only (mute a category)                                  notify.preferences
```

## Two questions, kept apart

| Question | Answer comes from |
|---|---|
| **Does this school have the module?** | The boundary holds at least one of the module's permission keys |
| **May this person use or manage it?** | The person's effective permissions (which are already inside the boundary) |

Most modules need a permission even to read, so the two questions collapse. Two modules are **open**: everyday use
needs no permission, only that the school has the module.

| Open module | The school has it when the boundary holds | Any school account may | Managing needs |
|---|---|---|---|
| School Home | `school-home.manage` | read the published page | `school-home.manage` |
| Notifications | `notifications.manage` | read their own inbox, set preferences, register a device, and be sent notifications | `notifications.manage` (wording, history) |

So `notifications.manage` is never needed to read your own inbox, and removing it from a *role* only stops that role
managing. Removing it from the school's *boundary* (Super Admin) switches the module off for the whole school:
the inbox answers 403, nothing is produced, and School Home behaves as if nothing were published.

Implemented in `school-service` as `FeatureEnabled(school, feature)` (one indexed look-up of the boundary), used by
the School Home read endpoints, every inbox endpoint and the notification writer. No role or token changes, no
sign-outs. Existing schools are unaffected: every school's boundary already holds `school-home.manage`, and the
notification migration adds `notifications.manage` to every boundary. A school with no boundary row has nothing, as
in the rest of the chain.

## Feature map (`services/shared/EduOS.ServiceAuth/FeatureCatalogue.cs`)

| Feature | Keys | Open |
|---|---|---|
| `school-home` | `school-home.manage` | yes |
| `notifications` | `notifications.manage` | yes |
| `attendance` | `attendance.view`, `attendance.mark` | |
| `homework` | `homework.view`, `homework.manage`, `submissions.view`, `submissions.manage` | |
| `results` | `marks.view`, `marks.manage` | |
| `fees` | `fees.view`, `fees.manage`, `fees.collect` | |
| `exams` | `exams.view`, `exams.manage` | |
| `leave` | `leave-requests.view`, `leave-requests.manage` | |
| `ai` | `ai.assistant.use`, `ai.knowledge.manage`, `ai.usage.view` | |
| `transport`, `lms` | none (future; never enabled) | |

A test checks every key exists in `PermissionCatalogue.json`. To add a module: add its keys to the catalogue, map its
endpoints in `PermissionAccess`, add one line here.

## `GET /api/v1/control/features`

Any signed-in account. Takes nothing from the request. Reads the account's school boundary and effective permissions
(the same view the token is built from) and returns, for every feature:

```json
{ "key": "fees", "name": "Fees", "status": "available", "enabled": true, "allowed": true, "permissions": ["fees.view"] }
```

| Field | Meaning |
|---|---|
| `status` | `available`, or `future` for modules that do not exist yet |
| `enabled` | the school has the module |
| `allowed` | this account may use it (for an open module: the school has it) |
| `permissions` | the module's keys this account holds, so a client can tell reading from managing |

It is a view: it stores nothing, grants nothing and is never trusted by a service. Services keep enforcing with
`PermissionAccess` and `FeatureEnabled`. Platform accounts are not a school: every feature comes back not enabled.
Web and mobile do not call it yet; mobile navigation keeps following token permissions until the device review.

## Gaps (documented, not built)

1. **The boundary is edited key by key.** A module switch in the Super Admin console would add or remove a feature's
   keys at once. A console change over the same data.
2. **No per-school switch for a single notification event** (for example "do not send fee notifications"). If needed,
   an `enabled` flag per school and template beside the wording.
3. **Plans and entitlements** (billing) do not set the boundary. If wanted, a plan would write the boundary; the chain
   below stays as it is.
4. **AI also needs the AI service configured**; `enabled` here only says the school is entitled.
