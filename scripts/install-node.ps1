# Installs Node.js 22 for the current user (no admin rights) into %USERPROFILE%\.breakshop\node.
$ErrorActionPreference = 'Stop'
$dest = Join-Path $env:USERPROFILE '.breakshop\node'
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$base = 'https://nodejs.org/dist/latest-v22.x'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('breakshop-node-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "Downloading Node.js 22 for win-$arch ..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content -split "`n"
  $line = $sums | Where-Object { $_ -match "node-v[0-9.]+-win-$arch\.zip$" } | Select-Object -First 1
  if (-not $line) { throw "No Node.js 22 build found for win-$arch" }
  $want, $file = ($line.Trim() -split '\s+')
  $zip = Join-Path $tmp $file
  Invoke-WebRequest -UseBasicParsing "$base/$file" -OutFile $zip
  $got = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
  if ($got -ne $want.ToLower()) { throw 'Download failed its checksum. Nothing was installed.' }
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  Move-Item -Path (Join-Path $tmp ($file -replace '\.zip$', '')) -Destination $dest
  Write-Host "Node.js installed in $dest"
} catch {
  Write-Host $_.Exception.Message
  exit 1
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
