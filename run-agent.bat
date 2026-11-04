@echo off
rem Background launcher for Task Scheduler / services. Output goes to agent.log.
cd /d "%~dp0"
node server.js >> agent.log 2>&1
