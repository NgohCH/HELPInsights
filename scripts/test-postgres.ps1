# Real SQL persistence smoke-test against a disposable, isolated Compose project.
# WARNING: --volumes removes only this newly created test project's data.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$composeFile = Join-Path $root 'infra/compose.preflight.yaml'
$project = 'survey-preflight-' + [guid]::NewGuid().ToString('N').Substring(0,12)
function Docker { & docker @args; if ($LASTEXITCODE -ne 0) { throw "Docker command failed (exit $LASTEXITCODE): $($args -join ' ')" } }
try {
  Docker compose -p $project -f $composeFile pull
  Docker compose -p $project -f $composeFile up -d --wait
  $setup = 'CREATE TABLE smoke (id integer PRIMARY KEY, label text NOT NULL); INSERT INTO smoke VALUES (1, ''before_restart'');'
  $setup | docker compose -p $project -f $composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -U survey_preflight -d survey_preflight
  if ($LASTEXITCODE -ne 0) { throw 'SQL setup failed' }
  Docker compose -p $project -f $composeFile restart postgres
  $ready = $false
  for ($i=0; $i -lt 30; $i++) {
    & docker compose -p $project -f $composeFile exec -T postgres pg_isready -U survey_preflight -d survey_preflight *> $null
    if ($LASTEXITCODE -eq 0) { $ready=$true;break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw 'PostgreSQL did not recover after restart' }
  $result = (& docker compose -p $project -f $composeFile exec -T postgres psql -At -v ON_ERROR_STOP=1 -U survey_preflight -d survey_preflight -c 'SELECT label FROM smoke WHERE id=1;') | Out-String
  if ($LASTEXITCODE -ne 0 -or $result.Trim() -ne 'before_restart') { throw 'SQL persistence assertion failed' }
  Write-Output 'POSTGRES_RUNTIME_PASS: SQL transaction and restart persistence verified in disposable Docker volume.'
} finally {
  & docker compose -p $project -f $composeFile down --volumes --remove-orphans
}
