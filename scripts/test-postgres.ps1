
# Survey Platform - PostgreSQL persistence preflight
# Operates only on a randomly named, disposable Compose project.

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$composeFile = Join-Path $root 'infra/compose.preflight.yaml'
$project = 'survey-preflight-' + [guid]::NewGuid().ToString('N').Substring(0,12)

function Invoke-Docker {
    & docker.exe @args

    if ($LASTEXITCODE -ne 0) {
        throw "Docker command failed with exit code $LASTEXITCODE"
    }
}

$passed = $false

try {
    Write-Host "[1/6] Pulling PostgreSQL image..."
    Invoke-Docker compose -p $project -f $composeFile pull postgres

    Write-Host "[2/6] Starting isolated PostgreSQL..."
    Invoke-Docker compose -p $project -f $composeFile up -d --wait --wait-timeout 60

    Write-Host "[3/6] Creating and inserting test data..."

    $sql = @'
CREATE TABLE smoke (
    id integer PRIMARY KEY,
    label text NOT NULL
);
INSERT INTO smoke (id, label)
VALUES (1, 'before_restart');
'@

    & docker.exe compose -p $project -f $composeFile `
        exec -T postgres `
        psql -X -v ON_ERROR_STOP=1 `
        -U survey_preflight -d survey_preflight `
        -c $sql

    if ($LASTEXITCODE -ne 0) {
        throw 'SQL creation/insertion failed.'
    }

    Write-Host "[4/6] Restarting PostgreSQL..."
    Invoke-Docker compose -p $project -f $composeFile restart postgres

    Write-Host "[5/6] Waiting for database recovery..."

    $ready = $false

    for ($i = 0; $i -lt 30; $i++) {
        & docker.exe compose -p $project -f $composeFile `
            exec -T postgres `
            pg_isready -U survey_preflight -d survey_preflight 2>$null | Out-Null

        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            break
        }

        Start-Sleep -Seconds 2
    }

    if (-not $ready) {
        throw 'PostgreSQL recovery timed out.'
    }

    Write-Host "[6/6] Verifying data persistence..."

    $result = & docker.exe compose -p $project -f $composeFile `
        exec -T postgres `
        psql -X -At -v ON_ERROR_STOP=1 `
        -U survey_preflight -d survey_preflight `
        -c "SELECT label FROM smoke WHERE id = 1;"

    if ($LASTEXITCODE -ne 0) {
        throw 'PostgreSQL verification query failed.'
    }

    if (($result | Out-String).Trim() -ne 'before_restart') {
        throw "Persistence check failed. Unexpected result: $result"
    }

    $passed = $true
    Write-Host "POSTGRES_PREFLIGHT=PASS" -ForegroundColor Green
}
catch {
    Write-Host "POSTGRES_PREFLIGHT=FAIL" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    throw
}
finally {
    Write-Host "Cleaning up isolated test environment..."

    & docker.exe compose -p $project -f $composeFile `
        down --volumes --remove-orphans

    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Cleanup failed for project: $project"
    }
}

if (-not $passed) {
    throw 'PostgreSQL preflight did not pass.'
}
