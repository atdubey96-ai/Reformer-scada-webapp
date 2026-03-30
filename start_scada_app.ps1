param(
  [int]$Port = 5500
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Join-Path $ScriptDir "webapp"
$ExcelFile = Join-Path $AppDir "Data_website2.xlsm"
$LogFile = Join-Path $env:TEMP "scada-webapp.log"
$HelperPort = 8766
$HelperLogFile = Join-Path $env:TEMP "scada-excel-helper.log"
$ServerProcess = $null
$HelperProcess = $null

function Test-PortListening {
  param([int]$LocalPort)

  $client = $null
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect("127.0.0.1", $LocalPort, $null, $null)
    $connected = $async.AsyncWaitHandle.WaitOne(350)
    if (-not $connected) { return $false }
    $client.EndConnect($async) | Out-Null
    return $true
  } catch {
    return $false
  } finally {
    if ($client) { $client.Dispose() }
  }
}

function Open-ExcelFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    Write-Warning "Excel workbook not found: $Path"
    return
  }

  Start-Process -FilePath $Path | Out-Null
}

function Get-PythonLaunchSpec {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    return @{
      FilePath = $py.Source
      ArgumentList = @("-3", "-m", "http.server", "$Port")
    }
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return @{
      FilePath = $python.Source
      ArgumentList = @("-m", "http.server", "$Port")
    }
  }

  $python3 = Get-Command python3 -ErrorAction SilentlyContinue
  if ($python3) {
    return @{
      FilePath = $python3.Source
      ArgumentList = @("-m", "http.server", "$Port")
    }
  }

  return $null
}

function Get-NodeLaunchSpec {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    return @{
      FilePath = $node.Source
      ArgumentList = @((Join-Path $ScriptDir "excel-launch-helper.js"))
    }
  }

  return $null
}

if (-not (Test-Path -LiteralPath $AppDir)) {
  Write-Host "Web app folder not found: $AppDir"
  Read-Host "Press Enter to close"
  exit 1
}

try {
  if (-not (Test-PortListening -LocalPort $HelperPort)) {
    $nodeSpec = Get-NodeLaunchSpec
    if ($nodeSpec) {
      Write-Host "Starting Excel helper on http://127.0.0.1:$HelperPort ..."
      $originalHelperPort = [System.Environment]::GetEnvironmentVariable("SCADA_HELPER_PORT", "Process")
      $originalExcelPath = [System.Environment]::GetEnvironmentVariable("SCADA_EXCEL_FILE", "Process")
      [System.Environment]::SetEnvironmentVariable("SCADA_HELPER_PORT", "$HelperPort", "Process")
      [System.Environment]::SetEnvironmentVariable("SCADA_EXCEL_FILE", $ExcelFile, "Process")
      try {
        $HelperProcess = Start-Process -FilePath $nodeSpec.FilePath `
          -ArgumentList $nodeSpec.ArgumentList `
          -WorkingDirectory $ScriptDir `
          -RedirectStandardOutput $HelperLogFile `
          -RedirectStandardError $HelperLogFile `
          -PassThru `
          -WindowStyle Hidden
      }
      finally {
        [System.Environment]::SetEnvironmentVariable("SCADA_HELPER_PORT", $originalHelperPort, "Process")
        [System.Environment]::SetEnvironmentVariable("SCADA_EXCEL_FILE", $originalExcelPath, "Process")
      }
      Start-Sleep -Seconds 1
    } else {
      Write-Warning "Node.js was not found. Update data button will not open Excel until the helper is started on this PC."
    }
  } else {
    Write-Host "Excel helper already running on port $HelperPort."
  }

  if (Test-PortListening -LocalPort $Port) {
    Write-Host "Server already running on port $Port."
    Start-Process -FilePath "http://localhost:$Port" | Out-Null
    Open-ExcelFile -Path $ExcelFile
    Read-Host "Press Enter to close"
    exit 0
  }

  $pythonSpec = Get-PythonLaunchSpec
  if (-not $pythonSpec) {
    throw "Python was not found. Install Python or update the launcher."
  }

  Write-Host "Starting SCADA web app on http://localhost:$Port ..."
  $ServerProcess = Start-Process -FilePath $pythonSpec.FilePath `
    -ArgumentList $pythonSpec.ArgumentList `
    -WorkingDirectory $AppDir `
    -RedirectStandardOutput $LogFile `
    -RedirectStandardError $LogFile `
    -PassThru `
    -WindowStyle Hidden

  Start-Sleep -Seconds 1
  Start-Process -FilePath "http://localhost:$Port" | Out-Null
  Open-ExcelFile -Path $ExcelFile

  Write-Host "Server PID: $($ServerProcess.Id)"
  Write-Host "Log file: $LogFile"
  Write-Host "Excel helper log: $HelperLogFile"
  Write-Host "Excel file: $ExcelFile"
  Write-Host ""
  Read-Host "Press Enter to stop server and close"
}
finally {
  if ($ServerProcess -and -not $ServerProcess.HasExited) {
    Stop-Process -Id $ServerProcess.Id -Force -ErrorAction SilentlyContinue
  }
  if ($HelperProcess -and -not $HelperProcess.HasExited) {
    Stop-Process -Id $HelperProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
