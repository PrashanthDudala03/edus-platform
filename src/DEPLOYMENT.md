# EduOS Microservices Deployment Guide

## Prerequisites

- .NET 9.0 SDK (for local development)
- Docker & Docker Compose (for containerized deployment)
- Git (for version control)
- curl (for testing health checks)

## Project Structure

```
src/
├── Shared.Models.cs              # Shared DTOs and models
├── ApiGateway.Program.cs          # YARP reverse proxy gateway
├── AuthService.Program.cs         # JWT authentication service
├── StudentService.Program.cs      # Student CRUD service
├── TeacherService.Program.cs      # Teacher CRUD service
├── ParentService.Program.cs       # Parent CRUD service
├── *.csproj                       # Project files
├── appsettings.*.json             # Configuration files
├── Dockerfile.*                   # Docker build files
├── docker-compose.yml             # Docker orchestration
├── API_ENDPOINTS.md              # API documentation
└── DEPLOYMENT.md                 # This file
```

## Local Development Setup

### 1. Build All Services

```bash
cd src
dotnet build
```

### 2. Run Services Individually

Open separate terminal windows for each service:

**Terminal 1 - API Gateway:**
```bash
dotnet run --project ApiGateway.csproj
# Listening on http://localhost:5000
```

**Terminal 2 - Auth Service:**
```bash
dotnet run --project AuthService.csproj
# Listening on http://localhost:5001
```

**Terminal 3 - Student Service:**
```bash
dotnet run --project StudentService.csproj
# Listening on http://localhost:5002
```

**Terminal 4 - Teacher Service:**
```bash
dotnet run --project TeacherService.csproj
# Listening on http://localhost:5003
```

**Terminal 5 - Parent Service:**
```bash
dotnet run --project ParentService.csproj
# Listening on http://localhost:5004
```

### 3. Test the Gateway

```bash
# Health check
curl http://localhost:5000/health

# Gateway status
curl http://localhost:5000/gateway/status

# Auth login (via gateway)
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@eduos.com","password":"admin123"}'

# Get students (via gateway)
curl http://localhost:5000/api/students
```

---

## Docker Deployment

### 1. Build Docker Images

All-in-one build and run:
```bash
cd src
docker-compose up --build
```

Build only (without running):
```bash
docker-compose build
```

### 2. Run Containers

Start all services:
```bash
docker-compose up -d
```

View logs:
```bash
docker-compose logs -f
```

View specific service logs:
```bash
docker-compose logs -f auth-service
docker-compose logs -f student-service
```

### 3. Test the Deployment

```bash
# Wait for all services to be healthy (30-40 seconds)

# Check gateway health
curl http://localhost:5000/health

# Check individual service health
curl http://localhost:5001/health  # Auth
curl http://localhost:5002/health  # Student
curl http://localhost:5003/health  # Teacher
curl http://localhost:5004/health  # Parent

# Test through gateway
curl http://localhost:5000/api/auth/health
curl http://localhost:5000/api/students
```

### 4. Stop Services

```bash
docker-compose down

# Remove volumes (if needed)
docker-compose down -v

# Remove all related images
docker-compose down --rmi all
```

---

## Environment Configuration

### Gateway (appsettings.Gateway.json)

```json
{
  "ReverseProxy": {
    "Routes": { ... },
    "Clusters": { ... }
  }
}
```

### Auth Service (appsettings.Auth.json)

Critical settings:
```json
{
  "Jwt": {
    "SecretKey": "minimum-32-characters-for-production!",
    "Issuer": "https://eduos-auth-service",
    "Audience": "eduos-clients",
    "AccessTokenExpirationMinutes": 15,
    "RefreshTokenExpirationDays": 7
  }
}
```

**IMPORTANT:** Change `SecretKey` in production to a secure 32+ character key.

### Services (appsettings.Services.json)

```json
{
  "ServiceSettings": {
    "EnableSwagger": true,
    "EnableHealthChecks": true
  }
}
```

---

## Production Deployment

### 1. Security Checklist

- [ ] Change JWT secret key to secure value (32+ characters, random)
- [ ] Set ASPNETCORE_ENVIRONMENT=Production for all services
- [ ] Enable HTTPS/TLS for all endpoints
- [ ] Configure CORS appropriately (not allow all)
- [ ] Implement rate limiting
- [ ] Add request logging and monitoring
- [ ] Replace in-memory storage with persistent database
- [ ] Implement proper authentication (currently in-memory users)
- [ ] Use secrets management (Azure Key Vault, AWS Secrets Manager)
- [ ] Set up monitoring and alerting

### 2. Scale Docker Services

Modify docker-compose.yml to scale services:

```bash
# Scale to multiple instances
docker-compose up -d --scale student-service=3 --scale teacher-service=2
```

### 3. Production Docker Configuration

Example nginx reverse proxy configuration (for HTTPS):

```nginx
upstream api_gateway {
    server api-gateway:5000;
}

server {
    listen 443 ssl http2;
    server_name api.eduos.com;

    ssl_certificate /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;

    location / {
        proxy_pass http://api_gateway;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 4. Database Integration

Currently using in-memory storage. To add persistence:

1. Install Entity Framework Core:
```bash
dotnet add package Microsoft.EntityFrameworkCore.SqlServer
```

2. Create DbContext:
```csharp
public class EduOsContext : DbContext
{
    public DbSet<Student> Students { get; set; }
    public DbSet<Teacher> Teachers { get; set; }
    public DbSet<Parent> Parents { get; set; }
    public DbSet<User> Users { get; set; }
}
```

3. Update services to use DbContext instead of in-memory collections.

---

## Monitoring & Health Checks

### Health Check Endpoints

All services expose `/health` endpoint:
```bash
curl http://localhost:5001/health
```

Returns:
```json
{
  "status": "Healthy",
  "timestamp": "2026-01-15T10:45:00Z",
  "details": {
    "service": "Auth Service",
    "version": "1.0.0",
    "database": "In-Memory"
  }
}
```

### Docker Health Checks

Each container has built-in health checks:
```bash
docker-compose ps  # Shows health status
```

### Log Aggregation

Example with ELK Stack:

1. Add logging providers:
```csharp
builder.Services.AddLogging(config =>
{
    config.AddConsole();
    config.AddDebug();
    // Add Serilog for structured logging
});
```

2. Use structured logging:
```csharp
_logger.LogInformation("User {UserId} logged in successfully", userId);
```

---

## Troubleshooting

### Service Won't Start

1. Check logs:
```bash
docker-compose logs service-name
```

2. Verify ports are not in use:
```bash
netstat -ano | findstr :5000  # Windows
lsof -i :5000                  # Linux/Mac
```

3. Rebuild images:
```bash
docker-compose build --no-cache
```

### Health Check Failing

1. Test service directly:
```bash
curl -v http://localhost:5001/health
```

2. Check network connectivity:
```bash
docker exec eduos-auth-service curl localhost:5001/health
```

### JWT Token Issues

1. Verify secret key matches across services
2. Check token expiration (15 minutes for access tokens)
3. Validate token format and claims

### Gateway Routing Not Working

1. Verify service DNS resolution:
```bash
docker exec eduos-gateway nslookup auth-service
```

2. Check YARP configuration in appsettings.Gateway.json
3. Verify cluster addresses match service container names

---

## Performance Optimization

### 1. Enable Caching

```csharp
builder.Services.AddResponseCaching();
app.UseResponseCaching();
```

### 2. Connection Pooling

For database connections (when added):
```csharp
options.UseNpgsql(connectionString, 
    options => options.MaxPoolSize(20));
```

### 3. Compression

```csharp
builder.Services.AddResponseCompression();
app.UseResponseCompression();
```

### 4. Async Operations

All services use async/await for non-blocking I/O.

---

## Upgrade Guide

### .NET Version

To upgrade to newer .NET version:

1. Update SDK: `dotnet --version`
2. Update project files: Change `<TargetFramework>net9.0</TargetFramework>`
3. Update package versions
4. Test thoroughly

### Package Updates

```bash
dotnet add package Microsoft.AspNetCore.Authentication.JwtBearer --version 9.0.1
dotnet outdated  # Shows available updates
```

---

## Support & Documentation

- API Endpoints: See `API_ENDPOINTS.md`
- .NET Documentation: https://learn.microsoft.com/dotnet/
- YARP Documentation: https://microsoft.github.io/reverse-proxy/
- Docker Documentation: https://docs.docker.com/

---

## Quick Reference

### Common Commands

```bash
# Build
dotnet build

# Run
dotnet run --project ProjectName.csproj

# Test
curl -X GET http://localhost:5000/api/students
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@eduos.com","password":"admin123"}'

# Docker
docker-compose up -d
docker-compose logs -f
docker-compose down
```

### Service Ports

| Service | Port | Path |
|---------|------|------|
| Gateway | 5000 | http://localhost:5000 |
| Auth | 5001 | /api/auth |
| Student | 5002 | /api/students |
| Teacher | 5003 | /api/teachers |
| Parent | 5004 | /api/parents |

---

Last Updated: 2026-01-15
Version: 1.0.0
