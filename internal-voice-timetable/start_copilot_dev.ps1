$ErrorActionPreference = 'Stop'
$port = 8768
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    throw "Port $port is already in use. Stop the old local server first (Ctrl+C in the terminal showing its Local timetable URL), then run this script again."
}

$root = Split-Path -Path $MyInvocation.MyCommand.Path -Parent
Set-Location -LiteralPath $root
$env:NASQ_PORT = [string]$port
$env:GITHUB_REDIRECT_URI = "http://127.0.0.1:$port/auth/copilot/callback"

# Client ID is public; it is not a secret.
$env:GITHUB_CLIENT_ID = 'Ov23liqapm1XHezZan9e'

# The secret is stored once, DPAPI-encrypted for this Windows user, outside the project folder.
$secretFile = Join-Path $env:LOCALAPPDATA 'Nasq\github_client_secret.xml'
$clip = (Get-Clipboard -Raw)
$clip = if ($clip) { $clip.Trim() } else { '' }
if ($clip -match '^[0-9a-f]{40}$') {
    New-Item -ItemType Directory -Force -Path (Split-Path $secretFile) | Out-Null
    ConvertTo-SecureString $clip -AsPlainText -Force | Export-Clixml -Path $secretFile
    Set-Clipboard -Value ' '
}
if (-not (Test-Path $secretFile)) {
    throw 'No saved secret. Copy the new client secret from GitHub, then run this script again.'
}
$secure = Import-Clixml -Path $secretFile
$env:GITHUB_CLIENT_SECRET = [Net.NetworkCredential]::new('', $secure).Password
$secure.Dispose()
Remove-Variable clip

try {
    & (Join-Path $root '.venv\Scripts\python.exe') (Join-Path $root 'server.py')
}
finally {
    Remove-Item Env:GITHUB_CLIENT_ID -ErrorAction SilentlyContinue
    Remove-Item Env:GITHUB_CLIENT_SECRET -ErrorAction SilentlyContinue
    Remove-Item Env:GITHUB_REDIRECT_URI -ErrorAction SilentlyContinue
    Remove-Item Env:NASQ_PORT -ErrorAction SilentlyContinue
}
