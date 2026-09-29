# Contributing

EduOS changes are developed in branches and reviewed through pull requests. Never commit `.env`, credentials, private keys, database dumps, or real student/family data.

## Local checks

Frontend:

```sh
cd frontend
npm ci
npm run build
```

Backend:

```sh
dotnet test services/auth-service.tests/auth-service.tests.csproj --configuration Release
dotnet build services/auth-service/auth-service.csproj --configuration Release
dotnet build services/api-gateway/api-gateway.csproj --configuration Release
dotnet build services/school-service/school-service.csproj --configuration Release
dotnet build services/student-service/student-service.csproj --configuration Release
dotnet build services/teacher-service/teacher-service.csproj --configuration Release
dotnet build services/parent-service/parent-service.csproj --configuration Release
```

The pull request workflow runs these checks plus Compose syntax validation. It does not start app containers or connect to a database.

## Change requirements

- Keep changes scoped and explain the user-visible behavior.
- Preserve authentication, authorization, and tenant scoping; add negative tests for denied access.
- Include loading, error, empty, and validation states for new UI flows.
- Document environment or deployment changes in `README.md` and `.env.example`.
- Database changes need an upgrade path as well as a fresh-install check.
- Do not mark a feature complete until its automated checks pass.

Use branches named `feature/...`, `fix/...`, or `release/...` and open a pull request with a concise summary and validation results.
