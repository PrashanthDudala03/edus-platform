# Security Policy

## Reporting Security Vulnerabilities

Please do NOT create a public issue for security vulnerabilities.

Instead, email security@edus.io with:
- Description of the vulnerability
- Affected components/versions
- Steps to reproduce (if applicable)
- Potential impact

We will:
- Acknowledge receipt within 48 hours
- Keep you updated on progress
- Credit you in the security advisory (if desired)
- Work toward a coordinated disclosure

## Security Best Practices

### For Users
- Change default credentials immediately
- Use strong, unique passwords
- Keep the system updated
- Enable 2FA when available
- Report security issues promptly

### For Developers
- Never commit secrets or credentials
- Use environment variables for sensitive data
- Validate all user input
- Use HTTPS in production
- Keep dependencies updated
- Run security audits regularly

## Supported Versions

| Version | Supported          |
|---------|-------------------|
| 1.0.x   | ✅ Security fixes |
| < 1.0   | ❌ Not supported  |

## Security Tools

We use:
- OWASP Top 10 compliance checks
- Dependency scanning
- Code security analysis
- Regular penetration testing

## Acknowledgments

We appreciate security researchers and community members who responsibly disclose vulnerabilities.
