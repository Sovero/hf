@echo off
REM Console messages stay ASCII on purpose: cmd.exe mis-parses a .bat that carries
REM non-ASCII text (its reader misaligns on multi-byte characters), so the Russian
REM wording is printed by PowerShell - see update.ps1, command "say" (:say below).
setlocal EnableDelayedExpansion
chcp 65001 >nul
title HueForge Web - Installer / Updater

echo.
call :say install.banner
echo.

REM ---- 1. Locate project folder (this script's directory) ----
pushd "%~dp0"
set "PROJECT_DIR=%CD%"
call :say install.folder "%PROJECT_DIR%"

REM ---- 2. Check Node.js ----
echo.
call :say install.node-checking
where node >nul 2>&1
if errorlevel 1 (
    call :say install.node-missing
    pause
    popd
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do set "NODE_VER=%%v"
call :say install.node-found "!NODE_VER!"

REM ---- 3. Check for updates (latest tagged GitHub release) ----
echo.
call :say install.updates-checking

REM Local version comes from package.json (single source of truth).
set "LOCAL_VERSION="
for /f "delims=" %%v in ('node -p "require('./package.json').version" 2^>nul') do set "LOCAL_VERSION=%%v"
if not defined LOCAL_VERSION set "LOCAL_VERSION=0.0.0"
set "HF_LOCAL=%LOCAL_VERSION%"

REM update.ps1 prints the newer tag, "NEED_TOKEN", or nothing.
set "NEW_VERSION="
for /f "delims=" %%t in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" check 2^>nul') do set "NEW_VERSION=%%t"

if not "!NEW_VERSION!"=="NEED_TOKEN" goto have_version
call :say install.token-needed
call :say install.token-ask
choice /c YN /n /m "  [Y/N] "
if errorlevel 2 goto token_declined

echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" save-token
if errorlevel 1 goto token_failed
call :say install.token-saved
set "NEW_VERSION="
for /f "delims=" %%t in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" check 2^>nul') do set "NEW_VERSION=%%t"
if "!NEW_VERSION!"=="NEED_TOKEN" set "NEW_VERSION="
goto have_version

:token_declined
call :say install.token-declined
set "NEW_VERSION="
goto have_version

:token_failed
call :say install.token-failed
set "NEW_VERSION="

:have_version
if not defined NEW_VERSION (
    call :say install.latest "%LOCAL_VERSION%"
    goto after_update
)
call :say install.version-pair "%LOCAL_VERSION%" "%NEW_VERSION%"
call :say install.update-ask "%NEW_VERSION%"
choice /c YN /n /m "  [Y/N] "
if errorlevel 2 goto update_no
if errorlevel 1 goto update_yes

:update_no
call :say install.update-skipped
goto after_update

:update_yes
echo.
call :say install.downloading "%NEW_VERSION%"
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
call :say install.updated "%NEW_VERSION%"
goto after_update

:update_failed
call :say install.update-failed
del "%TEMP%\hf_update.zip" >nul 2>&1
rmdir /s /q "%TEMP%\hf_update" >nul 2>&1

:after_update
popd

REM ---- 4. Install dependencies ----
echo.
call :say install.deps
pushd "%~dp0"
call npm install --no-audit --no-fund
if errorlevel 1 (
    call :say install.deps-failed
    pause
    popd
    exit /b 1
)
call :say install.deps-ok
popd

REM ---- 5. Desktop shortcut ----
echo.
call :say install.shortcut-ask
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
    call :say install.shortcut-created "!LNK!"
) else (
    call :say install.shortcut-failed
)
goto after_shortcut

:skip_shortcut
call :say install.shortcut-skipped

:after_shortcut

REM ---- 6. Start server now ----
echo.
call :say install.starting
call :say install.address
call :say close-hint
echo.
call "%~dp0start.bat"
exit /b 0

:say
REM Print a Russian console message: update.ps1 say <key> [args...]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" say %*
goto :eof
