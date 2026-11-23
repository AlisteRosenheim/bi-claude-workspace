@echo off
rem Rebuilds the Android app from the www folder. Bump versionCode in android\app\build.gradle before each new release.
set JAVA_HOME=C:\Users\SCMPH340\AndroidDev\jdk17
cd /d "%~dp0android"
call C:\Users\SCMPH340\AndroidDev\gradle-8.11.1\bin\gradle.bat --no-daemon -q assembleRelease || exit /b 1
copy /y app\build\outputs\apk\release\app-release.apk "%~dp0TarotReader.apk" >nul
echo Built %~dp0TarotReader.apk
