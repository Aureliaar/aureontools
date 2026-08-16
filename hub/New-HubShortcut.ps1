<#
.SYNOPSIS
  Create a pinnable "Experiments Hub" shortcut that opens the hub in its own
  chrome-less window.

.DESCRIPTION
  Puts an .lnk in the Start Menu (and optionally on the Desktop) pointing at a
  Chromium browser in --app mode, with the generated hub.ico as its icon.

  Windows blocks programmatic taskbar pinning, so the last step is manual:
  find "Experiments Hub" in Start, right-click, Pin to taskbar.

  The hub must be running for the window to load anything — install-hubd.ps1
  registers it at logon.

.EXAMPLE
  .\New-HubShortcut.ps1
  .\New-HubShortcut.ps1 -Port 7777 -Desktop
  .\New-HubShortcut.ps1 -Remove
#>
[CmdletBinding()]
param(
  [int]$Port = 7777,
  [string]$Name = "Experiments Hub",
  [switch]$Desktop,
  [switch]$Remove,
  # Taskbar identity. A Chromium --app window stamps its own AppUserModelID, and
  # unless the shortcut carries the same one Windows treats the pinned icon and
  # the running window as two different things — two buttons on the taskbar.
  # Chrome derives it as Chrome.<host>_<path>; override if yours differs (read
  # the live value with Get-HubAumid below).
  [string]$Aumid = "Chrome.localhost_/"
)

$ErrorActionPreference = "Stop"

function Set-ShortcutAumid {
  param([string]$Path, [string]$Id)
  Add-Type -ErrorAction SilentlyContinue @'
using System;using System.Runtime.InteropServices;
public static class LnkAumid {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLink {}
  [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPersistFile {
    void GetClassID(out Guid id); [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string f, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string f, [MarshalAs(UnmanagedType.Bool)] bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string f);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string f);
  }
  [StructLayout(LayoutKind.Sequential)] struct PKEY { public Guid fmtid; public uint pid; }
  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    int GetCount(out uint c); int GetAt(uint i, out PKEY k);
    int GetValue(ref PKEY k, IntPtr pv); int SetValue(ref PKEY k, IntPtr pv); int Commit();
  }
  [DllImport("ole32.dll")] static extern int PropVariantClear(IntPtr pv);

  public static void Apply(string path, string id) {
    var link = new ShellLink();
    ((IPersistFile)link).Load(path, 2 /* STGM_READWRITE */);
    var store = (IPropertyStore)link;
    var key = new PKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    // InitPropVariantFromString is an inline in propvarutil.h, not a DLL export,
    // so lay the PROPVARIANT out by hand: VT_LPWSTR with the string pointer at
    // the union offset. PropVariantClear frees the string for us afterwards.
    IntPtr pv = Marshal.AllocCoTaskMem(32);
    for (int i = 0; i < 32; i++) Marshal.WriteByte(pv, i, 0);
    Marshal.WriteInt16(pv, 0, 31 /* VT_LPWSTR */);
    Marshal.WriteIntPtr(pv, IntPtr.Size == 8 ? 8 : 4, Marshal.StringToCoTaskMemUni(id));
    store.SetValue(ref key, pv);
    store.Commit();
    ((IPersistFile)link).Save(path, true);
    PropVariantClear(pv);
    Marshal.FreeCoTaskMem(pv);
    Marshal.ReleaseComObject(link);
  }
}
'@
  [LnkAumid]::Apply($Path, $Id)
}

$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) "$Name.lnk"
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$Name.lnk"

if ($Remove) {
  foreach ($p in @($startMenu, $desktopLnk)) {
    if (Test-Path $p) { Remove-Item $p; Write-Host "Removed $p" -ForegroundColor Green }
  }
  Write-Host "Unpin from the taskbar manually if you pinned it." -ForegroundColor Yellow
  return
}

# --- icon -------------------------------------------------------------------
$icon = Join-Path $PSScriptRoot "hub.ico"
if (-not (Test-Path $icon)) {
  Write-Host "Generating hub.ico..."
  & node (Join-Path $PSScriptRoot "make-icon.mjs") | Out-Null
}
if (-not (Test-Path $icon)) { throw "Could not produce hub.ico" }

# --- browser ----------------------------------------------------------------
# App mode gives a window with no tabs or omnibox, which is what makes this feel
# like an application rather than a bookmark.
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
  "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

$url = "http://localhost:$Port/"
if ($browser) {
  $target = $browser
  $arguments = "--app=$url"
  $mode = "$(Split-Path $browser -Leaf) app window"
} else {
  # No Chromium browser: fall back to whatever handles http, in a normal window.
  $target = (Get-Command cmd.exe).Source
  $arguments = "/c start `"`" `"$url`""
  $mode = "default browser (normal window)"
  Write-Host "No Chromium browser found — falling back to the default browser." -ForegroundColor Yellow
}

# --- shortcut ---------------------------------------------------------------
$shell = New-Object -ComObject WScript.Shell
foreach ($path in @($startMenu) + $(if ($Desktop) { $desktopLnk })) {
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $target
  $lnk.Arguments = $arguments
  $lnk.IconLocation = "$icon,0"
  $lnk.WorkingDirectory = $PSScriptRoot
  $lnk.Description = "Local project hub"
  $lnk.Save()
  if ($browser -and $Aumid) {
    try { Set-ShortcutAumid -Path $path -Id $Aumid }
    catch { Write-Host "  (could not stamp AppUserModelID: $_)" -ForegroundColor Yellow }
  }
  Write-Host "Created $path" -ForegroundColor Green
}
[Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null

# --- is the hub actually up? ------------------------------------------------
$up = $false
try {
  $c = New-Object Net.Sockets.TcpClient
  $up = $c.ConnectAsync('127.0.0.1', $Port).Wait(500)
  $c.Close()
} catch {}

Write-Host ""
Write-Host "  opens:  $url  ($mode)"
Write-Host "  icon:   $icon"
if ($up) {
  Write-Host "  hub:    running" -ForegroundColor Green
} else {
  Write-Host "  hub:    NOT running — the window will show a connection error." -ForegroundColor Yellow
  Write-Host "          Run .\install-hubd.ps1 to start it at logon." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "To pin: open Start, find `"$Name`", right-click -> Pin to taskbar." -ForegroundColor Cyan
Write-Host "(Windows blocks scripts from pinning; that click has to be yours.)"
