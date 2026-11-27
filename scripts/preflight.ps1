# Read-only environment preflight for Codex Desktop / Windows PowerShell.
# No installations, image pulls, database writes or elevated operations.
$ErrorActionPreference = 'Stop'
$checks = @()
function Check($name, $command, $arguments) {
  $cmd = Get-Command $command -ErrorAction SilentlyContinue
  if (-not $cmd) { $script:checks += [pscustomobject]@{Check=$name;Status='BLOCKED';Detail="$command missing"}; return }
  try {
    $output = & $command @arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($output | Out-String) }
    $detail = (($output | Out-String).Trim() -split "`n" | Select-Object -First 1)
    if ($name -eq 'Git remote') { $detail = 'origin remote present (URL withheld to avoid leaking credentials)' }
    $script:checks += [pscustomobject]@{Check=$name;Status='PASS';Detail=$detail}
  } catch { $script:checks += [pscustomobject]@{Check=$name;Status='BLOCKED';Detail=($_.Exception.Message -replace '\s+',' ').Substring(0,[Math]::Min(180,($_.Exception.Message -replace '\s+',' ').Length))} }
}
Check 'Git' 'git' @('--version')
Check 'Git repository' 'git' @('rev-parse','--show-toplevel')
Check 'Git SHA' 'git' @('rev-parse','HEAD')
Check 'Git branch' 'git' @('symbolic-ref','--short','HEAD')
Check 'Repository status' 'git' @('status','--short')
Check 'Git remote' 'git' @('remote','get-url','origin')
Check 'GitHub CLI' 'gh' @('--version')
Check 'GitHub authentication' 'gh' @('auth','status')
Check 'GitHub repository permission' 'gh' @('repo','view','--json','viewerPermission','--jq','.viewerPermission')
Check 'Docker CLI' 'docker' @('--version')
Check 'Docker Engine' 'docker' @('info','--format','{{.ServerVersion}}')
Check 'Docker Compose' 'docker' @('compose','version')
Check 'Node runtime' 'node' @('--version')
Check 'Corepack' 'corepack' @('--version')
# Validate that repo permission is write-capable, not merely readable.
$perm = $checks | Where-Object { $_.Check -eq 'GitHub repository permission' } | Select-Object -First 1
if ($perm -and $perm.Status -eq 'PASS' -and $perm.Detail.Trim() -notin @('WRITE','MAINTAIN','ADMIN')) { $perm.Status='BLOCKED'; $perm.Detail='No confirmed write permission' }
$checks | Format-Table -AutoSize | Out-String | Write-Output
if ($checks.Status -contains 'BLOCKED') { Write-Error 'PREFLIGHT_BLOCKED: Do not begin unattended coding. Resolve items above, rerun and record evidence.'; exit 2 }
Write-Output 'PREFLIGHT_PASS (environment presence only; no Docker Hub pull, SQL, application or permissions tests performed)'
