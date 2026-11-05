# Copilot SDK 서버 인증 토큰을 Key Vault에 등록한다. 토큰은 화면·기록에 남기지 않는다.
param(
    [string]$ResourceGroup = "rg-cheongdo-hackathon-2026"
)
$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin;" + $env:Path

$vault = az keyvault list -g $ResourceGroup --query "[?starts_with(name, 'kv-samujang')].name | [0]" -o tsv
if (-not $vault) { throw "Key Vault를 찾지 못했습니다. 먼저 scripts/deploy.ps1 -InfraOnly 를 실행하세요." }

Write-Host "GitHub fine-grained 토큰(Copilot Requests 권한)을 붙여넣고 Enter를 누르세요. 입력 내용은 표시되지 않습니다."
$secure = Read-Host -AsSecureString "COPILOT_GITHUB_TOKEN"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if (-not ($plain.StartsWith("github_pat_") -or $plain.StartsWith("gho_") -or $plain.StartsWith("ghu_"))) {
        throw "지원하지 않는 토큰 형식입니다. github_pat_ 로 시작하는 fine-grained 토큰을 사용하세요."
    }
    $file = New-TemporaryFile
    try {
        Set-Content -Path $file -Value $plain -NoNewline -Encoding ascii
        az keyvault secret set --vault-name $vault -n copilot-github-token --file $file --encoding ascii -o none --only-show-errors
    } finally {
        Remove-Item $file -Force
    }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    Remove-Variable plain -ErrorAction SilentlyContinue
}
Write-Host "등록 완료: $vault / copilot-github-token"
