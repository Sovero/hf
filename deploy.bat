@echo off
REM Console messages stay ASCII on purpose: cmd.exe mis-parses a .bat that
REM carries non-ASCII text, so Russian wording is printed by PowerShell
REM (update.ps1 say <key> - see the :say subroutine).
setlocal
chcp 65001 >nul
title HueForge Web

pushd "%~dp0"

REM ---- Check Node.js (the only requirement) ----
where node >nul 2>&1
if errorlevel 1 (
    call :say deploy.node-missing
    pause
    popd
    exit /b 1
)

REM ---- Check the production build is present ----
if not exist "dist\index.html" (
    call :say deploy.no-dist
    pause
    popd
    exit /b 1
)

set "PORT=%1"
if "%PORT%"=="" set "PORT=8080"

call :say deploy.starting "%PORT%"
call :say close-hint
echo.

start "" "http://127.0.0.1:%PORT%"
node server.mjs %PORT%

popd
exit /b 0

:say
REM Print a Russian console message: update.ps1 say <key> [args...]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" say %*
goto :eof
