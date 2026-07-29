# EduOS Microservices API Documentation

## Overview
Production-ready ASP.NET Core 9.0 microservices architecture with YARP reverse proxy gateway.

## Architecture

```
┌─────────────────┐
│   API Gateway   │ (Port 5000)
│   YARP Proxy    │
└────────┬────────┘
         │
    ┌────┴─────┬──────────┬──────────┐
    │           │          │          │
┌───▼───┐  ┌───▼───┐ ┌───▼───┐ ┌───▼───┐
│ Auth  │  │Student│ │Teacher│ │Parent │
│:5001  │  │:5002  │ │:5003  │ │:5004  │
└───────┘  └───────┘ └───────┘ └───────┘
```

## Gateway Routes

All requests go through the API Gateway on port 5000:
- `/api/auth/*` → Auth Service (5001)
- `/api/students/*` → Student Service (5002)
- `/api/teachers/*` → Teacher Service (5003)
- `/api/parents/*` → Parent Service (5004)

---

## Auth Service (Port 5001)

### Endpoints

#### POST /login
Authenticate user and get JWT tokens.

**Request:**
```json
{
  "email": "admin@eduos.com",
  "password": "admin123"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "userId": "uuid-string",
    "email": "admin@eduos.com",
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "base64-refresh-token",
    "expiresIn": "2026-01-15T10:30:00Z"
  },
  "message": "Login successful",
  "timestamp": "2026-01-15T10:15:00Z"
}
```

**Test Users:**
- admin@eduos.com / admin123 (Admin)
- teacher@eduos.com / teacher123 (Teacher)
- parent@eduos.com / parent123 (Parent)

---

#### POST /refresh
Refresh expired access token using refresh token.

**Request:**
```json
{
  "refreshToken": "base64-refresh-token"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "userId": "uuid-string",
    "email": "admin@eduos.com",
    "accessToken": "new-jwt-token",
    "refreshToken": "new-refresh-token",
    "expiresIn": "2026-01-15T10:45:00Z"
  },
  "message": "Token refreshed successfully",
  "timestamp": "2026-01-15T10:30:00Z"
}
```

---

#### POST /logout
Invalidate all tokens for user.

**Request:**
```json
{
  "userId": "uuid-string"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Logged out successfully",
  "timestamp": "2026-01-15T10:45:00Z"
}
```

---

#### GET /validate
Validate current JWT token (requires authentication).

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

**Response (200 OK):**
```json
{
  "valid": true,
  "message": "Token is valid"
}
```

---

#### GET /health
Service health status.

**Response (200 OK):**
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

---

## Student Service (Port 5002)

### Endpoints

#### GET /students
Get all students.

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-string",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@school.com",
      "rollNumber": "STU001",
      "grade": "10A",
      "enrollmentDate": "2025-07-27T00:00:00Z"
    }
  ],
  "message": "Students retrieved successfully",
  "timestamp": "2026-01-15T10:45:00Z"
}
```

---

#### GET /students/{id}
Get student by ID.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "uuid-string",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@school.com",
    "rollNumber": "STU001",
    "grade": "10A",
    "enrollmentDate": "2025-07-27T00:00:00Z"
  },
  "message": "Student retrieved successfully",
  "timestamp": "2026-01-15T10:45:00Z"
}
```

---

#### POST /students
Create new student.

**Request:**
```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "email": "jane.smith@school.com",
  "rollNumber": "STU003",
  "grade": "10B"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "new-uuid-string",
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane.smith@school.com",
    "rollNumber": "STU003",
    "grade": "10B",
    "enrollmentDate": "2026-01-15T10:45:00Z"
  },
  "message": "Student created successfully",
  "timestamp": "2026-01-15T10:45:00Z"
}
```

---

#### PUT /students/{id}
Update student.

**Request:**
```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "email": "jane.smith@school.com",
  "grade": "10A"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "uuid-string",
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane.smith@school.com",
    "rollNumber": "STU003",
    "grade": "10A",
    "enrollmentDate": "2025-07-27T00:00:00Z"
  },
  "message": "Student updated successfully",
  "timestamp": "2026-01-15T10:45:00Z"
}
```

---

#### DELETE /students/{id}
Delete student.

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Student deleted successfully",
  "timestamp": "2026-01-15T10:45:00Z"
}
```

---

#### GET /health
Service health status.

---

## Teacher Service (Port 5003)

### Endpoints

Similar structure to Student Service with:
- GET /teachers
- GET /teachers/{id}
- POST /teachers
- PUT /teachers/{id}
- DELETE /teachers/{id}
- GET /health

**Request Example (POST /teachers):**
```json
{
  "firstName": "Robert",
  "lastName": "Johnson",
  "email": "robert.johnson@school.com",
  "department": "Mathematics",
  "specialization": "Advanced Calculus"
}
```

---

## Parent Service (Port 5004)

### Endpoints

- GET /parents
- GET /parents/{id}
- GET /parents/student/{studentId}
- POST /parents
- PUT /parents/{id}
- DELETE /parents/{id}
- GET /health

**Request Example (POST /parents):**
```json
{
  "firstName": "Michael",
  "lastName": "Doe",
  "email": "michael.doe@email.com",
  "phoneNumber": "+1-555-0101",
  "relationship": "Father",
  "studentId": "student-uuid-string"
}
```

---

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": {
    "email": ["Email format is invalid"],
    "firstName": ["First name is required"]
  },
  "timestamp": "2026-01-15T10:45:00Z"
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Invalid credentials",
  "timestamp": "2026-01-15T10:45:00Z"
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "Student not found",
  "timestamp": "2026-01-15T10:45:00Z"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "An internal error occurred",
  "timestamp": "2026-01-15T10:45:00Z"
}
```

---

## JWT Token Structure

Access tokens contain claims:
- `sub`: User ID
- `email`: User email
- `role`: User role (Admin, Teacher, Parent, User)
- `iat`: Issued at timestamp
- `exp`: Expiration timestamp (15 minutes by default)

Refresh tokens:
- Last for 7 days
- Stored server-side in memory
- Used to obtain new access tokens

---

## Getting Started

### Local Development

1. Build all services:
```bash
dotnet build
```

2. Run individual services:
```bash
dotnet run --project ApiGateway.csproj
dotnet run --project AuthService.csproj
# etc.
```

### Docker Deployment

1. Build and run all services:
```bash
docker-compose up -d
```

2. Access via gateway:
```
http://localhost:5000/api/auth/health
http://localhost:5000/api/students
```

3. Stop services:
```bash
docker-compose down
```

---

## Key Features

- YARP-based API Gateway with request routing and transformation
- JWT authentication with access and refresh tokens
- In-memory data storage for rapid development/testing
- Standard ApiResponse<T> format for all endpoints
- Built-in health checks for each service
- Comprehensive validation for all inputs
- Docker multi-stage builds for optimized images
- Structured logging with correlation IDs ready
- ASP.NET Core 9.0 minimal APIs (no controllers)
- Production-ready error handling
