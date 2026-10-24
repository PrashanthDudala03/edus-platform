# Advanced school operations

These additions extend existing admissions, attendance, fee, exam, homework, communication, and leave workflows.

## Where to find them

Sign in as a **school Administrator**. The **School operations** sidebar group contains:

| Page | Workflow |
|---|---|
| `/suite/analytics` | Attendance by month and class, current admissions pipeline, current fee balances, library/inventory/transport summaries, Excel export |
| `/suite/library-books` | Book catalogue, catalogue codes, authors, ISBN, total copies, retirement |
| `/suite/library-loans` | Issue books to students, due dates, returns and notes |
| `/suite/inventory-items` | Stock codes, categories, total quantity, storage location, retirement |
| `/suite/inventory-assignments` | Issue quantities to staff and record returns |
| `/suite/transport-routes` | Routes, vehicle registration, driver contact, capacity, status |
| `/suite/transport-stops` | Stops linked to routes, stop order, pickup and drop-off times |
| `/suite/transport-assignments` | Link a student to a route and matching stop |

Principals receive read access. Other roles have no default access. The platform SuperAdmin manages schools and permissions; school operations belong to school accounts.

New permissions are seeded in `PermissionCatalogue.json`. Migration `20261021_01_advanced_operations` grants them once to standard school roles and updates the feature catalogue. Existing leadership sessions must sign in again. Subsequent starts preserve removed permissions.

## Rules

- All records use the existing `suite.records` storage, school scope, version checks, audit trigger, and school-level transaction lock.
- Available book copies and stock quantities cannot be over-issued, including simultaneous requests. A student cannot have two outstanding copies of the same book.
- Stock cannot be reduced below outstanding issues or retired before those items are returned.
- Issue item, borrower, date, and quantity remain fixed; return and reissue to change them. Returns need a date on or after issue and cannot be reopened. Issue and return dates cannot be in the future.
- A stop must belong to the assignment's route. Each student has at most one active transport assignment. Active assignments cannot exceed route capacity.
- A route with passengers cannot be deactivated; an occupied stop cannot move to another route.
- Records are retained. Return items, deactivate assignments/routes, or retire stock instead of deleting history.

## Analytics periods

The month filter applies to attendance. Admissions counts represent the current application pipeline across all years; fee balances and operations counts represent current records. Collection totals use today and the current calendar month. Missing marks are not counted as present or absent. Individual panels and exports include only data the signed-in account may access.

## Validation

Run the backend rules and authorization suites with .NET 9:

```text
dotnet test services/school-service.tests/school-service.tests.csproj
dotnet test services/shared/EduOS.ServiceAuth.Tests/EduOS.ServiceAuth.Tests.csproj
```

`scripts/verify-advanced.mjs` exercises actual APIs using isolated QA schools. Set `EDUOS_PLATFORM_TEST_PASSWORD` and optionally `EDUOS_TEST_URL` (default `http://localhost:8081`) and `EDUOS_PLATFORM_TEST_USERNAME`. The script creates its own random school administrator password, checks concurrent stock lending, return rules, inventory limits, transport capacity, tenancy, and scoped-role restrictions. It deactivates its QA schools afterwards and retains their audit records.

## Scope

This first version provides stored workflows and analytics. It does not include live GPS, pickup notifications, library fines, barcode scanning, purchase orders, asset depreciation, external messaging providers, or automated forecasting. Existing school modules continue to provide admissions/onboarding, attendance alerts, fees, academics, communication, leave, and import/export tools.

Verified locally: 267 school-service tests, 171 shared authorization tests, and 52 live API checks passed. Frontend TypeScript checks and production build passed. Browser visual verification was unavailable in this environment.
