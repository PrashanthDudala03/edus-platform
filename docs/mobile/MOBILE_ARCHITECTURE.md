# EduOS Mobile: architecture

`mobile/` is the one EduOS mobile app: React Native with Expo, TypeScript strict, Android first and iOS-compatible.
It is a client of the **existing** API Gateway (`/api/v1`). There is no mobile backend, no copied business logic and
no second permission system. Read this before changing anything under `mobile/`; progress and open items are in
[MOBILE_PROGRESS.md](MOBILE_PROGRESS.md), running it in [MOBILE_SETUP.md](MOBILE_SETUP.md).

## Rules that do not change

1. **The server decides.** School, role, data scope and permissions come from the verified account (`/control/me`).
   The app never sends or trusts a school id. Hiding a screen is a courtesy; the API refuses regardless, and every
   screen shows that refusal (403) safely.
2. **Tokens.** The refresh token rests only in `expo-secure-store` (Keychain / Keystore). The access token lives only
   in memory. Neither is logged, put in a URL, or stored anywhere else. AsyncStorage is not used for anything.
3. **No secrets in the app.** `EXPO_PUBLIC_API_URL` is the only configuration; it is a public address.
4. **No fake data.** A screen shows what EduOS returned, an honest empty state, or an error. Modules that are not
   built are listed as "Planned", never as working screens.
5. **Pure logic stays pure.** Session, HTTP client, errors, access, branding and notification routing have no React
   Native imports, so they run in Node tests. They import each other with explicit `.ts` extensions.

## Web and mobile: one product, two interfaces

EduOS Web and EduOS Mobile share the backend, authentication, tenant, permissions, RBAC, data and business rules.
They do not need the same screens.

| | For |
|---|---|
| **Web** | administration, configuration, bulk operations, deep management |
| **Mobile** | daily operations, quick actions, viewing, approvals, notifications |

Web only, by design (the app has no screen, tab or API call for these, and a test checks it): notification and email
wording, notification delivery history, system template configuration, roles and permissions, Super Admin
configuration, school configuration, bulk import, billing configuration, platform administration.

Mobile has: the notification inbox, read and unread, personal notification preferences, and (later) push on the device.

## Signing in, creating an account, recovering a password

The app uses the same public auth endpoints and the same rules as the web. Nothing was added on the server for it.

| Flow | Endpoint | Rule |
|---|---|---|
| Sign in | `POST /auth/login` | Email or username and password. No school code. When the name and password belong to several schools, EduOS lists them and the person picks one by name |
| Create account | `POST /auth/signup` | A **request**, not an account: name, email, mobile, school code, the kind of account asked for, password (16+ characters). The school administrator verifies the person, assigns the role and links the profile; only then can the person sign in, with the email as sign-in name. Unreviewed requests expire after 30 days |
| Reset password | `POST /auth/reset-password` | A one-time 64-character code issued by a school administrator after checking who is asking (valid 15 minutes), plus the new password. Every session of the account is then ended |

**School code.** The code a school gives to people who should ask for an account (shown to the school's
administrators under Access control on the web). It only says which school a request is for. It is used when creating
an account and nowhere else: not at sign-in. It is not the school's internal id, an unknown code and a deactivated
school get the same answer, and no endpoint turns a code into a school name. **School choice** at sign-in is a
different thing: it appears only after a correct password, for an account that exists in more than one school.

The web sign-in page also has an optional "School ID" field (an internal id). The app deliberately does not: the
school choice replaces it.

## Layout

```
mobile/
  app/                        Expo Router routes (file = screen)
    _layout.tsx               providers, one-time session restore, offline notice
    index.tsx                 front door: restoring -> signed in? -> where to go
    (auth)/login.tsx          sign-in
    (app)/_layout.tsx         AUTH GATE for everything below; re-reads /control/me every minute
    (app)/welcome.tsx         School Home (shown once after sign-in)
    (app)/(tabs)/             Home, Profile and every module screen (tab button only for the role's primary ones)
  src/
    services.ts               the app's singletons: api, session, queryClient, useSession
    api/                      errors.ts (normalise), client.ts (token + single-flight refresh), auth.ts, url.ts
    session/                  controller.ts (the whole session lifecycle), types.ts
    access/                   experience.ts (experience, navigation, canOpen), Guard.tsx
    theme/                    tokens.ts (design tokens), brand.ts (school colours -> readable shades)
    components/               ui.tsx (primitives), blocks.tsx (Header, Chips, ListItem, Group, StatTile, Sheet, Stepper),
                              ListScreen (virtualised list frame), QueryView, Splash
    features/data.ts          every module request and mutation, permission-gated
    features/logic.ts         pure types and rules shared by modules (tested)
    features/<area>/          school-home, home, parent, teacher, student, principal, homework, results, fees,
                              notices, attendance, leave, academics, profile
    notifications/routes.ts   notification type -> route, auth-gated; device-registration seam
    utils/format.ts           dates, figures, timetable grouping
  tests/                      Node test runner (`npm test`)
```

## Session

`createSessionController` (`src/session/controller.ts`) owns the lifecycle; `services.ts` mirrors its state into the
`useSession` store.

| Event | What happens |
|---|---|
| Launch | `restore()`: a stored refresh token is exchanged (`POST /auth/refresh`) for a new pair. None stored: sign-in. Refused: token removed, "session has ended". Offline: token kept, sign-in screen offers "Try again". |
| Sign in | `POST /auth/login`, then `GET /control/me` for the authoritative account. Only then is the refresh token stored. |
| Token expired | The client's 401 handler calls `refresh()` once; concurrent requests share that one refresh and are each repeated once. A refused refresh, or a second 401, ends the session. A dropped connection does not. |
| 403 | Never refreshes or signs out. It reaches the screen as a `forbidden` error. |
| Sign out | Registered cleanups run first (while the session still works), then `POST /auth/logout`, then secure storage, memory token, query cache and image cache are cleared. It completes even when offline. |
| While open | `/control/me` is re-read every minute and on return to the foreground, so role or permission changes apply. |

After signing in the person sees School Home once (`welcomePending`); a restored session goes straight to Home.

## Access and navigation

`experienceFor(user)` maps the **data scope** to an experience: `parent`, `teacher`, `student`, or `principal` (any
school-wide scope: Administrator, Principal, custom leadership roles). The platform administrator gets a "use the web"
screen. `navigationFor(user)` lists the role's entries, dropping any whose permission the account lacks. Entries with a
`route` exist today (all of them, as of phase 2). `tabsFor` picks the bottom tabs (Home, up to three role screens,
Profile); the remaining entries open from Home's shortcut grid and Profile's "More" list. Each role screen is wrapped in `Guard`, and `(app)/_layout.tsx` gates the whole group, so a deep
link cannot reach a screen while signed out or without an entry.

To add a module: build `src/features/<area>/`, add a route under `app/(app)/`, then give its entry a `route` in
`src/access/experience.ts` (and point notification types at it in `src/notifications/routes.ts`).

### Feature control (future)

The agreed model is Super Admin entitlement -> school enablement -> RBAC -> user preference, enforced by the server
through the existing permission boundary. The app is already compatible: navigation is derived only from the
permissions in `/control/me`. When `GET /control/features` and user preferences exist, `navigationFor` reads them;
no mobile-side permission store is to be added.

## Data

TanStack Query for all server data, through the single `api` client. Errors are always `ApiError`
(`src/api/errors.ts`): one shape for every service's error body, with safe messages (server internals are never shown).
`QueryView` draws loading, error (retry only when it can help), empty and loaded states. Queries pause offline and
resume; the floating offline notice appears while disconnected. There are no offline writes.

Module requests live in `features/data.ts`. A query is enabled only when the account holds the permission its endpoint
requires, so nothing is requested just to be refused. Writes (save attendance, hand in homework, request or decide
leave, acknowledge a circular) are the same calls the web makes; the server validates and authorises each one.
The full module list with its API is in MOBILE_PROGRESS.md.

| Screen | Existing API |
|---|---|
| School Home | `GET /suite/home`, images `GET /suite/home/images/{id}` with the bearer header |
| Parent: children + attendance | `GET /suite/reports/attendance?month=YYYY-MM` (one row per linked child) |
| Teacher: classes | `GET /suite/records/classes` (server returns only assigned classes) |
| Student / teacher: timetable | `GET /suite/records/timetable` (paged, 20 per page) + `GET /suite/options` for names |
| Leadership: overview | `GET /operations/overview?day=YYYY-MM-DD` |
| School name | School Home, else `GET /suite/school` |

## Design system and branding

`theme/tokens.ts` holds colour, spacing, radius, type and elevation; screens use `components/ui.tsx`, not raw styles.
`brandTheme()` turns a school's two colours (from School Home) into primary, deep, tint, soft, muted, accent and
on-accent shades with contrast guaranteed; invalid or missing colours fall back to EduOS green. Branding is applied to
School Home, the tab bar tint and the School Home card. Ordinary screens stay in the EduOS palette on purpose.

## Notifications (not built)

Only the seam exists. `resolveNotificationRoute(payload, user)` is the single place that decides where a notification
or deep link leads: signed out -> sign-in (remembering the destination); unknown type or no access -> Home; otherwise
the mapped screen. `deviceRegistration` is a no-op with `register`/`unregister`; sign-out already calls `unregister`
while the session is valid. The next phase supplies the server (devices, inbox, push) and fills these in.
