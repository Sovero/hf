@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title HueForge Web — Installer

echo.
echo ============================================
echo   HueForge Web — First-time Installer
echo ============================================
echo.

REM ---- 1. Locate project folder (this script's directory) ----
pushd "%~dp0"
set "PROJECT_DIR=%CD%"
echo [1/5] Project folder: %PROJECT_DIR%

REM ---- 2. Check Node.js ----
echo.
echo [2/5] Checking for Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   ERROR: Node.js is not installed on this PC.
    echo   Please install the LTS version from https://nodejs.org
    echo   then run this installer again.
    echo.
    pause
    popd
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do set "NODE_VER=%%v"
echo   Node.js found: !NODE_VER!

REM ---- 3. Install dependencies ----
echo.
echo [3/5] Installing dependencies (this may take a minute)...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo   ERROR: npm install failed. Check your internet connection and try again.
    echo.
    pause
    popd
    exit /b 1
)
echo   Dependencies installed.

REM ---- 4. Desktop shortcut ----
echo.
echo [4/5] Create a desktop shortcut to start the app?
choice /c YN /n /m "  [Y/N]: "
if errorlevel 2 goto skip_shortcut
if errorlevel 1 goto make_shortcut

:make_shortcut
set "DESKTOP=%USERPROFILE%\Desktop"
if exist "%PUBLIC%\Desktop" set "DESKTOP=%PUBLIC%\Desktop"
set "LNK=%DESKTOP%\HueForge Web.lnk"
set "VBS=%TEMP%\make_hueforge_shortcut.vbs"
> "!VBS!" echo Set oWS = WScript.CreateObject("WScript.Shell")
>>!VBS! echo sLinkFile = "!LNK!"
>>!VBS! echo Set oLink = oWS.CreateShortcut(sLinkFile)
>>!VBS! echo oLink.TargetPath = "%PROJECT_DIR%\start.bat"
>>!VBS! echo oLink.WorkingDirectory = "%PROJECT_DIR%"
>>!VBS! echo oLink.Description = "HueForge Web - filament paintings for 3D printing"
>>!VBS! echo oLink.Save
cscript //nologo "!VBS!" >nul 2>&1
del "!VBS!" >nul 2>&1
if exist "!LNK!" (
    echo   Shortcut created: "!LNK!"
) else (
    echo   Could not create shortcut - you can start the app with start.bat
)
goto after_shortcut

:skip_shortcut
echo   Skipped. You can always start the app with start.bat

:after_shortcut
popd

REM ---- 5. Start server now ----
echo.
echo [5/5] Starting the app...
echo   When the browser opens, the server address is http://127.0.0.1:5173
echo   (Close this window to stop the server.)
echo.
call "%~dp0start.bat"
exit /b 0