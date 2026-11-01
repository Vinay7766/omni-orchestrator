@echo off
setlocal
title OmniOrchestrator Desktop Launcher

echo =======================================================
echo          OmniOrchestrator Local Dev Launcher
echo =======================================================
echo.

:: Initialize MSVC x64 build environment
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsx86_amd64.bat" (
    echo [1/3] Initializing Visual Studio MSVC BuildTools...
    call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsx86_amd64.bat" >nul 2>&1
)

:: Check for node_modules
if not exist "node_modules" (
    echo [2/3] Installing dependencies...
    call npm install
)

echo [3/3] Launching OmniOrchestrator Desktop Application...
echo.
echo The desktop application window will open shortly.
echo Press Ctrl+C in this terminal window to stop the dev server.
echo.

call npx tauri dev

pause
