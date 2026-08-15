<#
.SYNOPSIS
  Register (or remove) hubd as a Task Scheduler job that starts at logon.

.DESCRIPTION
  Runs under your own account in the current-user scope, so no admin rights and
  no Windows service plumbing are needed. The task runs hidden; check on it at
  http://localhost:<Port> or via `Get-ScheduledTask AureonHub`.

.EXAMPLE
  .\install-hubd.ps1
  .\install-hubd.ps1 -Registry E:\experiments\ports.json -Port 7777
  .\install-hubd.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [string]$Registry = "E:\experiments\ports.json",
  [int]$Port = 7777,
  [string]$TaskName = "AureonHub",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Green
  } else {
    Write-Host "No scheduled task named '$TaskName'." -ForegroundColor Yellow
  }
  return
}

$daemon = Join-Path $PSScriptRoot "hubd.mjs"
if (-not (Test-Path $daemon))   { throw "hubd.mjs not found next to this script ($PSScriptRoot)." }
if (-not (Test-Path $Registry)) { throw "Registry not found: $Registry" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node not found on PATH." }

$action = New-ScheduledTaskAction -Execute $node `
  -Argument "`"$daemon`" --registry `"$Registry`" --port $Port" `
  -WorkingDirectory $PSScriptRoot

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Restart if it dies; never let Windows stop it for running "too long".
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description "Local project hub: serves the index and supervises dev servers." | Out-Null

Write-Host "Registered '$TaskName' — starts at logon." -ForegroundColor Green
Write-Host "  hub:      http://localhost:$Port"
Write-Host "  registry: $Registry"
Write-Host "  start now:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "  stop:       Stop-ScheduledTask  -TaskName $TaskName"
Write-Host "  remove:     .\install-hubd.ps1 -Uninstall"
