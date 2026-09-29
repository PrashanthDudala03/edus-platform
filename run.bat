@echo off
setlocal
if not exist .env (
  echo Missing .env. Copy .env.example to .env and replace the CHANGE_ME values first.
  exit /b 1
)
docker compose version >nul 2>&1
if errorlevel 1 (
  echo Docker Engine and the Compose v2 plugin are required.
  exit /b 1
)
docker compose config --quiet
if errorlevel 1 exit /b 1
docker compose up -d --build --wait --wait-timeout 180
if errorlevel 1 exit /b 1
echo EduOS is ready. Open http://localhost:8080. Your login is in .local\ACCESS.txt.
echo Use the initial admin credentials and school ID stored in .env.
endlocal
