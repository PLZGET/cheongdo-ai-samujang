# 인프라(Bicep) 배포 → ACR 원격 빌드 → 커밋 해시 태그 이미지로 Container App 갱신.
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
$tag = "samujang:$sha"
az acr build -r $acr -t $tag --build-arg APP_VERSION=$sha . --only-show-errors
$outputs = Invoke-Infra "$($outputs.acrLoginServer.value)/$tag" $sha
Write-Host "배포 완료: $($outputs.appUrl.value) (버전 $sha)"
