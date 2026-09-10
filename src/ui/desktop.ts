/**
 * Мост рендерера к Electron-оболочке (window.hueforge из preload).
 *
 * Когда приложение открыто в браузере, объект отсутствует и модуль ничего не
 * делает — веб-сборка продолжает работать как раньше. Внутри Electron:
 *  - экспорт «Скачать STL/3MF/…» идёт через нативный диалог сохранения;
 *  - в шапке появляется статус автообновления и диалог ввода GitHub-токена
 *    (приватный репозиторий требует токен на проверку обновлений).
 */
import type { Lang } from '../i18n'

interface DesktopBridge {
  appInfo(): Promise<{ name: string; version: string; platform: string; electron: string; packaged: boolean }>
  saveFile(data: ArrayBuffer | Uint8Array | string, filename: string, mime: string): Promise<{ ok: boolean; filePath?: string; canceled?: boolean; message?: string }>
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<{ ok: boolean; message?: string }>
  installUpdate(): Promise<unknown>
  setUpdateToken(token: string): Promise<{ ok: boolean }>
  hasUpdateToken(): Promise<boolean>
  onUpdateStatus(cb: (payload: UpdateStatus) => void): () => void
}

interface UpdateStatus {
  state: 'dev' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

const bridge = (window as unknown as { hueforge?: DesktopBridge }).hueforge ?? null
/** Внутри Electron? (в браузере bridge == null) */
export const isDesktop = bridge !== null

let lang: Lang = 'en'

/** Локализованные подписи статуса обновления. */
function updateTexts(l: Lang) {
  const ru = l === 'ru'
  return {
    checking: ru ? 'Проверка обновлений…' : 'Checking for updates…',
    uptodate: ru ? 'У вас последняя версия' : 'You are up to date',
    available: ru ? 'Доступна версия {v} — скачать?' : 'Version {v} is available — download?',
    downloading: ru ? 'Скачивание обновления… {p}%' : 'Downloading update… {p}%',
    downloaded: ru ? 'Обновление скачано — установить?' : 'Update downloaded — install?',
    installed: ru ? 'Установите обновление — приложение перезапустится.' : 'Install the update — the app will restart.',
    error: ru ? 'Ошибка обновления: {m}' : 'Update error: {m}',
    dev: ru ? 'Автообновление работает только в установленном приложении.' : 'Auto-update works only in the installed app.',
    tokenTitle: ru ? 'GitHub-токен для обновлений' : 'GitHub token for updates',
    tokenHint: ru
      ? 'Репозиторий приватный: создайте fine-grained токен с правами Contents: Read + Metadata: Read на репозиторий hf и вставьте его сюда. Токен хранится только на этом компьютере.'
      : 'The repository is private: create a fine-grained token with Contents: Read + Metadata: Read on the hf repository and paste it here. The token is stored only on this PC.',
    tokenPlaceholder: ru ? 'Вставьте токен…' : 'Paste the token…',
    tokenSave: ru ? 'Сохранить' : 'Save',
    tokenRemove: ru ? 'Удалить сохранённый' : 'Remove saved',
    tokenCancel: ru ? 'Отмена' : 'Cancel',
    download: ru ? 'Скачать' : 'Download',
    install: ru ? 'Установить' : 'Install',
    later: ru ? 'Позже' : 'Later',
    savedOk: ru ? 'Токен сохранён. Проверяю обновления…' : 'Token saved. Checking for updates…',
  }
}

/**
 * Скачать файл в Electron через нативный диалог. Возвращает false, если
 * пользователь отменил или мост недоступен (тогда вызывающий код делает
 * обычный браузерный triggerDownload).
 */
export async function desktopSaveFile(data: BlobPart, filename: string, mime: string): Promise<boolean> {
  if (!bridge) return false
  const result = await bridge.saveFile(data as ArrayBuffer, filename, mime)
  if (result.ok) return true
  // canceled — не ошибка; просто вернём false, чтобы не показывать статус.
  return false
}

/**
 * Показать нативный prompt-подобный диалог ввода токена. Electron не имеет
 * prompt(), поэтому используется несrsах dialog.showMessageBox с inputBox
 * недоступен — реализуем через отдельное модальное окно-диалог (см.
 * desktop-token-dialog ниже).
 */
export function initDesktopShell(currentLang: Lang): void {
  if (!bridge) return
  lang = currentLang
  void setupUpdateUi()
}

/** Обновить язык локализации у уже инициализированного десктоп-моста. */
export function setDesktopLang(next: Lang): void {
  if (!bridge) return
  lang = next
  if (statusEl && lastStatus) renderStatus(lastStatus)
}

// ---- статус обновления в шапке --------------------------------------------

let statusEl: HTMLSpanElement | null = null
let lastStatus: UpdateStatus | null = null

function setupUpdateUi() {
  statusEl = document.createElement('span')
  statusEl.className = 'app-version update-status'
  statusEl.hidden = true
  statusEl.addEventListener('click', () => void onUpdateClick())
  const versionBadge = document.getElementById('app-version')
  versionBadge?.after(statusEl)
  bridge!.onUpdateStatus((payload) => {
    lastStatus = payload
    renderStatus(payload)
  })
  // Есть ли токен — попробуем сразу проверить обновления молча.
  void bridge!.hasUpdateToken().then((has) => {
    if (has) return // main сам проверяет по расписанию
  })
}

function renderStatus(s: UpdateStatus) {
  if (!statusEl) return
  const texts = updateTexts(lang)
  statusEl.hidden = false
  statusEl.title = texts.checking
  switch (s.state) {
    case 'checking':
      statusEl.textContent = '⟳'
      break
    case 'uptodate':
      statusEl.textContent = '✓'
      statusEl.title = texts.uptodate
      break
    case 'available':
      statusEl.textContent = '↑'
      statusEl.title = texts.available.replace('{v}', s.version ?? '')
      break
    case 'downloading':
      statusEl.textContent = `${s.percent ?? 0}%`
      statusEl.title = texts.downloading.replace('{p}', String(s.percent ?? 0))
      break
    case 'downloaded':
      statusEl.textContent = '↓'
      statusEl.title = texts.downloaded
      break
    case 'error':
      statusEl.textContent = '!'
      statusEl.title = texts.error.replace('{m}', s.message ?? '')
      break
    case 'dev':
      statusEl.hidden = true
      break
  }
}

/** Клик по индикатору: контекстное действие по текущему состоянию. */
async function onUpdateClick(): Promise<void> {
  if (!bridge) return
  const s = lastStatus
  if (s?.state === 'downloaded') {
    await bridge.installUpdate()
    return
  }
  if (s?.state === 'available') {
    await bridge.downloadUpdate()
    return
  }
  if (s?.state === 'error' && /token/i.test(s.message ?? '')) {
    void promptForToken()
    return
  }
  // Иначе — интерактивная проверка (и диалог токена, если он нужен).
  await bridge.checkForUpdates()
}

// ---- диалог токена ----------------------------------------------------------

async function promptForToken(): Promise<void> {
  if (!bridge) return
  const texts = updateTexts(lang)
  // Мини-диалог на чистом DOM (без alert/prompt, они в Electron отключены).
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:grid;place-items:center;z-index:9999'
  const card = document.createElement('div')
  card.style.cssText = `background:var(--panel,#1a2027);color:var(--text,#e6edf3);padding:20px;border-radius:10px;max-width:440px;box-shadow:0 12px 40px rgba(0,0,0,.5)`
  card.innerHTML = `
    <h3 style="margin:0 0 8px;font-size:15px">${texts.tokenTitle}</h3>
    <p class="muted small" style="margin:0 0 12px">${texts.tokenHint}</p>
    <input id="hf-token-input" type="password" placeholder="${texts.tokenPlaceholder}"
      style="width:100%;box-sizing:border-box;margin-bottom:12px;padding:8px 10px;border-radius:6px;border:1px solid var(--border,#333);background:var(--panel-2,#11151a);color:inherit" />
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="hf-token-remove" class="btn ghost" style="margin-right:auto">${texts.tokenRemove}</button>
      <button id="hf-token-cancel" class="btn ghost">${texts.tokenCancel}</button>
      <button id="hf-token-save" class="btn">${texts.tokenSave}</button>
    </div>`
  overlay.appendChild(card)
  document.body.appendChild(overlay)
  const input = card.querySelector<HTMLInputElement>('#hf-token-input')!
  input.focus()
  const close = () => overlay.remove()
  const save = async () => {
    await bridge!.setUpdateToken(input.value.trim())
    close()
  }
  card.querySelector('#hf-token-save')!.addEventListener('click', () => void save())
  card.querySelector('#hf-token-cancel')!.addEventListener('click', close)
  card.querySelector('#hf-token-remove')!.addEventListener('click', () => {
    void bridge!.setUpdateToken('')
    close()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void save()
    if (e.key === 'Escape') close()
  })
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })
}

// добавлено: экспорт внутренностей для тестов не требуется
export {}
