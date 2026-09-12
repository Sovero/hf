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

REM update.ps1 prints the newer tag, "NEED_TOKEN", or nothing.
set "NEW_VERSION="
for /f "delims=" %%t in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" check 2^>nul') do set "NEW_VERSION=%%t"

if not "!NEW_VERSION!"=="NEED_TOKEN" goto have_version
echo   This repository is private - checking for updates needs a one-time
echo   GitHub token. It is stored only on this PC, in %%APPDATA%%\HueForgeWeb.
echo   Create one at https://github.com/settings/personal-access-tokens
echo   (fine-grained: only Sovero/hf, Contents: Read + Metadata: Read).
choice /c YN /n /m "  Enter a GitHub token now? [Y/N]: "
if errorlevel 2 goto token_declined

echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" save-token
if errorlevel 1 goto token_failed
echo   Token saved. Checking again...
set "NEW_VERSION="
for /f "delims=" %%t in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" check 2^>nul') do set "NEW_VERSION=%%t"
if "!NEW_VERSION!"=="NEED_TOKEN" set "NEW_VERSION="
goto have_version

:token_declined
echo   Token declined - continuing with the current files.
set "NEW_VERSION="
goto have_version

:token_failed
echo   Token not saved - continuing with the current files.
set "NEW_VERSION="

:have_version
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
set "UPDATE_SRC="
for /f "delims=" %%d in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" download %NEW_VERSION% 2^>nul') do set "UPDATE_SRC=%%d"
if errorlevel 1 goto update_failed
if not defined UPDATE_SRC goto update_failed
REM Copy the new tree over this folder. node_modules is kept (npm install
REM below refreshes it); *.bat and update.ps1 are kept so the running
REM installer/updater is not replaced mid-run. They arrive with the next
REM fresh deploy.
robocopy "%UPDATE_SRC%" "%PROJECT_DIR%" /E /XF *.bat update.ps1 /XD node_modules .git /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto update_failed
del "%TEMP%\hf_update.zip" >nul 2>&1
rmdir /s /q "%TEMP%\hf_update" >nul 2>&1
echo   Updated to %NEW_VERSION%.
echo   (install.bat / start.bat / update.ps1 changes, if any, apply on the next fresh install.)
goto after_update

:update_failed
echo   ERROR: could not apply the update. Check your internet connection
echo   and try again - continuing with the current files.
del "%TEMP%\hf_update.zip" >nul 2>&1
rmdir /s /q "%TEMP%\hf_update" >nul 2>&1

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