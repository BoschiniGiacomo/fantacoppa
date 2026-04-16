@echo off
echo ========================================
echo   Avvio Backend FantaCoppa
echo ========================================
echo.

REM Imposta variabili d'ambiente per database Supabase (PostgreSQL)
set SUPABASE_DB_URL=postgresql://postgres:YOUR_DB_PASSWORD@db.zaqvtlsmefrgbduhzmwk.supabase.co:5432/postgres
set JWT_SECRET=fantacoppa-secret-key-2024-change-in-production
set PORT=3000

echo Configurazione:
echo - Database URL: %SUPABASE_DB_URL%
echo - Porta: %PORT%
echo.

echo Avvio server...
echo.

node server.js

pause

