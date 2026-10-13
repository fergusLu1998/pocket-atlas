param([int]$Port=3000,[switch]$SkipBridge,[switch]$NoOpen)
$ErrorActionPreference='Stop'
$taskManifestPath=Join-Path $PSScriptRoot 'source-map.json'
$taskProjectRoot=$PSScriptRoot
if(Test-Path -LiteralPath $taskManifestPath){
  $taskManifest=Get-Content -LiteralPath $taskManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $taskProjectRoot=Join-Path $PSScriptRoot 'PocketAtlas'
  [IO.Directory]::CreateDirectory($taskProjectRoot) | Out-Null
  $taskAbsoluteRoot=[IO.Path]::GetFullPath($taskProjectRoot)+[IO.Path]::DirectorySeparatorChar
  $taskHasher=[Security.Cryptography.SHA256]::Create()
  try {
    foreach($taskEntry in $taskManifest.entries){
      if([IO.Path]::GetFileName($taskEntry.file) -ne $taskEntry.file){throw 'Invalid flat archive filename.'}
      $taskInput=Join-Path $PSScriptRoot $taskEntry.file
      $taskBytes=[IO.File]::ReadAllBytes($taskInput)
      $taskHash=[BitConverter]::ToString($taskHasher.ComputeHash($taskBytes)).Replace('-','').ToLowerInvariant()
      if($taskHash -ne $taskEntry.sha256){throw "Archive checksum failed: $($taskEntry.file)"}
      $taskDest=[IO.Path]::GetFullPath((Join-Path $taskProjectRoot $taskEntry.path))
      if(!$taskDest.StartsWith($taskAbsoluteRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe restore path.'}
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($taskDest)) | Out-Null
      # Preserve source edits; immutable packaged runtime files are refreshed when needed.
      $taskWrite=!(Test-Path -LiteralPath $taskDest)
      if(!$taskWrite -and $taskEntry.path.StartsWith('dist/local/')){
        $taskCurrentHash=[BitConverter]::ToString($taskHasher.ComputeHash([IO.File]::ReadAllBytes($taskDest))).Replace('-','').ToLowerInvariant()
        $taskWrite=$taskCurrentHash -ne $taskHash
      }
      if($taskWrite){[IO.File]::WriteAllBytes($taskDest,$taskBytes)}
    }
    $taskRuntime=[Convert]::FromBase64String([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'rdkit-runtime.txt')))
    $taskRuntimeHash=[BitConverter]::ToString($taskHasher.ComputeHash($taskRuntime)).Replace('-','').ToLowerInvariant()
    if($taskRuntimeHash -ne $taskManifest.rdkit_wasm_sha256){throw 'RDKit runtime checksum failed.'}
    foreach($taskWasm in @('public/rdkit/RDKit_minimal.wasm','dist/local/rdkit/RDKit_minimal.wasm')){
      $taskDest=Join-Path $taskProjectRoot $taskWasm
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($taskDest)) | Out-Null
      [IO.File]::WriteAllBytes($taskDest,$taskRuntime)
    }
  }finally{$taskHasher.Dispose()}
  # Generate the optional native adapter download locally; no nested ZIP is submitted.
  Add-Type -AssemblyName System.IO.Compression
  $taskZipPath=Join-Path $taskProjectRoot 'public/pocket-atlas-launcher.zip'
  $taskZipFile=[IO.File]::Open($taskZipPath,[IO.FileMode]::Create)
  $taskZip=[IO.Compression.ZipArchive]::new($taskZipFile,[IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach($taskName in @('Start Pocket Atlas.cmd','scripts/start_pocket_atlas.cmd','scripts/start_pocket_atlas.ps1','scripts/schrodinger_bridge.py')){
      $taskEntry=$taskZip.CreateEntry($taskName)
      $taskEntryStream=$taskEntry.Open()
      try {
        if($taskName -eq 'Start Pocket Atlas.cmd'){$taskBytes=[Text.Encoding]::ASCII.GetBytes("@echo off`r`ncall `"%~dp0scripts\start_pocket_atlas.cmd`" %*`r`nif errorlevel 1 pause`r`n")}
        else{$taskBytes=[IO.File]::ReadAllBytes((Join-Path $taskProjectRoot $taskName))}
        $taskEntryStream.Write($taskBytes,0,$taskBytes.Length)
      }finally{$taskEntryStream.Dispose()}
    }
  }finally{$taskZip.Dispose();$taskZipFile.Dispose()}
  [IO.File]::WriteAllBytes((Join-Path $taskProjectRoot 'dist/local/pocket-atlas-launcher.zip'),[IO.File]::ReadAllBytes($taskZipPath))
  Write-Host 'Packaged source and browser resources verified and restored. No npm installation is required.'
}
$taskServe=Join-Path $taskProjectRoot 'scripts/serve_standalone.ps1'
& $taskServe -Port $Port -SkipBridge:$SkipBridge -NoOpen:$NoOpen
