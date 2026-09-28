$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $nodeDirectory = Join-Path $env:ProgramFiles 'nodejs'
  if (Test-Path (Join-Path $nodeDirectory 'node.exe')) {
    $env:Path = "$nodeDirectory;$env:Path"
  }
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
  throw 'Node.js 22 or later and npm are required. Install Node.js, reopen the terminal, and try again.'
}

$databaseUrl = [Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process')
if (-not $databaseUrl) {
  $envFile = Join-Path $repoRoot '.env'
  if (Test-Path $envFile) {
    $databaseSetting = Get-Content $envFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
    if ($databaseSetting -match '^\s*DATABASE_URL\s*=\s*"?([^"]+)"?\s*$') {
      $databaseUrl = $Matches[1]
    }
  }
}

$databaseUri = $null
if (-not $databaseUrl -or -not [Uri]::TryCreate($databaseUrl, [UriKind]::Absolute, [ref]$databaseUri)) {
  throw 'Set a valid local DATABASE_URL in .env before starting the project.'
}
if ($databaseUri.Scheme -notin @('postgres', 'postgresql') -or $databaseUri.Host -notin @('localhost', '127.0.0.1', '::1')) {
  throw 'The local start command only starts and migrates a PostgreSQL database on this computer.'
}

$databaseReady = $false
$localDataDirectory = Join-Path $env:LOCALAPPDATA 'BadmintonPgData'
if (Test-Path (Join-Path $localDataDirectory 'PG_VERSION')) {
  $postgresRoot = Join-Path $env:ProgramFiles 'PostgreSQL'
  $postgresTools = Get-ChildItem $postgresRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'bin' } |
    Where-Object { (Test-Path (Join-Path $_ 'pg_ctl.exe')) -and (Test-Path (Join-Path $_ 'pg_isready.exe')) } |
    Select-Object -First 1

  if (-not $postgresTools) {
    throw "PostgreSQL tools were not found for the existing local database at $localDataDirectory."
  }

  $pgIsReady = Join-Path $postgresTools 'pg_isready.exe'
  & $pgIsReady -h $databaseUri.Host -p $databaseUri.Port | Out-Null
  $databaseReady = $LASTEXITCODE -eq 0

  if (-not $databaseReady) {
    $pgCtl = Join-Path $postgresTools 'pg_ctl.exe'
    $serverLog = Join-Path $localDataDirectory 'server.log'
    & $pgCtl -D $localDataDirectory -o "-p $($databaseUri.Port) -h 127.0.0.1" -l $serverLog start
    if ($LASTEXITCODE -ne 0) {
      throw 'Could not start the local PostgreSQL database. Check its server log under your local application data folder.'
    }

    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      & $pgIsReady -h $databaseUri.Host -p $databaseUri.Port | Out-Null
      if ($LASTEXITCODE -eq 0) {
        $databaseReady = $true
        break
      }
      Start-Sleep -Seconds 1
    }
  }
} else {
  $docker = Get-Command docker.exe -ErrorAction SilentlyContinue
  if (-not $docker) {
    throw 'No local PostgreSQL database was found. Install Docker Desktop or initialize PostgreSQL before starting.'
  }

  & $docker.Source compose up -d --wait postgres
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not start the local PostgreSQL Docker container. Confirm that Docker Desktop is running.'
  }

  $databaseReady = $true
}

if (-not $databaseReady) {
  throw 'The local PostgreSQL database did not become ready in time.'
}

Write-Host 'Preparing the local database and Prisma client...'
foreach ($scriptName in @('db:generate', 'db:migrate:deploy', 'db:seed')) {
  & $npm.Source run $scriptName
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: npm run $scriptName"
  }
}

Write-Host 'Starting the API and web app. Press Ctrl+C to stop.'
& $npm.Source run dev
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
