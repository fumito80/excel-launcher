# excel-switcher.ps1

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class WinAPI2 {
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumDelegate lpEnumCallbackFunction, IntPtr lParam);
  public delegate bool EnumDelegate(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder strText, int maxCount);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@

function SetForegroundWindow {
  SetForegroundWindow Application.ActiveWindow.Hwnd
}

function Get-List($response) {
  # 1. Get Excel Data
  $excelData = @()
  try {
    $excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
    if ($excel) {
      foreach ($wb in $excel.Workbooks) {
        $excelData += @{
          name       = $wb.Name
          path       = $wb.FullName
          isSaved    = $wb.Saved
          sheetCount = $wb.Sheets.Count
          hwnd       = $wb.Windows(1).Hwnd
        }
      }
      if ($excel.ProtectedViewWindows.Count -gt 0) {
        $windows = New-Object System.Collections.Generic.List[IntPtr]
        $enumCallback = [Win32.Win32Utils+EnumDelegate] {
          param($hWnd, $lParam)
          $windows.Add($hWnd)
          return $true
        }
        [Win32.Win32Utils]::EnumDesktopWindows([IntPtr]::Zero, $enumCallback, [IntPtr]::Zero)
        Write-Host "AAA"

        foreach ($wb in $excel.ProtectedViewWindows) {
          $hwnd = null
          foreach ($hwnd1 in $windows) {
            $sb = New-Object System.Text.StringBuilder 256
            [Win32.Win32Utils]::GetWindowText($hwnd1, $sb, $sb.Capacity)
            $title = $sb.ToString()
            # タイトルが一致するハンドルを特定（部分一致が安全）
            if ($title.StartsWith($wb.Caption.Replace(".xlsx", ""))) {
              Write-Host "Found HWND: $hwnd1 | Title: $title"
              # $hwnd を使ってやりたい処理をここに書く
              $hwnd = $hwnd1
              break
            }
          }
          # Write-Host $process.MainWindowHandle
          $excelData += @{
            name       = $wb.SourceName
            path       = $wb.SourcePath
            isSaved    = $false
            sheetCount = -1
            hwnd       = $hwnd
          }
        }
      }
    }
  }
  catch {}

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
          }
        }
        catch {}
      }
    }
  }
  catch {}

  $result = @{
    excel   = $excelData
    folders = $folderData
  }

  $json = $result | ConvertTo-Json -Compress
  [System.Text.Encoding]::UTF8.GetBytes($json)
}

# Excel & Folder Monitoring Server (PowerShell)
$port = 8080
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

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
        $buffer = Get-List($response)
        $response.ContentType = "application/json; charset=utf-8"
        $response.ContentLength64 = $buffer.Length
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
      }
      elseif ($path -eq "/activate") {
        [WinAPI2]::SetForegroundWindow([IntPtr]$data.hwnd) | Out-Null
        Send-Response @{ status = "ok" }
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
