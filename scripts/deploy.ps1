# 인프라(Bicep) 배포 → 로컬 Docker 빌드·ACR 푸시 → 커밋 해시 태그 이미지로 Container App 갱신.
param(
    [string]$ResourceGroup = "rg-cheongdo-hackathon-2026",
    [switch]$InfraOnly
)
$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin;" + $env:Path
Set-Location (Split-Path $PSScriptRoot -Parent)

$ErrorActionPreference = "Continue"
$sha = (git rev-parse --verify -q HEAD)
if (-not $sha) { $sha = "dev" }
if (git status --porcelain) { $sha = "$sha-dirty" }
$ErrorActionPreference = "Stop"
$me = az ad signed-in-user show --query id -o tsv

function Invoke-Infra([string]$image, [string]$version) {
    $vault = az keyvault list -g $ResourceGroup --query "[?starts_with(name, 'kv-samujang')].name | [0]" -o tsv
    $ready = "false"
    if ($vault) {
        $exists = az keyvault secret list --vault-name $vault --query "[?name=='copilot-github-token'] | length(@)" -o tsv 2>$null
        if ($exists -eq "1") { $ready = "true" }
    }
    $out = az deployment group create -g $ResourceGroup -n "samujang-$(Get-Date -Format yyyyMMddHHmmss)" -f infra/main.bicep `
        -p image=$image appVersion=$version deployerPrincipalId=$me copilotSecretReady=$ready `
        --query properties.outputs -o json --only-show-errors | ConvertFrom-Json
    Write-Host "Copilot 토큰 연결: $ready"
    return $out
}

$current = az containerapp show -g $ResourceGroup -n ca-samujang --query "properties.template.containers[0].image" -o tsv 2>$null
if (-not $current) { $current = "mcr.microsoft.com/k8se/quickstart:latest" }

$currentVersion = az containerapp show -g $ResourceGroup -n ca-samujang --query "properties.template.containers[0].env[?name=='APP_VERSION'].value | [0]" -o tsv 2>$null
if (-not $currentVersion) { $currentVersion = "dev" }
$outputs = Invoke-Infra $current $currentVersion
if ($InfraOnly) { $outputs | ConvertTo-Json -Depth 5; exit 0 }

$acr = $outputs.acrName.value
$image = "$($outputs.acrLoginServer.value)/samujang:$sha"

function Wait-Docker {
    $ErrorActionPreference = "Continue"
    for ($i = 0; $i -lt 3; $i++) {
        for ($j = 0; $j -lt 24; $j++) {
            docker version --format "{{.Server.Version}}" 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { return }
            Start-Sleep -Seconds 5
        }
        Write-Host "Docker 엔진이 응답하지 않아 Docker Desktop을 다시 시작합니다."
        Get-Process "Docker Desktop", "com.docker.backend", "com.docker.build" -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 5
        Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    }
    throw "Docker 엔진을 사용할 수 없습니다."
}
Wait-Docker
# 이 구독은 ACR Tasks(원격 빌드)를 허용하지 않아 로컬 Docker로 빌드·푸시한다.
az acr login -n $acr --only-show-errors
# docker는 진행 로그를 stderr로 쓰므로 종료 코드로만 실패를 판단한다.
$ErrorActionPreference = "Continue"
docker build --platform linux/amd64 --build-arg APP_VERSION=$sha -t $image . 2>&1 | Select-Object -Last 5
if ($LASTEXITCODE -ne 0) { throw "docker build 실패" }
docker push $image 2>&1 | Select-Object -Last 2
if ($LASTEXITCODE -ne 0) { throw "docker push 실패" }
$ErrorActionPreference = "Stop"
$outputs = Invoke-Infra $image $sha
Write-Host "배포 완료: $($outputs.appUrl.value) (버전 $sha)"
