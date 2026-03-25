@echo off
setlocal
pushd "%~dp0.."

set "NODE_HOME=C:\nvm4w\nodejs"
set "NODE_EXE=%NODE_HOME%\node.exe"
set "FIREBASE_JS=%~dp0..\node_modules\firebase-tools\lib\bin\firebase.js"

if not exist "%NODE_EXE%" (
  echo [ERROR] Khong tim thay Node 22 tai "%NODE_EXE%"
  echo Hay mo nvm va chuyen sang Node 22.14.0 truoc, hoac bao minh de minh sua tiep.
  exit /b 1
)

if not exist "%FIREBASE_JS%" (
  echo [ERROR] Khong tim thay firebase-tools tai "%FIREBASE_JS%"
  exit /b 1
)

set "PATH=%NODE_HOME%;%PATH%"

echo [INFO] Node hien tai:
call "%NODE_EXE%" -v
if errorlevel 1 (
  echo [ERROR] Node chua san sang tai "%NODE_EXE%"
  exit /b 1
)

echo [INFO] Dang chay Firebase emulators...
call "%NODE_EXE%" "%FIREBASE_JS%" emulators:start
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%
