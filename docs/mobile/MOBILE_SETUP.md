# EduOS Mobile: setup

How to run and check the app in `mobile/`. Development is on Windows with a physical Android phone.

## Requirements

- Node 22 or newer (the repository's own Node 24 in `.tools/` works).
- The EduOS stack running as usual. The app talks to the existing gateway; nothing extra is started on the server.
- An **HTTPS address the phone can open** that forwards to the gateway. nginx listens on `127.0.0.1:8080` only, so the
  phone cannot use the PC's LAN address; use the HTTPS tunnel to `http://localhost:8080`.
- An Android phone with **Expo Go** that supports Expo SDK 57 (Play Store), on the same Wi-Fi as the PC.

## Configure

```
cd mobile
npm install
copy .env.example .env
```

Set the one value in `mobile/.env`:

```
EXPO_PUBLIC_API_URL=https://<your-tunnel-host>/api/v1
```

It is a public address, compiled into the app. Never put a key, password or token in an `EXPO_PUBLIC_` variable.
`localhost` is rejected (a phone cannot reach it); plain `http` is accepted only in development builds.

## Checks that start nothing

```
npm run typecheck     # TypeScript, strict
npm test              # 30 unit tests on Node's test runner
npm run config        # prints the resolved Expo configuration
npx expo-doctor       # dependency and configuration health
```

## Run on the phone

This starts Metro (the JavaScript bundler) on port 8081. It does not touch Docker or the EduOS services.

```
cd mobile
npx expo start
```

Scan the QR code with Expo Go. If Windows asks, allow Node on private networks. If the phone cannot reach the PC,
use `npx expo start --tunnel`.

Sign in with a school account (the development demo accounts are in `docs/DEMO.md`).

## Later: installable builds

Expo Go is enough for Phase 1. Push notifications and store builds need a development build made with EAS
(`eas build --profile development --platform android`), an Expo account, and for iOS an Apple developer account.
The application id `com.eduos.mobile` in `app.json` is a placeholder to confirm before the first store build.
