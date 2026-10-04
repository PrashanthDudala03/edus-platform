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

`ISchoolPaymentProvider` (name, connection status, create order, parse and verify an event) keeps the ledger
independent of any provider. `FakeSchoolPaymentProvider` is the test implementation: connected only when the
deployment sets `SCHOOL_FEES_FAKE_SECRET`, and events are accepted only when `X-Signature` is the HMAC-SHA256 of the
body with that secret. `RazorpaySchoolPaymentProvider` exists and refuses orders until the school onboarding model
is decided (see below).

```
POST /fees/online/intents  -> payment_intents Pending (provider order reference)
provider -> POST /fees/webhooks/{provider}   signature verified with the school's configuration
  payment_events (provider, event_id) recorded once   -> a repeated event answers "already-processed"
  intent Pending -> Verified: payments row (source online, receipt) + family told; or -> Failed
  amount or currency mismatch -> Failed, nothing credited
```

The browser's return is never proof of payment; only the verified event creates the payment and the receipt.

## Razorpay: ready and deferred

Ready: per-school configuration (provider, merchant or linked-account reference, connection and settlement status,
online switch), the provider boundary, the attempt and event tables, idempotent event handling, receipts for online
payments, family and office screens that only show the online option when the school is connected and switched on.

Deferred, deliberately: creating real Razorpay orders, verifying real Razorpay signatures and any onboarding flow.
Whether a school's money moves through a Razorpay Route linked account, the school's own merchant account under a
partner model, or something else is a commercial and compliance decision to be confirmed with Razorpay. Until then
no school's collections can be pointed at an EduOS account by accident: the Razorpay provider refuses orders, and
the platform's billing keys are never read by the fee ledger.

**Production secret decision needed:** provider credentials per school must live in a secret store (deployment
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
