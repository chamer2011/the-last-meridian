@echo off
title Almagest Explorer's - Godot view
cd /d "%~dp0"
rem Opens the Godot view of the game (the folder "godot"): what's seen and clicked, being moved to Godot a step at a time.
rem It shows the game being played. If the game is already running (start-game.bat, or the app), it joins it; if not, it
rem starts the game itself, hidden, and stops it again when its window closes.
rem The game's rules stay in JavaScript, so it needs Node.js, as start-game.bat does.
set "PATH=%PATH%;C:\Program Files\nodejs"
where node >nul 2>nul
if errorlevel 1 goto no_node

rem Godot 4.3 itself: fetched once from Godot's own page on GitHub into a folder git leaves out, and checked.
set "ENGINE_DIR=godot-engine"
set "ENGINE=%ENGINE_DIR%\Godot_v4.3-stable_win64.exe"
set "ENGINE_CONSOLE=%ENGINE_DIR%\Godot_v4.3-stable_win64_console.exe"
set "ENGINE_ZIP=%ENGINE_DIR%\godot-4.3.zip"
set "ENGINE_FROM=https://github.com/godotengine/godot/releases/download/4.3-stable/Godot_v4.3-stable_win64.exe.zip"
set "ENGINE_SHA256=8f2c75b734bd956027ae3ca92c41f78b5d5a255dacc0f20e4e3c523c545ad410"

if exist "%ENGINE%" goto have_engine
echo First-time setup: fetching Godot 4.3, about 55 MB. This happens once.
if not exist "%ENGINE_DIR%" mkdir "%ENGINE_DIR%"
curl -L --fail --progress-bar -o "%ENGINE_ZIP%" "%ENGINE_FROM%"
if errorlevel 1 goto no_download
certutil -hashfile "%ENGINE_ZIP%" SHA256 | findstr /i /c:"%ENGINE_SHA256%" >nul
if errorlevel 1 goto bad_download
tar -xf "%ENGINE_ZIP%" -C "%ENGINE_DIR%"
if errorlevel 1 goto no_unpack
del "%ENGINE_ZIP%"
if not exist "%ENGINE%" goto no_unpack

:have_engine
rem Godot gets the project ready first (its fonts and scripts), or a fresh copy won't start.
echo Getting the Godot view ready. Its window opens in a few seconds.
"%ENGINE_CONSOLE%" --headless --path godot --import >nul 2>nul
start "" "%ENGINE%" --path godot
exit /b 0

:no_node
echo Node.js isn't installed. Get the LTS version from https://nodejs.org and try again.
pause
exit /b 1

:no_download
echo Godot couldn't be fetched. Check that you're online and try again.
if exist "%ENGINE_ZIP%" del "%ENGINE_ZIP%"
pause
exit /b 1

:bad_download
echo What came down isn't the Godot 4.3 this was written for, so it hasn't been opened. Try again, and tell Claude if it happens twice.
del "%ENGINE_ZIP%"
pause
exit /b 1

:no_unpack
echo Godot was fetched but couldn't be unpacked. Tell Claude what this window says.
pause
exit /b 1
