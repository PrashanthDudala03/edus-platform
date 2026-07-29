# 🎓 EduOS - Modern School Management Platform

EduOS is a comprehensive, scalable school management system built with modern technologies. It provides complete management of schools, students, teachers, parents, and academic operations.

## ✨ Features

### Phase 1 (Complete)
- ✅ **Settings Module** - School info, user management, role configuration
- ✅ **Multi-Tenant Architecture** - Support for multiple schools
- ✅ **Authentication** - JWT RS256 with secure token management
- ✅ **Role-Based Access Control** - Customizable roles and permissions
- ✅ **Database** - PostgreSQL with 5 dedicated schemas
- ✅ **Monitoring** - Prometheus, Grafana, pgAdmin stack
- ✅ **API Gateway** - YARP-based routing and orchestration
- ✅ **Microservices** - Independent services for auth, students, teachers, etc.

### Phase 2 (In Progress)
- 🚀 Student Management Module
- 🚀 Teacher Management Module
- 🚀 Parent Portal & Communication
- 🚀 Academic Management (Classes, Subjects, Timetables)
- 🚀 Attendance Management
- 🚀 Reporting & Analytics

## 🏗️ Architecture

### Tech Stack
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Backend**: ASP.NET Core 9, Entity Framework Core
- **Database**: PostgreSQL 16
- **Message Queue**: RabbitMQ
- **Cache**: Redis
- **API Gateway**: YARP (Yet Another Reverse Proxy)
- **Monitoring**: Prometheus, Grafana, pgAdmin
- **Containerization**: Docker & Docker Compose
- **Authentication**: JWT RS256

### Microservices
- **Auth Service** (Port 6001) - User authentication & management
- **School Service** (Port 6005) - School configuration
- **Student Service** (Port 6002) - Student management
- **Teacher Service** (Port 6003) - Teacher management
- **Parent Service** (Port 6004) - Parent management
- **API Gateway** (Port 5000) - Request routing

### Database Schemas
- `auth_db` - Users, roles, permissions
- `school_db` - Schools, academic config, audit logs
- `student_db` - Students, enrollments
- `teacher_db` - Teachers, assignments
- `parent_db` - Parents, contact info

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local frontend development)
- .NET 9 SDK (for local backend development)
- PostgreSQL 16 (optional, if not using Docker)

### Setup

1. **Clone the repository**
```bash
git clone https://github.com/cadfem/edus-platform.git
cd edus-platform
```

2. **Configure environment**
```bash
cp .env.example .env
# Edit .env and update JWT keys if needed
```

3. **Generate JWT Keys (First Time Only)**
```bash
# Generate RSA keys for JWT
# Save as base64 in .env file
```

4. **Start services**
```bash
docker-compose up -d
```

5. **Access the application**
- Frontend: http://localhost:8000
- API Gateway: http://localhost:8080
- pgAdmin: http://localhost:5050
- Grafana: http://localhost:3001
- Prometheus: http://localhost:9090

## 📊 Default Credentials

### Grafana
```
Username: admin
Password: admin123
```

### pgAdmin
```
Email: admin@edus.com
Password: admin123
```

### PostgreSQL (via pgAdmin)
```
Host: postgres
Port: 5432
Username: edus_dev
Password: dev_password_123
Database: edus_dev
```

### Application
```
Username: admin
Password: admin123
```

## 📁 Project Structure

```
edus-platform/
├── frontend/                 # React frontend
│   ├── src/
│   │   ├── pages/           # Page components
│   │   ├── components/      # Reusable components
│   │   ├── store/           # Zustand state management
│   │   └── api/             # API client
│   ├── Dockerfile
│   └── package.json
├── services/                 # Microservices
│   ├── auth-service/        # Authentication service
│   ├── school-service/      # School management
│   ├── student-service/     # Student management
│   ├── teacher-service/     # Teacher management
│   ├── parent-service/      # Parent management
│   └── api-gateway/         # YARP Gateway
├── init-db.sql              # Database schema
├── docker-compose.yml       # Docker Compose config
├── prometheus.yml           # Prometheus config
└── README.md
```

## 🛠️ Development

### Local Frontend Development
```bash
cd frontend
npm install
npm run dev
# Frontend will run on http://localhost:5173
```

### Local Backend Development
```bash
cd services/auth-service
dotnet restore
dotnet run
# Service will run on http://localhost:6001
```

### Run Tests
```bash
docker-compose -f docker-compose.test.yml up
```

## 📚 API Documentation

### Authentication
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123",
  "schoolId": "school-uuid"
}

Response:
{
  "statusCode": 200,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "user": { ... }
  }
}
```

### Users Endpoints
```http
GET /api/users?page=1&pageSize=20&schoolId={schoolId}
POST /api/users
PUT /api/users/{id}
DELETE /api/users/{id}?schoolId={schoolId}
```

## 🔒 Security

- ✅ JWT RS256 authentication
- ✅ Password hashing with BCrypt (cost factor 12)
- ✅ CORS enabled for cross-origin requests
- ✅ Multi-tenant isolation via school_id
- ✅ Soft delete for data retention
- ✅ Role-based access control
- ✅ Environment variable protection

**Security Notes:**
- Store JWT keys in secure vault (not in .env for production)
- Use HTTPS in production
- Implement rate limiting
- Enable database backups
- Audit all admin actions

## 📊 Monitoring

### Prometheus Targets
All 10 services monitored:
- 6 Microservices (auth, school, student, teacher, parent, gateway)
- 3 Infrastructure (PostgreSQL, Redis, RabbitMQ via exporters)
- 1 Prometheus (self-monitoring)

### Grafana Dashboards
- **EduOS Microservices Health** - Real-time service status
- Custom dashboards can be created for metrics

### pgAdmin
- Full database management
- Query execution
- Schema exploration

## 🔄 Deployment

### Docker Compose (Development)
```bash
docker-compose up -d
```

### Production Checklist
- [ ] Update .env with production values
- [ ] Use strong, unique passwords
- [ ] Enable HTTPS
- [ ] Set up SSL certificates
- [ ] Configure backup strategy
- [ ] Set up log aggregation
- [ ] Enable monitoring alerts
- [ ] Use environment-specific configs
- [ ] Implement rate limiting
- [ ] Set up CI/CD pipeline

## 🐛 Troubleshooting

### Services won't start
```bash
# Check Docker logs
docker-compose logs auth-service

# Restart services
docker-compose restart

# Full reset
docker-compose down -v
docker-compose up -d
```

### Database connection issues
```bash
# Check PostgreSQL health
docker ps | grep postgres

# Connect to database
docker exec -it edus-postgres psql -U edus_dev -d edus_dev
```

### Prometheus targets showing DOWN
- Check service health endpoints are returning metrics
- Verify network connectivity between containers
- Restart Prometheus: `docker-compose restart prometheus`

## 📝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see LICENSE file for details.

## 👥 Team

- **Project Lead**: CADFEM
- **Architecture**: Multi-tenant SaaS platform
- **Maintenance**: Active development

## 📞 Support

For issues and questions:
- GitHub Issues: https://github.com/cadfem/edus-platform/issues
- Email: support@edus.io

## 🗺️ Roadmap

### Q3 2026
- Student Management Module
- Teacher Management Module
- Parent Portal

### Q4 2026
- Academic Management
- Reporting & Analytics
- Mobile App (React Native)

### Q1 2027
- AI-powered recommendations
- Advanced analytics
- Integration marketplace

---

**Made with ❤️ by the EduOS Team**
