<#
  OrderTech Kiosk — Windows 10 IoT Enterprise provisioning script
  IMPORTANT: Run as Administrator on Windows 10 IoT Enterprise. Test in a lab first.

  What this does:
  - Creates a local kiosk user (ordertech-kiosk) and (optionally) adds it to Administrators
  - Enables Device Lockdown features (Shell Launcher v2, Keyboard Filter)
  - Sets OrderTech Kiosk as the shell for the kiosk user
  - Configures auto-logon for the kiosk user
  - Sets High Performance power plan and disables display sleep/hibernate
  - Enables desktop apps access to camera/microphone

  Adjust paths/names as needed. Shell path should match your installed EXE path.
#>

param(
  [string]$KioskUser = 'ordertech-kiosk',
  [string]$KioskPassword = 'ChangeMe#2025',
  [switch]$MakeKioskAdmin = $true,
  [string]$ShellPath = 'C:\\Program Files\\OrderTech Kiosk\\OrderTech Kiosk.exe'
)

function Ensure-Admin {
  if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error 'Run this script in an elevated PowerShell session (as Administrator).'
    exit 1
  }
}

function New-KioskUser {
  if (-not (Get-LocalUser -Name $KioskUser -ErrorAction SilentlyContinue)) {
    Write-Host "Creating user $KioskUser" -ForegroundColor Cyan
    $pwd = ConvertTo-SecureString $KioskPassword -AsPlainText -Force
    New-LocalUser -Name $KioskUser -Password $pwd -FullName 'OrderTech Kiosk' -PasswordNeverExpires -AccountNeverExpires | Out-Null
  } else { Write-Host 'User already exists' }
  if ($MakeKioskAdmin) { Add-LocalGroupMember -Group 'Administrators' -Member $KioskUser -ErrorAction SilentlyContinue }
}

function Enable-DeviceLockdownFeatures {
  Write-Host 'Enabling Device Lockdown features (Shell Launcher, Keyboard Filter)...' -ForegroundColor Cyan
  dism /online /Enable-Feature /FeatureName:Client-EmbeddedShellLauncher /All | Out-Null
  dism /online /Enable-Feature /FeatureName:Client-DeviceLockdown /All | Out-Null
  dism /online /Enable-Feature /FeatureName:Client-KeyboardFilter /All | Out-Null
}

function Set-AutoLogon {
  Write-Host 'Configuring auto-logon...' -ForegroundColor Cyan
  New-Item 'HKLM:SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' -Force | Out-Null
  Set-ItemProperty 'HKLM:SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' 'AutoAdminLogon' -Value '1' -Type String
  Set-ItemProperty 'HKLM:SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' 'DefaultUserName' -Value $KioskUser -Type String
  Set-ItemProperty 'HKLM:SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' 'DefaultPassword' -Value $KioskPassword -Type String
}

function Set-KioskShell {
  Write-Host 'Setting Shell Launcher mapping...' -ForegroundColor Cyan
  Import-Module ShellLauncher -ErrorAction SilentlyContinue
  $sid = (New-Object System.Security.Principal.NTAccount($KioskUser)).Translate([System.Security.Principal.SecurityIdentifier]).Value
  # RestartShell ensures the shell relaunches on crash/exit
  try {
    Set-ShellLauncher -Set -SID $sid -Shell $ShellPath -DefaultAction RestartShell -FallbackShell 'explorer.exe'
  } catch {
    Write-Warning 'Set-ShellLauncher failed. Verify ShellLauncher module availability and parameters on your SKU.'
  }
}

function Set-KeyboardFilter {
  Write-Host 'Configuring Keyboard Filter...' -ForegroundColor Cyan
  # Allow Ctrl+Shift+K (admin menu). Typically block Windows keys, Alt+Tab, Alt+F4, Ctrl+Esc.
  # Use Embedded Lockdown Manager GUI for fine-grained policies, or configure via registry/GPO.
}

function Set-PowerSettings {
  Write-Host 'Setting power plan to High Performance and disabling sleep...' -ForegroundColor Cyan
  powercfg /SETACTIVE SCHEME_MIN | Out-Null
  powercfg /X monitor-timeout-ac 0 | Out-Null
  powercfg /X standby-timeout-ac 0 | Out-Null
  powercfg /HIBERNATE OFF | Out-Null
}

function Enable-DesktopMediaAccess {
  Write-Host 'Enabling desktop apps access to camera and microphone...' -ForegroundColor Cyan
  New-Item 'HKLM:SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Privacy' -Force | Out-Null
  Set-ItemProperty 'HKLM:SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Privacy' 'LetAppsAccessMicrophone' -Value 1 -Type DWord
  Set-ItemProperty 'HKLM:SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Privacy' 'LetAppsAccessCamera' -Value 1 -Type DWord
}

Ensure-Admin
New-KioskUser
Enable-DeviceLockdownFeatures
Set-AutoLogon
Set-KioskShell
Set-KeyboardFilter
Set-PowerSettings
Enable-DesktopMediaAccess

Write-Host 'Provisioning complete. Rebooting to apply...' -ForegroundColor Green
Restart-Computer -Force

