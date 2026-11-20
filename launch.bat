@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -V >nul 2>nul
  if %errorlevel%==0 (
    echo Starting local server with Python...
    py -3 "%~dp0server.py"
    goto :eof
  )
)

where python >nul 2>nul
if %errorlevel%==0 (
  python -c "import sys; assert sys.version_info[0]==3" >nul 2>nul
  if %errorlevel%==0 (
    echo Starting local server with Python...
    python "%~dp0server.py"
    goto :eof
  )
)

where node >nul 2>nul
if %errorlevel%==0 (
  echo Starting local server with Node.js...
  node "%~dp0server.mjs"
  goto :eof
)

echo Opening index.html directly in browser...
start "" "%~dp0index.html"
