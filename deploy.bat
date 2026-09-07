@echo off
setlocal
chcp 65001 >nul
title HueForge Web

pushd "%~dp0"

REM ---- Check Node.js (the only requirement) ----
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is not installed. Get the LTS version from https://nodejs.org
    pause
    popd
    exit /b 1
)

REM ---- Check the production build is present ----
if not exist "dist\index.html" (
    echo dist\ not found - this folder is not a deploy package.
    echo Take the files from hueforge-web-deploy-*.zip instead.
    pause
    popd
    exit /b 1
)

set "PORT=%1"
if "%PORT%"=="" set "PORT=8080"

echo Starting HueForge Web at http://127.0.0.1:%PORT% ...
echo (Close this window to stop the server.)
echo.

start "" "http://127.0.0.1:%PORT%"
node server.mjs %PORT%

popd
