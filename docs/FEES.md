# EduOS Fees & Collections

The school's own fee ledger: what each student owes, what the school received, receipts, concessions, corrections,
reports, and an online-payment path that only the school's own provider can complete. Code:
`services/school-service/Suite.Fees.cs` (rules, provider boundary, endpoints), `FeesSchema.sql` (additive schema),
web `frontend/src/pages/suite/FeesPage.tsx`, mobile `mobile/src/features/fees/FeesScreen.tsx`.

## School fee collections != EduOS platform billing

| | School fee collections | EduOS platform billing |
|---|---|---|
| Money flow | family -> school | school -> EduOS |
| Where | `suite.charges`, `suite.payments`, `suite.concessions`, `suite.payment_intents`, `suite.school_payment_config` in school-service | `billing.*` schema in auth-service |
| Provider account | the **school's** merchant or linked account, configured per school in `school_payment_config` | EduOS's Razorpay keys (`RAZORPAY_*`) in auth-service only |
| Who reads | the school office (`fees.*`) and linked families | the platform SuperAdmin and the school's subscription screen |

Nothing in the fee ledger reads the platform's Razorpay keys, routes money through an EduOS account, or writes to
the billing schema. school-service is not on the `payments-egress` network; the fee provider boundary creates no
outbound calls today.

## Domain

- **Fee heads** (`fee-heads` records): Tuition, Transport, Examination and any the school adds; shares the fee-structure permissions.
- **Fee structures** (`fee-structures` records): name, head, academic year, class, optional individual student, amount, frequency, instalment label, due date. `POST /fees/plans` lays out monthly, quarterly, term-wise, annual or custom instalments as structures in one go.
- **Charges** (`suite.charges`): one per student and structure, gross, concession at issue, fine, status Active | Waived | Cancelled, note, who changed it.
- **Concessions** (`suite.concessions`): percentage (basis points) or fixed amount, for one charge or every charge of the student, reason, effective period, who gave it, revocation with reason. They change what is owed from now on; payments already received are never altered.
- **Payments** (`suite.payments`): amount, method (Cash, UPI, Bank transfer, Cheque, Other, Online), reference, date, note, who received it, receipt number per school (`RCPT-<year>-<n>`), status Completed | Reversed with who, when and why, source manual | online with provider references.
- **Ledger** (server only, minor units): net = max(0, gross - issue concession - later concessions - waiver) + fine; outstanding = net - completed payments; state Unpaid | Partial | Paid | Overdue | Waived | Cancelled. Clients never add figures up.

## API (under `/api/v1/suite`, tenant from the token)

| Call | Permission | Who |
|---|---|---|
| `GET /fees`, `GET /fees/payments`, `GET /fees/receipts/{id}` | fees.view | office and linked families (own students only) |
| `GET /fees/ledger/{studentId}?page` | fees.view | office and linked families; the family's screens and Student 360 read this |
| `POST /fees/charges`, `POST /fees/plans` | fees.manage, Administrator | issue a charge; lay out instalments |
| `POST /fees/payments` | fees.collect, Administrator | record a received payment; idempotent per `idempotencyKey` |
| `POST /fees/payments/{id}/reverse` | fees.manage | reverse with a reason; the row and receipt stay |
| `POST /fees/charges/{id}/status` | fees.manage | waive, cancel or reactivate with a reason; a charge with payments cannot be cancelled |
| `GET`/`POST /fees/concessions`, `POST /fees/concessions/{id}/revoke` | fees.manage (read: fees.view) | concessions |
| `GET /fees/history?studentId&classId&from&to&method&status&search&page` | fees.view, office | payment history, paged |
| `GET /fees/reports/daily?day`, `/fees/reports/outstanding?classId&overdueOnly&page`, `/fees/reports/classes`, `GET /fees/summary` | fees.view, office | reports and the leadership summary |
| `GET`/`PUT /fees/payment-config` | fees.view / fees.manage | the school's provider, merchant reference, online switch; never a credential |
| `POST /fees/online/intents`, `GET /fees/online/intents/{id}` | fees.view (own students) | an online attempt with the school's provider, Pending until verified |
| `POST /api/v1/fees/webhooks/{provider}` | none (signed by the provider) | the provider's confirmation |

Teachers hold no `fees.*` permission and are refused everywhere, including the Student 360 fee section. The platform
SuperAdmin has no school scope and is refused by every suite endpoint.

## Online payments: provider boundary and state machine

`ISchoolPaymentProvider` (name, signature header, connection status, create order, order reference of a webhook
body, parse and verify an event, public key id, verify a browser checkout result) keeps the ledger independent of
any provider. `FakeSchoolPaymentProvider` is for automated tests: connected only when the deployment sets
`SCHOOL_FEES_FAKE_SECRET`, and events are accepted only when `X-Signature` is the HMAC-SHA256 of the body with that
secret. `RazorpaySchoolPaymentProvider` is the real one, test mode only (below).

```
POST /fees/online/intents            -> payment_intents Pending; the server fixes school, student, charge, amount and currency
                                        and creates the provider order; the browser gets {keyId, orderId, amount, currency} only
browser checkout result
  -> POST /fees/online/intents/{id}/confirm   signature verified with the server-side key secret, order matched to the attempt
provider webhook
  -> POST /api/v1/fees/webhooks/{provider}    raw body verified with the webhook secret; event type checked
both settle through one path:
  payment_events (provider, event_id) recorded once        -> a repeated callback or webhook answers "already-processed"
  intent Pending -> Verified exactly once (row lock)       -> ONE payments row (source online, receipt), family told
  intent already decided                                   -> "already-decided" with the existing receipt, nothing changes
  amount or currency mismatch -> Failed, nothing credited  |  payment.failed / dismissed checkout -> nothing credited
```

The browser's return is never proof of payment: only the verified callback or the verified webhook creates the
payment and the receipt, whichever arrives first, and the other then finds the attempt decided.

## Razorpay: test mode only

`RazorpaySchoolPaymentProvider` creates orders at `POST {api}/v1/orders` with the school-fee test key, verifies the
browser result as HMAC-SHA256(`order_id|payment_id`, key secret) and webhooks as HMAC-SHA256(raw body, webhook
secret), both compared in constant time. `payment.captured` and `order.paid` confirm an attempt, `payment.failed`
fails it, every other event is acknowledged and ignored. Live mode is refused: the provider is connected only when
`SCHOOL_FEES_RAZORPAY_MODE=Test` and the key id starts with `rzp_test_`; a live key or a live mode setting leaves it
disconnected and orders answer 503.

Configuration lives in the deployment's environment (compose passes it to school-service only), never in the
database, source, frontend or logs:

| Variable | Value |
|---|---|
| `SCHOOL_FEES_RAZORPAY_MODE` | `Test` (anything else disconnects the provider) |
| `SCHOOL_FEES_RAZORPAY_KEY_ID` | the Razorpay **test** Key ID (`rzp_test_…`); the only value a browser ever sees |
| `SCHOOL_FEES_RAZORPAY_KEY_SECRET` | the Razorpay test Key Secret; server-side only |
| `SCHOOL_FEES_RAZORPAY_WEBHOOK_SECRET` | the secret you set when creating the webhook in the Razorpay dashboard |

These are separate from the platform billing `RAZORPAY_*` keys, which school-service never receives. The one tenant
wired to Razorpay for sandbox testing is "EduOS Demo School" (the development seed): `scripts/seed-demo.mjs` sets its
provider to Razorpay with online payments on when the deployment holds a test key id, and touches no other school.
Any other school keeps its own configuration (none by default) and shows no online option.

Webhook address for the Razorpay dashboard: `https://<public host>/api/v1/fees/webhooks/razorpay`, events
`payment.captured`, `payment.failed` and `order.paid`. The gateway forwards it anonymously to school-service; the
signature is the only credential.

Still deferred, deliberately: live mode, real settlement, and school onboarding. Whether a school's money moves
through a Razorpay Route linked account, the school's own merchant account under a partner model, or something else
is a commercial and compliance decision to be confirmed with Razorpay; until then no school's collections can reach a
live account from this integration.

**Production secret decision needed:** per-school provider credentials must live in a secret store (deployment
secrets or a KMS-backed vault keyed by school), never in `suite.school_payment_config` or source. The configuration
model stores only the reference the provider gives the school.

## Audit

Every fee table carries the `suite_audit` trigger (insert, update, delete) with the acting user; charges, payments,
concessions, intents and the payment configuration all record who created or changed them. Reversals, waivers,
cancellations and revocations require a reason that is stored on the row. No financial row is ever deleted.

## Notifications

`fee.due` on charge (existing), `fee.payment_received` on a recorded or verified payment with the receipt number.
`fee.due_soon` and `fee.overdue` wait for a scheduler (documented in `docs/notifications/NOTIFICATION_EVENTS.md`).

## Known gaps

- Fines: the column exists; no late-fee policy applies it yet.
- Receipts download as print-to-PDF from the web; the app shows receipt numbers and status.
- Section-level structures use the class (which already carries its section); per-section pricing within a class is by individual-student structures.
- The payment history and ledger page by 20–25; reports page by 50.

## Razorpay Test Mode Validation

Observed on the local development stack, 2026-10-04. Test mode only; no real money moved.

- Razorpay test credentials were loaded server-side only (the ignored `.env`, passed to school-service alone). No secret appears in browser responses, the frontend bundle, or school-service and gateway logs.
- EduOS Demo School is the single Razorpay-enabled test tenant. Another school (the bootstrap tenant) read provider none, not connected, online off.
- A Razorpay TEST order was created by the backend for the amount the ledger fixed; the browser received only the public test key id, order, amount, currency and description.
- The Razorpay checkout opened in test mode.
- An initial international-card attempt was rejected by Razorpay. EduOS correctly credited nothing: the attempts stayed Pending, no online payment or receipt was created, and the outstanding balance did not change. Each retry created a fresh order, and every attempt remained recorded and audited.
- A supported domestic test payment then completed. The server verified the checkout signature with the key secret, the attempt became Verified, and exactly one online payment of the full outstanding amount was allocated to the charge. The outstanding balance went to zero, the charge became Paid, and exactly one receipt was issued. The payment record holds the Razorpay order and payment references.
- Student 360 showed the same authoritative figures as the ledger (outstanding 0, paid equal to the net payable).
- Razorpay Live Mode was never enabled (the provider refuses live keys and live mode). EduOS platform billing was not touched and uses separate keys.
- The webhook is intentionally not configured yet; `SCHOOL_FEES_RAZORPAY_WEBHOOK_SECRET` is unset.

### Automated validation

school-service 202 passed (includes Razorpay order mapping, checkout and webhook signature verification, test-mode-only guard, and the settlement rules), shared auth 125 passed, web unit 55 passed, fees Playwright 6 passed (mocked checkout success and dismissal), web typecheck and build passed. The live security specs run in CI.

### Deferred validation

Razorpay webhook end-to-end validation pending. The next validation will prove: Razorpay webhook, signature verification, recognition of the existing payment, no duplicate ledger allocation and no duplicate receipt. It needs a public HTTPS URL for the dashboard webhook and the webhook secret, neither of which is configured.
