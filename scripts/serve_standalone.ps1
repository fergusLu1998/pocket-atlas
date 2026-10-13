param([int]$Port=3000,[switch]$SkipBridge,[switch]$NoOpen)
$ErrorActionPreference='Stop'
if($Port -lt 1024 -or $Port -gt 65535){throw 'Port must be between 1024 and 65535.'}
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskWebRoot=Join-Path $taskRoot 'dist/local'
if(!(Test-Path -LiteralPath (Join-Path $taskWebRoot 'index.html'))){throw 'Standalone build is missing. Run npm run build:standalone first.'}
$taskUrl="http://127.0.0.1:$Port/"
$taskListener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,$Port)
$taskListener.Start()
try {
  Write-Host "Pocket Atlas: $taskUrl"
  Write-Host 'Keep this window open. Press Ctrl+C to stop.'
  if(!$NoOpen){
    if(!$SkipBridge -and $Port -eq 3000){
      $taskBridge=Join-Path $PSScriptRoot 'start_pocket_atlas.ps1'
      Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$taskBridge+'"'),'-SiteUrl',('"'+$taskUrl+'"')) -WindowStyle Hidden | Out-Null
    }else{Start-Process $taskUrl}
  }
  $taskMime=@{'.html'='text/html; charset=utf-8';'.js'='text/javascript; charset=utf-8';'.css'='text/css; charset=utf-8';'.wasm'='application/wasm';'.svg'='image/svg+xml';'.json'='application/json';'.txt'='text/plain; charset=utf-8';'.zip'='application/zip'}
  while($true){
    $taskClient=$taskListener.AcceptTcpClient()
    try {
      $taskStream=$taskClient.GetStream();$taskStream.ReadTimeout=3000;$taskStream.WriteTimeout=10000
      $taskReader=[System.IO.StreamReader]::new($taskStream,[System.Text.Encoding]::ASCII,$false,1024,$true)
      $taskRequest=$taskReader.ReadLine()
      if(!$taskRequest){continue}
      do{$taskHeader=$taskReader.ReadLine()}while($taskHeader)
      $taskFields=$taskRequest.Split(' ')
      $taskStatus='200 OK';$taskType='text/plain; charset=utf-8'
      if($taskFields.Length -lt 2 -or $taskFields[0] -notin @('GET','HEAD')){
        $taskStatus='405 Method Not Allowed';$taskBytes=[Text.Encoding]::UTF8.GetBytes('Method not allowed')
      }else{
        $taskPath=[Uri]::UnescapeDataString(($taskFields[1].Split('?')[0])).TrimStart('/')
        if(!$taskPath){$taskPath='index.html'}
        $taskFile=[IO.Path]::GetFullPath((Join-Path $taskWebRoot $taskPath))
        $taskAbsoluteRoot=[IO.Path]::GetFullPath($taskWebRoot)+[IO.Path]::DirectorySeparatorChar
        if(!$taskFile.StartsWith($taskAbsoluteRoot,[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $taskFile -PathType Leaf)){
          $taskStatus='404 Not Found';$taskBytes=[Text.Encoding]::UTF8.GetBytes('Not found')
        }else{
          $taskBytes=[IO.File]::ReadAllBytes($taskFile)
          $taskExtension=[IO.Path]::GetExtension($taskFile).ToLowerInvariant()
          if($taskMime.ContainsKey($taskExtension)){$taskType=$taskMime[$taskExtension]}else{$taskType='application/octet-stream'}
        }
      }
      $taskResponse="HTTP/1.1 $taskStatus`r`nContent-Type: $taskType`r`nContent-Length: $($taskBytes.Length)`r`nCache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
      $taskResponseBytes=[Text.Encoding]::ASCII.GetBytes($taskResponse)
      $taskStream.Write($taskResponseBytes,0,$taskResponseBytes.Length)
      if($taskFields[0] -ne 'HEAD'){$taskStream.Write($taskBytes,0,$taskBytes.Length)}
      $taskStream.Flush()
    }catch {Write-Verbose $_.Exception.Message}
    finally{$taskClient.Dispose()}
  }
}finally{$taskListener.Stop()}
