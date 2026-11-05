# 배포: 대상 확인 → Docker 엔진 확인 → 이미지 빌드 → ACR 푸시 → 앱 갱신.
# 각 단계는 실제 상태를 확인해 이미 끝난 단계를 건너뛰므로, 실패하면 같은 명령으로 실패한 단계부터 재개된다.
# 이 구독은 ACR Tasks(원격 빌드)를 허용하지 않아 로컬 Docker로 빌드·푸시한다.
param(
    [string]$ResourceGroup = "rg-cheongdo-hackathon-2026",
    [switch]$InfraOnly,
    [switch]$RestartDocker
)
$ErrorActionPreference = "Continue"
$env:Path = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin;" + $env:Path
Set-Location (Split-Path $PSScriptRoot -Parent)

function Stop-Deploy([string]$step, [string]$detail) {
    Write-Host ""
    Write-Host "배포 중단 — 막힌 단계: $step" -ForegroundColor Red
    if ($detail) { Write-Host $detail }
    exit 1
}

function Tail([string]$text, [int]$n = 20) {
    (($text -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -Last $n) -join "`n"
}

# 외부 명령을 시간 제한 안에서 실행하고 종료 코드·표준 출력·표준 오류를 돌려준다.
function Invoke-Timed([string]$file, [string[]]$argList, [int]$timeoutSec, [string]$stdin = $null) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $file
    $psi.Arguments = ($argList | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardInput = [bool]$stdin
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEndAsync()
    $err = $p.StandardError.ReadToEndAsync()
    if ($stdin) { $p.StandardInput.Write($stdin); $p.StandardInput.Close() }
    if (-not $p.WaitForExit($timeoutSec * 1000)) {
        try { $p.Kill() } catch { }
        return [pscustomobject]@{ Code = -1; Out = ""; Err = "시간 초과(${timeoutSec}초): $file $($psi.Arguments)" }
    }
    $p.WaitForExit()
    return [pscustomobject]@{ Code = $p.ExitCode; Out = $out.Result; Err = $err.Result }
}

function Test-DockerEngine {
    $r = Invoke-Timed "docker" @("version", "--format", "{{.Server.Version}}") 15
    if ($r.Code -eq 0 -and $r.Out.Trim()) { return $null }
    return (Tail ($r.Err + "`n" + $r.Out) 5)
}

function Wait-DockerEngine([int]$attempts) {
    $last = $null
    for ($i = 1; $i -le $attempts; $i++) {
        $last = Test-DockerEngine
        if (-not $last) { return $null }
        Start-Sleep -Seconds 5
    }
    return $last
}

function Invoke-Infra([string]$image, [string]$version) {
    $vault = az keyvault list -g $ResourceGroup --query "[?starts_with(name, 'kv-samujang')].name | [0]" -o tsv
    $ready = "false"
    if ($vault) {
        $exists = az keyvault secret list --vault-name $vault --query "[?name=='copilot-github-token'] | length(@)" -o tsv 2>$null
        if ($exists -eq "1") { $ready = "true" }
    }
    $me = az ad signed-in-user show --query id -o tsv
    $json = az deployment group create -g $ResourceGroup -n "samujang-$(Get-Date -Format yyyyMMddHHmmss)" -f infra/main.bicep `
        -p image=$image appVersion=$version deployerPrincipalId=$me copilotSecretReady=$ready `
        --query properties.outputs -o json --only-show-errors 2>&1
    if ($LASTEXITCODE -ne 0) { Stop-Deploy "Bicep 배포" (Tail ($json -join "`n") 15) }
    Write-Host "  Copilot 토큰 연결: $ready"
    return ($json -join "`n" | ConvertFrom-Json)
}

# 1. 대상 확인
$sha = (git rev-parse --verify -q HEAD)
if (-not $sha) { $sha = "dev" }
if (git status --porcelain --untracked-files=no) { $sha = "$sha-dirty" }
$currentImage = az containerapp show -g $ResourceGroup -n ca-samujang --query "properties.template.containers[0].image" -o tsv 2>$null
if (-not $currentImage) { $currentImage = "mcr.microsoft.com/k8se/quickstart:latest" }
Write-Host "[1/5] 대상 확인: 커밋 $sha, 현재 이미지 $currentImage"

if ($InfraOnly) {
    $currentVersion = az containerapp show -g $ResourceGroup -n ca-samujang --query "properties.template.containers[0].env[?name=='APP_VERSION'].value | [0]" -o tsv 2>$null
    if (-not $currentVersion) { $currentVersion = "dev" }
    Invoke-Infra $currentImage $currentVersion | ConvertTo-Json -Depth 5
    exit 0
}

$acr = az acr list -g $ResourceGroup --query "[?starts_with(name, 'acrsamujang')] | [0].{name:name, login:loginServer}" -o json | ConvertFrom-Json
if (-not $acr) { Stop-Deploy "대상 확인" "ACR을 찾지 못했습니다. 먼저 .\scripts\deploy.ps1 -InfraOnly 를 실행하세요." }
$image = "$($acr.login)/samujang:$sha"

if ($currentImage -eq $image) {
    Write-Host "[2-5/5] 이미 이 커밋 이미지로 배포되어 있어 건너뜁니다: $image"
    exit 0
}

$pushed = az acr repository show-tags -n $acr.name --repository samujang --query "contains(@, '$sha')" -o tsv 2>$null
if ($pushed -eq "true") {
    Write-Host "[2-4/5] ACR에 이미 $sha 이미지가 있어 빌드·푸시를 건너뜁니다."
} else {
    # 2. Docker 엔진 확인. 자동 재시작은 -RestartDocker를 준 경우 한 번만 한다.
    Write-Host "[2/5] Docker 엔진 확인"
    $dockerError = Wait-DockerEngine 6
    if ($dockerError) {
        if (-not $RestartDocker) {
            Stop-Deploy "Docker 엔진 확인 (docker version, 15초 제한 × 6회)" "$dockerError`n재시작하려면: .\scripts\deploy.ps1 -RestartDocker"
        }
        Write-Host "  엔진 오류: $dockerError"
        Write-Host "  Docker Desktop을 한 번 다시 시작합니다."
        Get-Process "Docker Desktop", "com.docker.backend", "com.docker.build" -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 5
        Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
        $dockerError = Wait-DockerEngine 24
        if ($dockerError) { Stop-Deploy "Docker 엔진 확인 (재시작 후 2분)" $dockerError }
    }

    # 3. 이미지 빌드. 로컬에 같은 태그가 있으면 건너뛴다.
    $exists = Invoke-Timed "docker" @("image", "inspect", "--format", "{{.Id}}", $image) 20
    if ($exists.Code -eq 0) {
        Write-Host "[3/5] 로컬 이미지가 이미 있어 빌드를 건너뜁니다."
    } else {
        Write-Host "[3/5] 이미지 빌드 (최대 15분)"
        $b = Invoke-Timed "docker" @("build", "--platform", "linux/amd64", "--build-arg", "APP_VERSION=$sha", "-t", $image, ".") 900
        if ($b.Code -ne 0) { Stop-Deploy "이미지 빌드 (docker build)" (Tail ($b.Err + "`n" + $b.Out) 25) }
    }

    # 4. ACR 로그인·푸시. az acr login 대신 액세스 토큰으로 docker login 해 실패 원인을 직접 보이게 한다.
    Write-Host "[4/5] ACR 로그인·푸시 (최대 15분)"
    $token = az acr login -n $acr.name --expose-token --query accessToken -o tsv --only-show-errors
    if (-not $token) { Stop-Deploy "ACR 토큰 발급 (az acr login --expose-token)" "토큰을 받지 못했습니다. az login 상태를 확인하세요." }
    $l = Invoke-Timed "docker" @("login", $acr.login, "-u", "00000000-0000-0000-0000-000000000000", "--password-stdin") 60 $token
    Remove-Variable token
    if ($l.Code -ne 0) { Stop-Deploy "ACR 로그인 (docker login)" (Tail ($l.Err + "`n" + $l.Out) 10) }
    $p = Invoke-Timed "docker" @("push", $image) 900
    if ($p.Code -ne 0) { Stop-Deploy "이미지 푸시 (docker push)" (Tail ($p.Err + "`n" + $p.Out) 15) }
}

# 5. 앱 갱신
Write-Host "[5/5] Container App 갱신 (Bicep)"
$outputs = Invoke-Infra $image $sha
Write-Host "배포 완료: $($outputs.appUrl.value) (버전 $sha)"
