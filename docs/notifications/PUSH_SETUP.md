# EduOS push notifications: preparation

Push is **not** switched on. No Firebase project, credential or push library exists in this repository. This page
says what is prepared, what the owner must create later, and the order to switch it on.

## What is prepared

| Part | State |
|---|---|
| Device table `notify.devices` | In `NotificationSchema.sql` (not applied) |
| Device API (`GET` / `PUT /notifications/devices`, `DELETE /notifications/devices/{installationId}`) | Written |
| Outbox (`notify.deliveries` with status, attempts, last error, next attempt, delivered time) | Written; push rows are created only once push is a delivering channel |
| Delivery rules (claim, retry gaps, give up, permanent failure, abandoned claim) | Written and tested (`DeliveryRules`) |
| Push length limits (title 65, message 240) | In `NotificationRules.Limits` |
| Mobile | A no-op seam only (`deviceRegistration` in `mobile/src/notifications/routes.ts`, already called at sign-out) |
| Delivery worker and channel contract (`IDeliveryChannel`, `DeliveryChannels.Register`) | Built; no channel registered |
| FCM adapter, push wording, mobile registration code | Not built |

## Device registration contract

`PUT /api/v1/notifications/devices`

```json
{ "installationId": "3f2b8c1e-9d4a-4f6b-8a2e-1c5d7e9f0a1b", "platform": "android", "pushToken": "<FCM registration token>", "appVersion": "1.0.0 (12)" }
```

| Field | Rule |
|---|---|
| account and school | Always the access token's. The body cannot name a user or school |
| `installationId` | 8 to 100 characters (`A-Z a-z 0-9 . _ : -`). A random id the app creates once per install and keeps in SecureStore |
| `platform` | `android` or `ios` |
| `pushToken` | 20 to 512 printable characters, no spaces. Write-only: never returned by any endpoint |
| `appVersion` | up to 40 characters, optional |

Behaviour: the same installation registering again updates its row and `last_seen_at` (call it at each app start and
when the token changes). A phone belongs to whoever is signed in on it now: registering revokes any earlier
registration of the same installation or token, for any account. At most 10 devices per account. Sign-out calls
`DELETE /devices/{installationId}` while the session is still valid. The delivery worker must also skip devices whose
account is inactive, and revoke a device when the provider says its token is no longer registered.

## What the owner must create or provide (later)

1. **Final Android application id.** `com.eduos.mobile` in `mobile/app.json` is a placeholder. It cannot change after
   the Firebase app and the store listing exist.
2. **A Firebase project** (Google account that the business owns), with an **Android app** registered under that id.
3. **`google-services.json`** from that Firebase app. It goes into the mobile build (EAS), not into `EXPO_PUBLIC_*`.
4. **A service account key** for the project with permission to send through the FCM HTTP v1 API. This is a server
   secret: provided to the delivery worker as an environment secret, never committed, never sent to the app.
5. **An Expo account and EAS project** for a development build. Remote push does not work in Expo Go on Android, so
   push cannot be tested in the current Expo Go setup at all.
6. **Decisions**: (a) send directly through FCM (recommended: the server already stores the device's FCM token, and
   no Expo access token is needed) or through Expo's push service; (b) whether push text for fees and results should
   be generic, since it appears on a locked screen; (c) when to ask for the Android 13+ notification permission.
7. **iOS, when wanted**: an Apple Developer account and an APNs key added to the Firebase project.

## Order to switch on (each step needs approval)

1. Deploy the current foundation (tables and APIs) and verify in-app notifications.
2. Mobile: add `expo-notifications`, create the installation id, register the device after sign-in, remove it at
   sign-out; make an EAS development build.
3. Server: add push wording to the templates, the delivery worker and the FCM adapter; provide the service account
   secret; add `push` to `NotificationRules.Available`.
4. Test on a real device: receive, tap to open (the app already maps a notification type to a screen and checks the
   account may open it), sign out and confirm nothing more arrives.
