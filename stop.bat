@echo off
rem Stops BreakShop.
setlocal
cd /d "%~dp0"
set "BS_NODE_DIR=%USERPROFILE%\.breakshop\node"
if exist "%BS_NODE_DIR%\node.exe" set "PATH=%BS_NODE_DIR%;%PATH%"
node "%~dp0supervisor\stop.js"
