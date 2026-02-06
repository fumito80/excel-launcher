# excel-switcher.ps1

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class WinAPI {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

function Get-ExcelWindows {
    $list = @()

    $callback = {
        param($hwnd, $lparam)

        if ([WinAPI]::IsWindowVisible($hwnd)) {
            $sb = New-Object System.Text.StringBuilder 1024
            [WinAPI]::GetWindowText($hwnd, $sb, 1024) | Out-Null
            $title = $sb.ToString()

            if ($title -like "*Excel*") {
                $list += [PSCustomObject]@{
                    hwnd  = $hwnd
                    title = $title
                }
            }
        }
        return $true
    }

    $del = [WinAPI+EnumWindowsProc]$callback
    [WinAPI]::EnumWindows($del, [IntPtr]::Zero) | Out-Null

    return $list
}

function Send-Response($obj) {
    $json = $obj | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $length = [BitConverter]::GetBytes($bytes.Length)
    [Console]::OpenStandardOutput().Write($length, 0, 4)
    [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
}

while ($true) {
    $stdin = [Console]::OpenStandardInput()
    $lenBytes = New-Object byte[] 4
    $stdin.Read($lenBytes, 0, 4) | Out-Null
    $length = [BitConverter]::ToInt32($lenBytes, 0)

    if ($length -le 0) { continue }

    $msgBytes = New-Object byte[] $length
    $stdin.Read($msgBytes, 0, $length) | Out-Null
    $msg = [System.Text.Encoding]::UTF8.GetString($msgBytes)
    $data = $msg | ConvertFrom-Json

    switch ($data.action) {
        "list" {
            Send-Response @{ windows = Get-ExcelWindows }
        }
        "activate" {
            [WinAPI]::SetForegroundWindow([IntPtr]$data.hwnd) | Out-Null
            Send-Response @{ status = "ok" }
        }
    }
}
