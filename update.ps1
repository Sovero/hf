# HueForge Web — помощник обновления; вызывается из install.bat.
#
# Команды:
#   update.ps1 check          Печатает тег самого нового релиза (например "v0.2.1"),
#                             если он новее локальной версии (берётся из $env:HF_LOCAL),
#                             "NEED_TOKEN", если репозиторий требует авторизации,
#                             или ничего, если версия актуальна / сеть недоступна.
#                             ВАЖНО: вывод этой команды разбирает install.bat —
#                             служебные строки (NEED_TOKEN, OK, ERR:, теги, пути)
#                             остаются латиницей, русские сообщения пишутся
#                             только в stderr или в командах для человека.
#   update.ps1 save-token     Запрашивает (скрытно) токен GitHub и сохраняет его в
#                             %APPDATA%\HueForgeWeb\github_token.txt.
#   update.ps1 download <tag> Скачивает и распаковывает релиз, затем печатает путь
#                             к распакованному дереву исходников.
#   update.ps1 download-deploy <tag>
#                             Скачивает deploy-пакет (ассет hueforge-web-deploy-
#                             <tag>.zip) и распаковывает его поверх этой папки —
#                             обновление одной командой для пользователей deploy.bat.
#                             Прежнее состояние папки сохраняется в
#                             %APPDATA%\HueForgeWeb\backup-deploy.
#                             dist\ синхронизируется зеркалом (/MIR): устаревшие
#                             сборки старой версии удаляются, а не копятся.
#   update.ps1 rollback       Возвращает прежнее состояние из этого бэкапа
#                             (версию до последнего download-deploy). Восстановление
#                             точное: файлы, добавленные обновлением, удаляются.
#   update.ps1 say <ключ> [аргументы]
#                             Печатает русское сообщение для консоли по ключу
#                             (таблица $Messages ниже). Все .bat-скрипты остаются
#                             ASCII: cmd.exe разбирает командный файл в текущей
#                             кодировке и срывается на многобайтных символах,
#                             поэтому текст для человека печатает PowerShell.
#
# Авторизация выбирается по порядку: переменная окружения HF_GITHUB_TOKEN, затем
# сохранённый файл токена, затем анонимный доступ (работает для публичных
# репозиториев).
# Права токена для приватного репозитория: fine-grained PAT с Contents: Read и
# Metadata: Read на репозиторий.
#
# Локальная версия берётся из $env:HF_LOCAL (его задаёт install.bat), иначе из
# маркера version.txt в deploy-пакете, иначе считается 0.0.0.

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('check', 'save-token', 'download', 'download-deploy', 'rollback', 'say')]
    [string]$Command,

    [Parameter(Position = 1)]
    [string]$Tag,

    [Parameter(Position = 2, ValueFromRemainingArguments = $true)]
    [string[]]$MessageArgs
)

$ErrorActionPreference = 'Stop'

# Русские сообщения требуют UTF-8: если скрипт запускают напрямую из консоли в
# другой кодировке, переключаем её сами. Служебные строки протокола — латиница,
# поэтому на разбор вывода в install.bat это не влияет.
try {
    chcp 65001 > $null
    # Доверяем UTF-8 только если кодировка действительно сменилась: писать UTF-8
    # в консоль cp866 — значит получить мусор вместо русского текста.
    if ((chcp) -match '65001') { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 }
} catch { }

$Repo = 'Sovero/hf'
$ApiBase = "https://api.github.com/repos/$Repo"
$TokenDir = Join-Path $env:APPDATA 'HueForgeWeb'
$TokenFile = Join-Path $TokenDir 'github_token.txt'
$BackupDir = Join-Path $TokenDir 'backup-deploy'

# ---- Сообщения для консоли --------------------------------------------------
# Ключ → текст. '{0}', '{1}' — подстановки (аргументы команды say). Ключи
# install.* — install.bat, start.* — start.bat, deploy.* — deploy.bat и
# deploy-slicer.bat. Держим текст здесь, а не в .bat: см. команду say выше.
$Messages = @{
    'install.banner'           = "============================================`n  HueForge Web — установка и обновление`n============================================"
    'install.folder'           = '[1/6] Папка проекта: {0}'
    'install.node-checking'    = '[2/6] Проверяю Node.js...'
    'install.node-missing'     = "`n  ОШИБКА: на этом ПК не установлен Node.js.`n  Установите версию LTS с https://nodejs.org`n  и запустите установщик снова.`n"
    'install.node-found'       = '  Node.js найден: {0}'
    'install.updates-checking' = '[3/6] Проверяю обновления на GitHub...'
    'install.token-needed'     = "  Для проверки обновлений нужен одноразовый токен GitHub.`n  Токен хранится только на этом ПК, в $TokenDir.`n  Создайте его: https://github.com/settings/personal-access-tokens`n  fine-grained: только Sovero/hf, права Contents: Read + Metadata: Read."
    'install.token-ask'        = '  Ввести токен GitHub сейчас?'
    'install.token-saved'      = '  Токен сохранён. Проверяю снова...'
    'install.token-declined'   = '  Токен не введён — продолжаю с текущими файлами.'
    'install.token-failed'     = '  Токен не сохранён — продолжаю с текущими файлами.'
    'install.latest'           = '  Уже последняя версия — v{0}.'
    'install.version-pair'     = '  Локально: v{0}   Последняя: {1}'
    'install.update-ask'       = '  Обновить до {0} сейчас?'
    'install.update-skipped'   = '  Обновление пропущено — продолжаю с текущими файлами.'
    'install.downloading'      = '  Скачиваю {0} с GitHub...'
    'install.updated'          = "  Обновлено до {0}.`n  Изменения в install.bat / start.bat / update.ps1 применятся при следующей чистой установке."
    'install.update-failed'    = "  ОШИБКА: не удалось применить обновление. Проверьте подключение`n  к интернету и повторите — продолжаю с текущими файлами."
    'install.deps'             = '[4/6] Устанавливаю зависимости — это может занять минуту...'
    'install.deps-failed'      = "`n  ОШИБКА: npm install не выполнился. Проверьте подключение и повторите.`n"
    'install.deps-ok'          = '  Зависимости установлены.'
    'install.shortcut-ask'     = '[5/6] Создать ярлык на рабочем столе для запуска приложения?'
    'install.shortcut-created' = '  Ярлык создан: {0}'
    'install.shortcut-failed'  = '  Не удалось создать ярлык — приложение можно запускать через start.bat'
    'install.shortcut-skipped' = '  Пропущено. Приложение всегда можно запустить через start.bat'
    'install.starting'         = '[6/6] Запускаю приложение...'
    'install.address'          = '  Адрес сервера — http://127.0.0.1:5173, браузер откроется сам'
    'start.node-missing'       = 'Node.js не установлен. Сначала запустите install.bat или возьмите Node.js с https://nodejs.org'
    'start.first-run'          = 'Первый запуск — устанавливаю зависимости...'
    'start.deps-failed'        = 'npm install не выполнился. Проверьте подключение к интернету.'
    'start.starting'           = 'Запускаю HueForge Web на http://127.0.0.1:5173 ...'
    'deploy.node-missing'      = 'Node.js не установлен. Возьмите версию LTS с https://nodejs.org'
    'deploy.no-dist'           = "Папка dist\ не найдена — это не deploy-пакет.`nВозьмите файлы из hueforge-web-deploy-*.zip."
    'deploy.starting'          = 'Запускаю HueForge Web на http://127.0.0.1:{0} ...'
    'deploy.slicer-on'         = "Передача в слайсер ВКЛЮЧЕНА — приложение может запустить ваш слайсер`nBambu Studio / OrcaSlicer / PrusaSlicer с экспортированной моделью."
    'close-hint'               = 'Чтобы остановить сервер, закройте это окно.'
}

# Печать сообщения по ключу: подстановки {0}, {1}, … из $MessageArgs.
function Write-Say([string]$Key) {
    $text = $Messages[$Key]
    if (-not $text) {
        [Console]::Error.WriteLine("ERR: неизвестное сообщение '$Key'")
        exit 1
    }
    if ($MessageArgs -and $MessageArgs.Count -gt 0) {
        # Ошибку подстановки не глотаем: без неё пользователь увидит '{0}' без
        # объяснения. Согласованность ключей и аргументов держит
        # src/test/consoleMessages.test.ts.
        try { $text = $text -f $MessageArgs } catch {
            [Console]::Error.WriteLine("ERR: у сообщения '$Key' не хватает аргументов для подстановки")
        }
    }
    # Строка за строкой: Write-Output добавляет CRLF, поэтому в перенаправленном
    # выводе не будет смеси переводов строк из многострочных сообщений.
    foreach ($line in ($text -split "`r?`n")) { Write-Output $line }
}

function Save-Backup {
    # Один слот бэкапа на машину: состояние прямо перед последним обновлением.
    if (Test-Path $BackupDir) { Remove-Item $BackupDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    robocopy $PSScriptRoot $BackupDir /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'не удалось создать бэкап' }
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
    # Простое сравнение x.y.z; предрелизные суффиксы игнорируются.
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
    'say' {
        Write-Say $Tag
        exit 0
    }

    'check' {
        $headers = Get-AuthHeaders
        try {
            $latest = Invoke-Api '/releases/latest' $headers
        } catch {
            $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            if ($status -in 401, 403, 404 -and -not (Test-Path $TokenFile) -and -not $env:HF_GITHUB_TOKEN) {
                Write-Output 'NEED_TOKEN'
            }
            # Любая другая ошибка (нет сети и т.п.): молчим, install.bat продолжит локально.
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
        $secure = Read-Host -Prompt 'Токен GitHub (fine-grained: Contents + Metadata: Read на Sovero/hf)' -AsSecureString
        $plain = [System.Net.NetworkCredential]::new('', $secure).Password
        if (-not $plain) { [Console]::Error.WriteLine('ERR: пустой токен'); exit 1 }
        New-Item -ItemType Directory -Force -Path $TokenDir | Out-Null
        Set-Content -Path $TokenFile -Value $plain.Trim() -NoNewline
        Write-Output 'OK'
        exit 0
    }

    'download' {
        if (-not $Tag) { [Console]::Error.WriteLine('ERR: не указан тег'); exit 1 }
        $headers = Get-AuthHeaders
        try {
            # Конечная точка zipball работает и для публичных, и для приватных
            # репозиториев (достаточно Contents: Read), и PowerShell корректно
            # идёт по её редиректу — в отличие от ссылки на ассет релиза, которая
            # для приватных репозиториев отдаёт 404. Приложенный ассет
            # hueforge-web-*.zip остаётся на странице релиза для людей.
            $zip = Join-Path $env:TEMP 'hf_update.zip'
            if (Test-Path $zip) { Remove-Item $zip -Force }
            Invoke-WebRequest -Uri "$ApiBase/zipball/$Tag" -Headers $headers -OutFile $zip -UseBasicParsing
            $dest = Join-Path $env:TEMP 'hf_update'
            if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
            Expand-Archive -Path $zip -DestinationPath $dest -Force
            # GitHub оборачивает дерево в одну папку "<owner>-<repo>-<sha>";
            # если она есть, возвращаем её, чтобы robocopy копировал файлы.
            $top = Get-ChildItem -Path $dest -Directory | Select-Object -First 1
            if ($top -and (Test-Path (Join-Path $top.FullName 'package.json'))) { Write-Output $top.FullName }
            else { Write-Output $dest }
        } catch {
            # Ошибки идут в stderr, чтобы вывод stdout для install.bat остался
            # пустым (install.bat тогда сам сообщит о сбое).
            [Console]::Error.WriteLine('ERR: ' + $_.Exception.Message)
            exit 1
        }
        exit 0
    }

    'download-deploy' {
        if (-not $Tag) { [Console]::Error.WriteLine('ERR: не указан тег'); exit 1 }
        $headers = Get-AuthHeaders
        try {
            # Находим deploy-ассет нужного релиза. Конечная точка ассета в API
            # редиректит на подписанный URL CDN (там авторизация не нужна), так
            # что схема та же, что и с zipball исходников.
            $release = Invoke-Api "/releases/tags/$Tag" $headers
            $asset = $release.assets | Where-Object { $_.name -like 'hueforge-web-deploy-*.zip' } | Select-Object -First 1
            if (-not $asset) {
                throw "в релизе $Tag нет deploy-ассета (найдены: $((@($release.assets) | ForEach-Object { $_.name }) -join ', '))"
            }
            $zip = Join-Path $env:TEMP 'hf_deploy_update.zip'
            if (Test-Path $zip) { Remove-Item $zip -Force }
            Invoke-WebRequest -Uri "$ApiBase/releases/assets/$($asset.id)" `
                -Headers ($headers + @{ 'Accept' = 'application/octet-stream' }) `
                -OutFile $zip -UseBasicParsing
            $dest = Join-Path $env:TEMP 'hf_deploy_update'
            if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
            Expand-Archive -Path $zip -DestinationPath $dest -Force
            # Сохраняем текущую папку (один слот — состояние до обновления),
            # чтобы потом можно было вернуться к ней через rollback.
            Save-Backup
            # Синхронизируем dist\ зеркалом, чтобы устаревшие файлы старой
            # сборки удалялись, а не накапливались (index.html всегда ссылается
            # на новые хешированные файлы).
            robocopy (Join-Path $dest 'dist') (Join-Path $PSScriptRoot 'dist') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw 'не удалось обновить dist' }
            # Остальное распаковываем поверх папки. deploy-архив — плоское дерево
            # (dist/, server.mjs, *.bat, DEPLOY.md, version.txt); update.ps1 уже
            # загружен PowerShell, поэтому его можно заменять безопасно.
            robocopy $dest $PSScriptRoot /E /XD dist /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw 'robocopy завершился ошибкой' }
            Remove-Item $zip -Force -ErrorAction SilentlyContinue
            Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
            Write-Output "Обновлено до $Tag. Перезапустите deploy.bat. Прежняя версия сохранена — вернуть её можно командой 'update.ps1 rollback'."
        } catch {
            [Console]::Error.WriteLine('ERR: ' + $_.Exception.Message)
            exit 1
        }
        exit 0
    }

    'rollback' {
        if (-not (Test-Path $BackupDir)) {
            [Console]::Error.WriteLine('ERR: бэкап не найден — сначала выполните download-deploy')
            exit 1
        }
        try {
            # Зеркалим из бэкапа: файлы, добавленные обновлением (например новые
            # сборки в dist), удаляются, и папка снова точно та же, что была до него.
            robocopy $BackupDir $PSScriptRoot /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw 'не удалось восстановить' }
            Write-Output 'Прежняя версия восстановлена. Перезапустите deploy.bat.'
        } catch {
            [Console]::Error.WriteLine('ERR: ' + $_.Exception.Message)
            exit 1
        }
        exit 0
    }
}
