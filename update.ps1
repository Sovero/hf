# HueForge Web update helper — used by install.bat.
#
# Commands:
#   update.ps1 check          Print the newest release tag (e.g. "v0.2.1") when it
#                             is newer than the local version (read from $env:HF_LOCAL),
#                             "NEED_TOKEN" when the repository requires authentication,
#                             or nothing when already up to date / unreachable.
#   update.ps1 save-token     Prompt (masked) for a GitHub token and store it in
#                             %APPDATA%\HueForgeWeb\github_token.txt.
#   update.ps1 download <tag> Download and extract that release, then print the
#                             path of the extracted source tree.
#   update.ps1 download-deploy <tag>
#                             Download the deploy package (hueforge-web-deploy-
#                             <tag>.zip asset) and unpack it over this folder —
#                             the one-command updater for deploy.bat users.
#                             The folder's previous state is backed up to
#                             %APPDATA%\HueForgeWeb\backup-deploy first.
#                             dist\ is mirrored (/MIR): stale build bundles from
#                             the old version are removed, not kept.
#   update.ps1 rollback       Restore the previous state from that backup
#                             (the pre-update version before the last
#                             download-deploy). Restores exactly: files added
#                             since the update are removed.
#
# Auth is resolved in order: HF_GITHUB_TOKEN environment variable, the stored
# token file, then anonymous (works for public repositories).
# Token scope needed for a private repository: fine-grained PAT with
# Contents: Read and Metadata: Read on the repository.
#
# The local version is read from $env:HF_LOCAL (install.bat), then from the
# version.txt marker shipped in deploy packages, else treated as 0.0.0.

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('check', 'save-token', 'download', 'download-deploy', 'rollback')]
    [string]$Command,

    [Parameter(Position = 1)]
    [string]$Tag
)

$ErrorActionPreference = 'Stop'
$Repo = 'Sovero/hf'
$ApiBase = "https://api.github.com/repos/$Repo"
$TokenDir = Join-Path $env:APPDATA 'HueForgeWeb'
$TokenFile = Join-Path $TokenDir 'github_token.txt'
$BackupDir = Join-Path $TokenDir 'backup-deploy'

function Save-Backup {
    # One backup slot per machine: the state right before the last update.
    if (Test-Path $BackupDir) { Remove-Item $BackupDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    robocopy $PSScriptRoot $BackupDir /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'backup failed' }
}

function Get-AuthHeaders {
    $token = $null
    if ($env:HF_GITHUB_TOKEN) { $token = $env:HF_GITHUB_TOKEN.Trim() }
    elseif (Test-Path $TokenFile) { $token = ((Get-Content $TokenFile -Raw).Trim()) }
    if ($token) {
        return @{ 'User-Agent' = 'HueForge-Installer'; 'Authorization' = "Bearer $token" }
    }
    return @{ 'User-Agent' = 'HueForge-Installer' }
}

function Test-NewerVersion([string]$Local, [string]$RemoteTag) {
    # Plain x.y.z comparison; prerelease suffixes are ignored.
    $lv = $Local -split '\.'
    $tv = ($RemoteTag -replace '^v', '') -split '\.'
    $lp = '{0:D6}{1:D6}{2:D6}' -f [int]$lv[0], [int]$lv[1], [int]$lv[2]
    $tp = '{0:D6}{1:D6}{2:D6}' -f [int]$tv[0], [int]$tv[1], [int]$tv[2]
    return $tp -gt $lp
}

function Invoke-Api([string]$Path, [hashtable]$Headers) {
    return Invoke-RestMethod -Uri "$ApiBase$Path" -Headers $Headers -TimeoutSec 20
}

switch ($Command) {
    'check' {
        $headers = Get-AuthHeaders
        try {
            $latest = Invoke-Api '/releases/latest' $headers
        } catch {
            $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            if ($status -in 401, 403, 404 -and -not (Test-Path $TokenFile) -and -not $env:HF_GITHUB_TOKEN) {
                Write-Output 'NEED_TOKEN'
            }
            # Any other failure (offline, etc.): stay silent, install.bat proceeds locally.
            exit 0
        }
        $marker = Join-Path $PSScriptRoot 'version.txt'
        $local = if ($env:HF_LOCAL) { $env:HF_LOCAL }
        elseif (Test-Path $marker) { (Get-Content $marker -Raw).Trim() }
        else { '0.0.0' }
        if (Test-NewerVersion $local $latest.tag_name) { Write-Output $latest.tag_name }
        exit 0
    }

    'save-token' {
        $secure = Read-Host -Prompt 'GitHub personal access token (fine-grained: Contents + Metadata read on Sovero/hf)' -AsSecureString
        $plain = [System.Net.NetworkCredential]::new('', $secure).Password
        if (-not $plain) { [Console]::Error.WriteLine('ERR: empty token'); exit 1 }
        New-Item -ItemType Directory -Force -Path $TokenDir | Out-Null
        Set-Content -Path $TokenFile -Value $plain.Trim() -NoNewline
        Write-Output 'OK'
        exit 0
    }

    'download' {
        if (-not $Tag) { Write-Output 'ERR: no tag given'; exit 1 }
        $headers = Get-AuthHeaders
        try {
            # The API zipball endpoint works for public and private repos alike
            # (Contents: Read is enough) and PowerShell follows its redirect
            # cleanly - unlike the releases/download asset URL, which 404s for
            # private repos. The attached hueforge-web-*.zip asset still exists
            # on the release page for humans.
            $zip = Join-Path $env:TEMP 'hf_update.zip'
            if (Test-Path $zip) { Remove-Item $zip -Force }
            Invoke-WebRequest -Uri "$ApiBase/zipball/$Tag" -Headers $headers -OutFile $zip -UseBasicParsing
            $dest = Join-Path $env:TEMP 'hf_update'
            if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
            Expand-Archive -Path $zip -DestinationPath $dest -Force
            # GitHub zipballs wrap the tree in one "<owner>-<repo>-<sha>" folder;
            # resolve to that folder when present so robocopy copies the files.
            $top = Get-ChildItem -Path $dest -Directory | Select-Object -First 1
            if ($top -and (Test-Path (Join-Path $top.FullName 'package.json'))) { Write-Output $top.FullName }
            else { Write-Output $dest }
        } catch {
            # Errors go to stderr so install.bat's stdout capture stays empty
            # (it then reports the failure with its own message).
            [Console]::Error.WriteLine('ERR: ' + $_.Exception.Message)
            exit 1
        }
        exit 0
    }

    'download-deploy' {
        if (-not $Tag) { Write-Output 'ERR: no tag given'; exit 1 }
        $headers = Get-AuthHeaders
        try {
            # Resolve the deploy asset of the requested release. The API asset
            # endpoint redirects to a signed CDN URL (no auth needed there), so
            # the same pattern as the source zipball works for private repos.
            $release = Invoke-Api "/releases/tags/$Tag" $headers
            $asset = $release.assets | Where-Object { $_.name -like 'hueforge-web-deploy-*.zip' } | Select-Object -First 1
            if (-not $asset) {
                throw "no deploy asset in release $Tag (found: $((@($release.assets) | ForEach-Object { $_.name }) -join ', '))"
            }
            $zip = Join-Path $env:TEMP 'hf_deploy_update.zip'
            if (Test-Path $zip) { Remove-Item $zip -Force }
            Invoke-WebRequest -Uri "$ApiBase/releases/assets/$($asset.id)" `
                -Headers ($headers + @{ 'Accept' = 'application/octet-stream' }) `
                -OutFile $zip -UseBasicParsing
            $dest = Join-Path $env:TEMP 'hf_deploy_update'
            if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
            Expand-Archive -Path $zip -DestinationPath $dest -Force
            # Back up the current folder (single slot - the pre-update state)
            # before unpacking over it, so rollback can restore it.
            Save-Backup
            # Mirror dist\ so stale bundles of the old build are removed instead
            # of piling up (index.html always points at the new hashed files).
            robocopy (Join-Path $dest 'dist') (Join-Path $PSScriptRoot 'dist') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw 'dist mirror failed' }
            # Unpack the rest over this folder. The deploy zip is a flat tree
            # (dist/, server.mjs, *.bat, DEPLOY.md, version.txt); update.ps1
            # itself is already loaded by PowerShell and can be replaced safely.
            robocopy $dest $PSScriptRoot /E /XD dist /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw 'robocopy failed' }
            Remove-Item $zip -Force -ErrorAction SilentlyContinue
            Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
            Write-Output "Updated to $Tag. Restart deploy.bat. Previous version saved - run 'update.ps1 rollback' to restore it."
        } catch {
            [Console]::Error.WriteLine('ERR: ' + $_.Exception.Message)
            exit 1
        }
        exit 0
    }

    'rollback' {
        if (-not (Test-Path $BackupDir)) {
            [Console]::Error.WriteLine('ERR: no backup found - run download-deploy first')
            exit 1
        }
        try {
            # Mirror from the backup: files the update added (e.g. new dist
            # bundles) are removed, so the folder is exactly the pre-update
            # state again.
            robocopy $BackupDir $PSScriptRoot /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw 'restore failed' }
            Write-Output 'Restored the previous version. Restart deploy.bat.'
        } catch {
            [Console]::Error.WriteLine('ERR: ' + $_.Exception.Message)
            exit 1
        }
        exit 0
    }
}