/**
 * HueForge Desktop — preload bridge.
 *
 * Единственный мост между изолированным рендерером (dist/) и главным
 * процессом: экспортирует минимальный `window.hueforge` API. Ничего из
 * Node.js не утекает в веб-контент (contextIsolation + sandbox).
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hueforge', {
  /** Инфо о приложении: версия, платформа, признак упакованной сборки. */
  appInfo: () => ipcRenderer.invoke('app:info'),
  /**
   * Нативное «Сохранить как…»: данные (ArrayBuffer/Uint8Array/string) уходят
   * в файл, выбранный пользователем. Возвращает {ok, filePath?} или
   * {ok:false, canceled:true}.
   */
  saveFile: (data, filename, mime) => ipcRenderer.invoke('export:save', { data, filename, mime }),
  /** Управление безрамочным окном. */
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  /** Подписка на изменение состояния maximize/restore. */
  onWindowState: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('window:state', handler)
    return () => ipcRenderer.removeListener('window:state', handler)
  },
  /** Проверить обновления (интерактивно — с уведомлениями в UI). */
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  /** Скачать обнаруженное обновление. */
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  /** Установить скачанное обновление (перезапуск приложения). */
  installUpdate: () => ipcRenderer.invoke('update:install'),
  /** Сохранить/удалить GitHub-токен для приватного репозитория обновлений. */
  setUpdateToken: (token) => ipcRenderer.invoke('update:token', token),
  /** Есть ли сохранённый токен (без раскрытия значения). */
  hasUpdateToken: () => ipcRenderer.invoke('update:has-token'),
  /** Подписка на статусы обновления: checking/available/downloading/… */
  onUpdateStatus: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.removeListener('update:status', handler)
  },
})
