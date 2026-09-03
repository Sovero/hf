@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title HueForge Web - Installer & Updater

echo.
echo ============================================
echo   HueForge Web - Installer & Updater
echo ============================================
echo.

REM ---- 1. Locate project folder (this script's directory) ----
pushd "%~dp0"
set "PROJECT_DIR=%CD%"
echo [1/6] Project folder: %PROJECT_DIR%

REM ---- 2. Check Node.js ----
echo.
echo [2/6] Checking for Node.js...
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

REM ---- 3. Check for updates (latest tagged GitHub release) ----
echo.
echo [3/6] Checking for updates on GitHub...

REM Local version comes from package.json (single source of truth).
set "LOCAL_VERSION="
for /f "delims=" %%v in ('node -p "require('./package.json').version" 2^>nul') do set "LOCAL_VERSION=%%v"
if not defined LOCAL_VERSION set "LOCAL_VERSION=0.0.0"

set "HF_LOCAL=%LOCAL_VERSION%"
set "NEW_VERSION="
REM Queries https://api.github.com/repos/Sovero/hf/releases/latest and prints the
REM tag (e.g. "v0.2.0") only when it is newer than the local version.
for /f "delims=" %%t in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; try { $r = Invoke-RestMethod -Uri 'https://api.github.com/repos/Sovero/hf/releases/latest' -Headers @{ 'User-Agent'='HueForge-Installer' } -TimeoutSec 15 } catch { exit 0 }; $lv = $env:HF_LOCAL -split '\.'; $tv = ($r.tag_name -replace '^v','') -split '\.'; $lp = '{0:D6}{1:D6}{2:D6}' -f [int]$lv[0],[int]$lv[1],[int]$lv[2]; $tp = '{0:D6}{1:D6}{2:D6}' -f [int]$tv[0],[int]$tv[1],[int]$tv[2]; if ($tp -gt $lp) { $r.tag_name }" 2^>nul') do set "NEW_VERSION=%%t"

if not defined NEW_VERSION (
    echo   Already on the latest release (v%LOCAL_VERSION%).
    goto after_update
)

echo   Local: v%LOCAL_VERSION%   Latest: %NEW_VERSION%
choice /c YN /n /m "  Update to %NEW_VERSION% now? [Y/N]: "
if errorlevel 2 goto update_no
if errorlevel 1 goto update_yes

:update_no
echo   Skipped update - continuing with the current files.
goto after_update

:update_yes
echo.
echo   Downloading %NEW_VERSION% from GitHub...
set "HF_TAG=%NEW_VERSION%"
REM Fetches the release, prefers the hueforge-web-*.zip asset and falls back
REM to GitHub's tag archive, then extracts to a temp folder.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $r = Invoke-RestMethod -Uri ('https://api.github.com/repos/Sovero/hf/releases/tags/' + $env:HF_TAG) -Headers @{ 'User-Agent'='HueForge-Installer' } -TimeoutSec 20; $asset = $r.assets | Where-Object { $_.name -like 'hueforge-web-*.zip' } | Select-Object -First 1; if ($asset) { $u = $asset.browser_download_url } else { $u = 'https://github.com/Sovero/hf/archive/refs/tags/' + $env:HF_TAG + '.zip' }; Invoke-WebRequest -Uri $u -OutFile ($env:TEMP + '\hf_update.zip') -UseBasicParsing; Expand-Archive -Path ($env:TEMP + '\hf_update.zip') -DestinationPath ($env:TEMP + '\hf_update') -Force"
if errorlevel 1 (
    echo   ERROR: could not download the update. Check your internet connection
    echo   and try again - continuing with the current files.
    goto after_update
)
REM Copy the new tree over this folder. node_modules is kept (npm install
REM below refreshes it); *.bat is kept so this running script is not replaced
REM mid-run. New install.bat/start.bat arrive with the next fresh deploy.
robocopy "%TEMP%\hf_update" "%PROJECT_DIR%" /E /XF *.bat /XD node_modules .git /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
    echo   ERROR: could not copy the update files.
    goto after_update
)
del "%TEMP%\hf_update.zip" >nul 2>&1
rmdir /s /q "%TEMP%\hf_update" >nul 2>&1
echo   Updated to %NEW_VERSION%.
echo   (install.bat / start.bat changes, if any, apply on the next fresh install.)

:after_update
popd

REM ---- 4. Install dependencies ----
echo.
echo [4/6] Installing dependencies (this may take a minute)...
pushd "%~dp0"
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
popd

REM ---- 5. Desktop shortcut ----
echo.
echo [5/6] Create a desktop shortcut to start the app?
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

REM ---- 6. Start server now ----
echo.
echo [6/6] Starting the app...
echo   When the browser opens, the server address is http://127.0.0.1:5173
echo   (Close this window to stop the server.)
echo.
call "%~dp0start.bat"
exit /b 0