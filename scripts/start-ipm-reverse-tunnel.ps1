param(
  [string]$VpsSshTarget = "root@147.182.214.129",
  [string]$RemoteBind = "127.0.0.1:9443",
  [string]$IpmTarget = "guaira.atende.net:443"
)

$ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
$forward = "$RemoteBind`:$IpmTarget"

Write-Host "Abrindo tunel reverso IPM: $VpsSshTarget -R $forward"
Write-Host "Use NFSE_IPM_CONNECT_HOST=127.0.0.1 e NFSE_IPM_CONNECT_PORT=9443 no VPS."

& $ssh -N `
  -o ExitOnForwardFailure=yes `
  -o ServerAliveInterval=30 `
  -R $forward `
  $VpsSshTarget
