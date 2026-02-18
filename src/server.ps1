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

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindow(IntPtr hWnd);
}
"@

function Set-FocusWindow {
  param (
    $hwnd
  )  
  [WinAPI]::ShowWindow($hwnd, 9) | Out-Null  # SW_RESTORE
  [WinAPI]::keybd_event(0, 0, 0, 0) | Out-Null
  [WinAPI]::SetForegroundWindow($hwnd) | Out-Null
  [WinAPI]::ShowWindow($hwnd, 5) | Out-Null # SW_SHOW
}

function Set-OutputJson {
  param (
    $response, $result
  )
  $json = ConvertTo-Json $result -Compress
  $response.ContentType = "application/json; charset=utf-8"
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $response.ContentLength64 = $bytes.Length
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
}

# Excel 拡張子一覧
$excelExt = ".xlsx", ".xlsm", ".xlsb", ".xls"

class MyClass {

  static [object] GetExcels() {
    $WinAPI = "WinAPI" -as [type]
    # 1. Get Excel Data
    $excelData = @()
    try {
      $excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
      if ($excel) {
        foreach ($wb in $excel.Workbooks) {
          $excelData += @{
            name       = Split-Path -Path $wb.FullName -Leaf
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
            if ($WinAPI::IsWindowVisible($hWnd)) {
              $sb = New-Object System.Text.StringBuilder 256
              $WinAPI::GetWindowText($hWnd, $sb, $sb.Capacity)
              $title = $sb.ToString()
              if (-not [string]::IsNullOrWhiteSpace($title)) {
                $windows.Add($hWnd)
              }
            }
            return $true
          }
          $WinAPI::EnumDesktopWindows([IntPtr]::Zero, $callback, [IntPtr]::Zero)

          foreach ($wb in $excel.ProtectedViewWindows) {
            $hwnd = $null
            foreach ($hwnd1 in $windows) {
              $sb = New-Object System.Text.StringBuilder 256
              $WinAPI::GetWindowText($hwnd1, $sb, $sb.Capacity)
              $title = $sb.ToString()
              if ($title.StartsWith($wb.Caption.Replace(".xlsx", ""))) {
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
    return $excelData
  }

  static [object] GetFolderTree([string]$Path, [int]$Depth) {

    if ($Depth -gt 3) {
      return $null
    }

    $item = Get-Item $Path

    if (-not $item.PSIsContainer) {
      if ($item.Name) {
        return @{
          name     = $item.Name
          fullName = $item.FullName
          type     = "Excel"
        }
      }
      return $null
    }

    $children = @()

    $targetChildren = Get-ChildItem $item.FullName | Where-Object {
      $_.PSIsContainer -or $_.Extension -in $excelExt
    }

    foreach ($child in $targetChildren) {
      $node = [MyClass]::GetFolderTree($child.FullName, $Depth + 1)
      if ($null -ne $node) {
        $children += $node
      }
    }

    if ($children.Count -eq 0) {
      return $null
    }

    return @{
      name     = $item.Name
      fullName = $item.FullName
      type     = "Folder"
      children = $children
    }
  }

  static [object] GetFolders() {
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
              name = Split-Path -Path $path -Leaf
              path = Split-Path -Path $path -Parent
              hwnd = $window.Hwnd
              # children = [MyClass]::GetFolderTree($path, 0)
            }
          }
          catch {}
        }
      }
    }
    catch {
      Write-Host $_
    }
    return $folderData
  }

  static [int] StartProcessAndWaitForWindow([string]$Path) {
    $p = Start-Process $Path -PassThru
    $p.WaitForInputIdle() | Out-Null
    $p.Refresh()
    while ($p.MainWindowHandle -eq 0) {
      Start-Sleep -Milliseconds 100
      $p.Refresh()
    }
    return $p.MainWindowHandle
  }

  static [object] OpenOrFocus([int]$hwnd, [string]$targetPath) {
    $WinAPI = "WinAPI" -as [type]
    if ($hwnd -gt 0 -and $WinApi::IsWindow($hwnd)) {
      Set-FocusWindow $hwnd
      return @{
        success = $true
        hwnd    = $hwnd
      }
    }
    if (-not (Test-Path -LiteralPath $targetPath)) {
      return @{
        success = $false
      }
    }
    $openFolders = [MyClass]::GetFolders()
    foreach ($folder in $openFolders) {
      $folderPath = Join-Path -Path $folder.path -ChildPath $folder.name
      if ($folderPath -eq $targetPath) {
        Set-FocusWindow $folder.hWnd
        return @{
          success = $true
          hwnd    = $folder.hWnd
        }
      }
    }
    $excels = [MyClass]::GetExcels()
    foreach ($excel in $excels) {
      if ($excel.path -eq "") {
        continue
      }
      $excelPath = Join-Path -Path $excel.path -ChildPath $excel.name
      if ($excelPath -eq $targetPath) {
        Set-FocusWindow $excel.hWnd
        return @{
          success = $true
          hwnd    = $excel.hWnd
        }
      }
    }
    $ext = [System.IO.Path]::GetExtension($targetPath)
    if ($ext -ne "") {
      $hwnd = [MyClass]::StartProcessAndWaitForWindow($targetPath)
      return @{
        success = $true
        hwnd    = $hwnd
      }
    }
    Invoke-Item -LiteralPath $targetPath
    return @{
      success = $true
    }
  }
}

try {
  $listener.Start()
  Write-Host "Server started on http://localhost:$port/" -ForegroundColor Green
  Write-Host "Monitoring Excel workbooks and Open Folders..." -ForegroundColor Cyan
  Write-Host "Press Ctrl+C to stop."

  while ($listener.IsListening) {
    $task = $listener.GetContextAsync()
    while (-not $task.IsCompleted) {
      Start-Sleep -Milliseconds 100
      # Break Ctrl+C
      if (-not $listener.IsListening) { break }
    }
    if (-not $listener.IsListening) { break }

    $context = $task.Result
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

    $path = $request.Url.LocalPath

    switch ($path) {

      "/list" {
        $excelData = [MyClass]::GetExcels()
        $folderData = [MyClass]::GetFolders()
        $result = @{
          excels  = $excelData
          folders = $folderData
        }
        Set-OutputJson $response $result
      }

      "/activate" {
        $hwnd = 0
        [int]::TryParse($request.QueryString["hwnd"], [ref]$hwnd) | Out-Null
        $queryStringRaw = $request.RawUrl.Split("?")[1]
        Add-Type -AssemblyName System.Web
        $decodedParams = [System.Web.HttpUtility]::ParseQueryString($queryStringRaw, [System.Text.Encoding]::UTF8)
        $filepath = $decodedParams["path"]
        $result = [MyClass]::OpenOrFocus($hwnd, $filepath)
        Set-OutputJson $response $result
      }

      default {
        if ($path -eq "/") {
          $path = "/index.html"
        }
        $localPath = Join-Path (Get-Location) $path
        if (Test-Path -LiteralPath $localPath) {
          $content = [System.IO.File]::ReadAllBytes($localPath)
          $response.ContentLength64 = $content.Length
          $response.OutputStream.Write($content, 0, $content.Length)
        }
      }
    }
    $response.Close()
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
