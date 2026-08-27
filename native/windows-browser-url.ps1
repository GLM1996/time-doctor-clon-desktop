param(
  [Parameter(Mandatory = $true)][int]$ParentPid,
  [int]$IntervalMilliseconds = 1500
)

$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class LogYourTimeNativeWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$supportedBrowsers = @("chrome", "msedge", "brave", "opera", "vivaldi", "chromium")
$lastDomain = $null
$lastEmission = [DateTime]::MinValue

function Get-NormalizedDomain([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return $null }
  $candidate = $value.Trim()
  if ($candidate -notmatch '^(https?://)?([a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]{2,}([/:?#].*)?$') { return $null }
  if ($candidate -notmatch '^https?://') { $candidate = "https://$candidate" }

  try {
    $uri = [Uri]$candidate
    if ($uri.Scheme -notin @("http", "https")) { return $null }
    return $uri.DnsSafeHost.ToLowerInvariant() -replace '^www\.', ''
  } catch {
    return $null
  }
}

function Get-ActiveBrowserDomain {
  $handle = [LogYourTimeNativeWindow]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) { return $null }

  [uint32]$processId = 0
  [void][LogYourTimeNativeWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
  if ($processId -eq 0) { return $null }

  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $process -or $supportedBrowsers -notcontains $process.ProcessName.ToLowerInvariant()) {
    return $null
  }

  $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  if (-not $root) { return $null }

  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
  )
  $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  $candidates = @()

  foreach ($element in $elements) {
    try {
      $pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $domain = Get-NormalizedDomain $pattern.Current.Value
      if (-not $domain) { continue }
      $bounds = $element.Current.BoundingRectangle
      $candidates += [PSCustomObject]@{ Domain = $domain; Top = $bounds.Top; Width = $bounds.Width }
    } catch {}
  }

  return $candidates |
    Where-Object { $_.Width -gt 120 -and $_.Top -ge 0 } |
    Sort-Object Top, @{ Expression = "Width"; Descending = $true } |
    Select-Object -First 1 -ExpandProperty Domain
}

while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
  $domain = Get-ActiveBrowserDomain
  $now = [DateTime]::UtcNow
  if ($domain -and ($domain -ne $lastDomain -or ($now - $lastEmission).TotalSeconds -ge 30)) {
    @{ domain = $domain; observedAt = $now.ToString("o") } |
      ConvertTo-Json -Compress |
      Write-Output
    $lastDomain = $domain
    $lastEmission = $now
  } elseif (-not $domain) {
    $lastDomain = $null
  }
  Start-Sleep -Milliseconds ([Math]::Max(750, $IntervalMilliseconds))
}
