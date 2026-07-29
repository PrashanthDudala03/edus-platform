#!/bin/bash

# EduOS Phase 1 - Quick Start Script

set -e

echo "🚀 EduOS Phase 1 - Starting Docker Compose"
echo ""

# Check if Docker is running
if ! docker ps > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop."
    exit 1
fi

echo "✅ Docker is running"
echo ""

# Build and start services
echo "📦 Building and starting services..."
docker-compose up --build

echo ""
echo "🎉 Services are running!"
echo ""
echo "Access points:"
echo "  Frontend:        http://localhost:3000"
echo "  API Gateway:     http://localhost/api"
echo "  Health Check:    http://localhost/health"
echo "  RabbitMQ:        http://localhost:15672 (guest/guest)"
echo "  Database:        localhost:5432"
echo ""
echo "Demo Login:"
echo "  Username: admin"
echo "  Password: admin123"
echo ""
echo "Press Ctrl+C to stop services"
