@echo off
REM ===================================================================
REM  Short Deck solver - the long, high-quality run.
REM  Double-click this file. That is the whole procedure.
REM ===================================================================
cd /d "%~dp0"

echo.
echo   SHORT DECK SOLVER - LONG RUN
echo   ============================
echo.
echo   This teaches the bot by playing 3 billion hands against itself,
echo   at each of the 9 stack sizes, all at the same time.
echo.
echo   It will take roughly 2 DAYS and will use all your CPU cores.
echo   (Measured on this PC: the deepest stack is the slow one.)
echo   Your PC stays usable but will feel slower and run warm.
echo.
echo   You can stop it at any time by closing this window - but the work
echo   is only saved at the very END, so stopping early saves nothing.
echo.
echo   When it finishes it writes two files into the data folder.
echo   Tell Claude "the solve is done" and it will publish them.
echo.
pause

where cargo >nul 2>nul
if errorlevel 1 (
  echo.
  echo   ERROR: Rust is not installed, or this window was opened before
  echo   Rust finished installing.
  echo.
  echo   Fix: open PowerShell and run
  echo        winget install Rustlang.Rustup
  echo   then CLOSE this window, open a new one, and try again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Building...
cargo build --release
if errorlevel 1 (
  echo.
  echo   BUILD FAILED. Copy the red text above and send it to Claude.
  pause
  exit /b 1
)

echo.
echo   Starting. Progress lines appear below - each depth reports every 10%%.
echo   Started at %DATE% %TIME%
echo.

cargo run --release -- --iters 3000000000

echo.
echo   ============================
echo   Finished at %DATE% %TIME%
echo.
echo   If it printed "wrote ..\data\strategy.json" and "wrote ..\data\strategy.bin"
echo   then it worked. Tell Claude the solve is done.
echo.
pause
