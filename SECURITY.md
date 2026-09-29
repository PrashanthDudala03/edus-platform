# Security policy

EduOS `1.0.0-rc.1` is a release candidate for isolated pilots. Do not use it for real student or family data until the release gates in the README are complete for your deployment.

## Reporting a vulnerability

Please do not publish exploitable details in a public issue. Use GitHub's private vulnerability reporting for this repository, or contact the repository owner through GitHub if private reporting is unavailable. Include the affected version, impact, and a safe reproduction. Do not include real student data, passwords, tokens, private keys, or production database exports.

## Deployment requirements

- Keep `.env`, RSA private keys, backups, and production logs out of source control.
- Store production values in a secrets manager and use unique administrator, database, and operations passwords.
- Put the web entry point behind HTTPS before exposing it to users.
- Keep database and service ports private; expose only the web entry point.
- Use synthetic data until backup/restore and tenant-isolation checks are complete.

## Supported versions

| Version | Support |
|---|---|
| `1.0.0-rc.1` | Pilot testing only; release-candidate fixes |
| Earlier prototypes | Not supported |
