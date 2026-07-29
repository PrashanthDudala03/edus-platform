@echo off
REM EduOS Phase 1 - Quick Start Script for Windows

echo 🚀 EduOS Phase 1 - Starting Docker Compose
echo.

REM Check if Docker is running
docker ps > nul 2>&1
if errorlevel 1 (
    echo ❌ Docker is not running. Please start Docker Desktop.
    pause
    exit /b 1
)

echo ✅ Docker is running
echo.

REM Build and start services
echo 📦 Building and starting services...
docker-compose up --build

echo.
echo 🎉 Services are running!
echo.
echo Access points:
echo   Frontend:        http://localhost:3000
echo   API Gateway:     http://localhost/api
echo   Health Check:    http://localhost/health
echo   RabbitMQ:        http://localhost:15672 (guest/guest)
echo   Database:        localhost:5432
echo.
echo Demo Login:
echo   Username: admin
echo   Password: admin123
echo.
echo Press Ctrl+C to stop services
echo.
pause
