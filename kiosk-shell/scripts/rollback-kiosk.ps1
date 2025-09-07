<#
  OrderTech Kiosk — Rollback script
  Restores Explorer as shell, disables auto-logon and (optionally) removes kiosk user.
#>
param(
  [string]$KioskUser = 'ordertech-kiosk',
  [switch]$RemoveUser = $false
)

function Ensure-Admin {
  if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error 'Run this script as Administrator.'
    exit 1
  }
}

function Reset-ShellLauncher {
  try {
    Import-Module ShellLauncher -ErrorAction SilentlyContinue
    $sid = (New-Object System.Security.Principal.NTAccount($KioskUser)).Translate([System.Security.Principal.SecurityIdentifier]).Value
    Set-ShellLauncher -Delete -SID $sid
  } catch {
    Write-Warning 'Failed to reset Shell Launcher. Verify module/SKU.'
  }
}

function Disable-AutoLogon {
  if (Test-Path 'HKLM:SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon') {
    Set-ItemProperty 'HKLM:SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' 'AutoAdminLogon' -Value '0' -Type String
    Remove-ItemProperty 'HKLM:SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' 'DefaultPassword' -ErrorAction SilentlyContinue
  }
}

function Remove-KioskUser {
  if ($RemoveUser) {
    try { Remove-LocalUser -Name $KioskUser } catch { Write-Warning "Could not remove user $KioskUser" }
  }
}

Ensure-Admin
Reset-ShellLauncher
Disable-AutoLogon
Remove-KioskUser

Write-Host 'Rollback complete. Sign out and sign in to verify.' -ForegroundColor Green

