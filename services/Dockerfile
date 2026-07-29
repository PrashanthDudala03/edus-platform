FROM mcr.microsoft.com/dotnet/sdk:9.0 as builder

WORKDIR /src

# Copy project files
COPY services/api-gateway/api-gateway.csproj ./api-gateway/
COPY services/auth-service/auth-service.csproj ./auth-service/

# Restore
RUN dotnet restore ./api-gateway/api-gateway.csproj
RUN dotnet restore ./auth-service/auth-service.csproj

# Copy source
COPY services/api-gateway/ ./api-gateway/
COPY services/auth-service/ ./auth-service/

# Build and publish based on BUILD_TARGET
ARG BUILD_TARGET=api-gateway
RUN dotnet publish ./${BUILD_TARGET}/${BUILD_TARGET}.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:9.0

WORKDIR /app

# Copy built application
COPY --from=builder /app .

# Health check
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
    CMD curl -f http://localhost:5000/api/health || exit 1

ENTRYPOINT ["dotnet", "api-gateway.dll"]
