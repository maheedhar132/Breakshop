@echo off
rem Starts BreakShop. Usage: run.bat [full|lite]
rem Uses the Node.js already on this PC when it is new enough. Asks before downloading anything.
setlocal
cd /d "%~dp0"

set "PROFILE=%~1"
if "%PROFILE%"=="" set "PROFILE=full"
if not defined BS_MIN_NODE set "BS_MIN_NODE=22"
set "BS_NODE_DIR=%USERPROFILE%\.breakshop\node"

call :detect
if defined NODE_OK goto run
if exist "%BS_NODE_DIR%\node.exe" set "PATH=%BS_NODE_DIR%;%PATH%"
call :detect
if defined NODE_OK goto run

if defined FOUND_VER (
  echo This PC has Node.js %FOUND_VER%, but BreakShop needs Node.js %BS_MIN_NODE% or newer.
) else (
  echo Node.js was not found on this PC. BreakShop needs Node.js %BS_MIN_NODE% or newer.
)
if "%BS_AUTO_INSTALL_NODE%"=="1" goto install
if "%BS_AUTO_INSTALL_NODE%"=="0" goto refuse
echo I can download a private copy of Node.js 22 ^(about 30 MB^) into "%BS_NODE_DIR%".
echo Nothing else on this PC changes, and the Node.js you already have is left alone.
set "ANSWER="
set /p "ANSWER=Download it now? [Y/n] "
if /i "%ANSWER%"=="n" goto refuse

:install
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-node.ps1"
if exist "%BS_NODE_DIR%\node.exe" set "PATH=%BS_NODE_DIR%;%PATH%"
call :detect
if defined NODE_OK goto run
echo Node.js %BS_MIN_NODE% or newer is still not available. Install it from https://nodejs.org and run run.bat again.
exit /b 1

:refuse
echo Install Node.js from https://nodejs.org and run run.bat again.
exit /b 1

:run
if defined BS_DRY_RUN (
  echo Using Node.js %FOUND_VER%
  exit /b 0
)
if not exist "node_modules\sqlite3" (
  call npm ci --omit=dev
  if errorlevel 1 exit /b 1
)
node "%~dp0supervisor\index.js" --profile "%PROFILE%"
exit /b %errorlevel%

:detect
set "NODE_OK="
set "FOUND_VER="
for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do set "FOUND_VER=%%v"
if not defined FOUND_VER exit /b 0
for /f "tokens=1 delims=." %%m in ("%FOUND_VER%") do if %%m GEQ %BS_MIN_NODE% set "NODE_OK=1"
exit /b 0
