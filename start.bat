@echo off
REM Console messages stay ASCII on purpose: cmd.exe mis-parses a .bat that
REM carries non-ASCII text, so Russian wording is printed by PowerShell
REM (update.ps1 say <key> - see the :say subroutine).
setlocal
chcp 65001 >nul
title HueForge Web

pushd "%~dp0"

REM ---- Check Node.js ----
where node >nul 2>&1
if errorlevel 1 (
    call :say start.node-missing
    pause
    popd
    exit /b 1
)

REM ---- Self-heal: install dependencies if missing ----
if not exist "node_modules" (
    call :say start.first-run
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        call :say start.deps-failed
        pause
        popd
        exit /b 1
    )
)

call :say start.starting
call :say close-hint
echo.

start "" "http://127.0.0.1:5173"
call npm run dev

popd
exit /b 0

:say
REM Print a Russian console message: update.ps1 say <key> [args...]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" say %*
goto :eof
