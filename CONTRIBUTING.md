# Contributing to EduOS

Thank you for your interest in contributing to EduOS! This document provides guidelines and instructions for contributing.

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on the code, not the person
- Help others learn and grow

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/edus-platform.git`
3. Create a feature branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Commit with clear messages
6. Push and create a Pull Request

## Development Setup

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run tests
npm run test

# Format code
npm run format
```

## Pull Request Process

1. Update README.md with any new features
2. Ensure all tests pass
3. Add tests for new functionality
4. Follow the existing code style
5. Write clear commit messages
6. Link to related issues

## Coding Standards

### JavaScript/TypeScript
- Use ESLint configuration
- Follow Airbnb style guide
- Use TypeScript for type safety
- Write meaningful variable names

### C#/.NET
- Follow Microsoft C# conventions
- Use async/await for I/O operations
- Add XML documentation comments
- Use dependency injection

### Database
- Use migrations for schema changes
- Always include rollback scripts
- Test migrations in development first
- Document breaking changes

## Commit Message Guidelines

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types: feat, fix, docs, style, refactor, test, chore

Example:
```
feat(auth): add two-factor authentication

Implement TOTP-based 2FA for user accounts.
Allow users to enable/disable 2FA in settings.

Closes #123
```

## Reporting Bugs

When reporting bugs, include:
- Description of the bug
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots (if applicable)
- Environment details (OS, browser, versions)

## Suggesting Enhancements

- Describe the enhancement
- Explain the use case
- Provide examples
- Consider backward compatibility

## Questions?

- Open a discussion on GitHub
- Email: developers@edus.io
- Check existing issues/discussions first

---

Happy contributing! 🚀
