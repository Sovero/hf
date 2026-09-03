@echo off
setlocal
chcp 65001 >nul
title HueForge Web

pushd "%~dp0"

REM ---- Check Node.js ----
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is not installed. Run install.bat first or get it from https://nodejs.org
    pause
    popd
    exit /b 1
)

REM ---- Self-heal: install dependencies if missing ----
if not exist "node_modules" (
    echo First run - installing dependencies...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo npm install failed. Check your internet connection.
        pause
        popd
        exit /b 1
    )
)

echo Starting HueForge Web at http://127.0.0.1:5173 ...
echo (Close this window to stop the server.)
echo.

start "" "http://127.0.0.1:5173"
call npm run dev

popd
