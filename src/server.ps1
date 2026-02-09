# Excel & Folder Monitoring Server (PowerShell)
$port = 8080
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class WinAPI {
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumDelegate lpEnumCallbackFunction, IntPtr lParam);
  public delegate bool EnumDelegate(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder strText, int maxCount);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
}
"@

function FocusWindow {
  param (
    $hwnd
  )  
  [WinAPI]::ShowWindow($hwnd, 9) | Out-Null  # SW_RESTORE
  [WinAPI]::keybd_event(0, 0, 0, 0) | Out-Null
  [WinAPI]::SetForegroundWindow($hwnd) | Out-Null
  [WinAPI]::ShowWindow($hwnd, 5) | Out-Null # SW_SHOW
}
function OpenOrFocusParentFolder {
  param (
    $TargetFilePath
  )
  $targetPath = Split-Path -Path $TargetFilePath -Parent
  $shell = New-Object -ComObject Shell.Application
  $openFolders = $shell.Windows() | ForEach-Object {
    try {
      $url = $_.LocationURL
      if ($url) {
        [PSCustomObject]@{
          LocationURL = [System.Uri]::UnescapeDataString($url).Replace("file:///", "").Replace("/", "\").TrimEnd('\')
          Hwnd        = $_.Hwnd
        }
      }
    }
    catch { $null }
  }

  foreach ($window in $openFolders) {
    if ($window.LocationURL -eq $targetPath) {
      FocusWindow($window.hWnd)
      return
    }
  }
  Invoke-Item $targetPath
}

class MyClass {
  static [string] GetList() {
    $win32 = "WinAPI" -as [type]
    # 1. Get Excel Data
    $excelData = @()
    try {
      $excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
      if ($excel) {
        foreach ($wb in $excel.Workbooks) {
          $excelData += @{
            name       = $wb.Name
            path       = Split-Path -Path $wb.FullName -Parent
            isSaved    = $wb.Saved
            sheetCount = $wb.Sheets.Count
            hwnd       = $wb.Windows(1).Hwnd
          }
        }
        if ($excel.ProtectedViewWindows.Count -gt 0) {
          $windows = New-Object System.Collections.Generic.List[IntPtr]
          $callback = {
            param([IntPtr]$hWnd, [int]$lParam)
            if ($win32::IsWindowVisible($hWnd)) {
              $sb = New-Object System.Text.StringBuilder 256
              $win32::GetWindowText($hWnd, $sb, $sb.Capacity)
              $title = $sb.ToString()
              if (-not [string]::IsNullOrWhiteSpace($title)) {
                $windows.Add($hWnd)
                # Write-Host "HWND: $hWnd - Title: $title"
              }
            }
            return $true
          }
          $win32::EnumDesktopWindows([IntPtr]::Zero, $callback, [IntPtr]::Zero)

          foreach ($wb in $excel.ProtectedViewWindows) {
            $hwnd = $null
            foreach ($hwnd1 in $windows) {
              $sb = New-Object System.Text.StringBuilder 256
              $win32::GetWindowText($hwnd1, $sb, $sb.Capacity)
              $title = $sb.ToString()
              if ($title.StartsWith($wb.Caption.Replace(".xlsx", ""))) {
                # Write-Host "Found HWND: $hwnd1 | Title: $title"
                $hwnd = $hwnd1
                break
              }
            }
            $excelData += @{
              name       = $wb.SourceName
              path       = $wb.SourcePath
              isSaved    = $false
              sheetCount = - 1
              hwnd       = $hwnd
            }
          }
        }
      }
    }
    catch {
      Write-Host $_
    }

    # 2. Get Open Folders (Explorer)
    $folderData = @()
    try {
      $shell = New-Object -ComObject Shell.Application
      foreach ($window in $shell.Windows()) {
        # Filter for file system windows (not Internet Explorer)
        if ($window.LocationURL -like "file://*") {
          try {
            $path = ([uri]$window.LocationURL).LocalPath
            $folderData += @{
              name = $window.LocationName
              path = $path
              hwnd = $window.Hwnd
            }
          }
          catch {}
        }
      }
    }
    catch {
      Write-Host $_
    }

    $result = @{
      excels  = $excelData
      folders = $folderData
    }

    $json = $result | ConvertTo-Json -Compress
    return $json
  }
}

try {
  $listener.Start()
  Write-Host "Server started on http://localhost:$port/" -ForegroundColor Green
  Write-Host "Monitoring Excel workbooks and Open Folders..." -ForegroundColor Cyan
  Write-Host "Press Ctrl+C to stop."

  while ($listener.IsListening) {
    $contextAsync = $listener.BeginGetContext($null, $null)
    while (-not $contextAsync.IsCompleted) {
      Start-Sleep -Milliseconds 100
      if (-not $listener.IsListening) { break }
    }

    if ($contextAsync.IsCompleted) {
      $context = $listener.EndGetContext($contextAsync)
      $request = $context.Request
      $response = $context.Response

      $response.Headers.Add("Access-Control-Allow-Origin", "*")
      $response.Headers.Add("Access-Control-Allow-Methods", "GET, OPTIONS")
      $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

      if ($request.HttpMethod -eq "OPTIONS") {
        $response.StatusCode = 200
        $response.Close()
        continue
      }

      $path = $context.Request.Url.LocalPath
      if ($path -eq "/") { $path = "/index.html" }
      $localPath = Join-Path (Get-Location) $path

      if ($path -eq "/list") {
        $json = [MyClass]::GetList()
        $response.ContentType = "application/json; charset=utf-8"
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
      }
      elseif ($path.StartsWith("/activate-hwnd/")) {
        $hwnd = [int]$path.Substring(15)
        FocusWindow($hwnd)
      }
      elseif ($path.StartsWith("/activate-path/")) {
        $path = $path.Substring(15)
        OpenOrFocusParentFolder($path)
      }
      elseif (Test-Path $localPath) {
        $content = [System.IO.File]::ReadAllBytes($localPath)
        $response.ContentLength64 = $content.Length
        $response.OutputStream.Write($content, 0, $content.Length)
      }
      $response.Close()
    }
  }
}
catch {
  if ($_.Exception.Message -notmatch "thread exit|abort") {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
  }
}
finally {
  Write-Host "Stopping server..." -ForegroundColor Yellow
  $listener.Stop()
  $listener.Close()
}
