import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Консольные сообщения запуска (`install.bat`, `start.bat`, `deploy.bat`,
 * `deploy-slicer.bat`) печатает PowerShell: `cmd.exe` разбирает командный файл
 * в текущей кодировке и срывается на многобайтных символах, поэтому `.bat`
 * остаётся ASCII-кодом, а русские тексты лежат в таблице `$Messages`
 * в `update.ps1`. Тесты держат этот контракт: их легко нарушить, просто
 * добавив `echo` с фразой или переименовав ключ в одной половине пары.
 */

const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')
const bytes = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url))

const BATS = ['install.bat', 'start.bat', 'deploy.bat', 'deploy-slicer.bat']

/** Ключи, на которые ссылаются скрипты, и число переданных аргументов. */
function callsIn(bat: string): { key: string; args: number }[] {
  const out: { key: string; args: number }[] = []
  for (const line of bat.split('\n')) {
    const match = /^\s*call :say\s+([\w.\-]+)(.*)$/.exec(line.replace(/\r$/, ''))
    if (!match) continue
    const quoted = match[2]!.match(/"[^"]*"/g) ?? []
    out.push({ key: match[1]!, args: quoted.length })
  }
  return out
}

/** Таблица $Messages из update.ps1: ключ → текст шаблона. */
function messageTable(ps1: string): Map<string, string> {
  const start = ps1.indexOf('$Messages = @{')
  expect(start, 'в update.ps1 нет таблицы $Messages').toBeGreaterThan(-1)
  const block = ps1.slice(start, ps1.indexOf('\n}', start))
  const table = new Map<string, string>()
  for (const line of block.split('\n')) {
    const match = /^\s*'([\w.\-]+)'\s*=\s*['"](.*)['"],?\s*$/.exec(line)
    if (match) table.set(match[1]!, match[2]!)
  }
  return table
}

const messages = messageTable(read('update.ps1'))

describe('консольные сообщения запуска', () => {
  it('все .bat — чистый ASCII: кириллица в них ломает парсер cmd.exe', () => {
    for (const name of BATS) {
      const buf = bytes(name)
      const nonAscii = [...buf].filter((b) => b > 0x7f)
      expect(nonAscii, `${name} содержит ${nonAscii.length} не-ASCII байт`).toHaveLength(0)
    }
  })

  it('у всех .bat переводы строк CRLF (с LF cmd.exe разбирает файл неверно)', () => {
    for (const name of BATS) {
      expect(read(name).replace(/\r\n/g, ''), `${name}: найден одиночный LF`).not.toContain('\n')
    }
  })

  it('.gitattributes закрепляет CRLF для *.bat', () => {
    const attrs = read('.gitattributes')
    expect(attrs).toMatch(/\*\.bat\s+text\s+eol=crlf/)
  })

  it('каждый ключ из call :say объявлен в $Messages', () => {
    for (const name of BATS) {
      const unknown = callsIn(read(name))
        .map((call) => call.key)
        .filter((key) => !messages.has(key))
      expect(unknown, `${name}: ключей нет в update.ps1`).toEqual([])
    }
  })

  it('в $Messages нет текстов, которые никто не печатает', () => {
    const used = new Set(BATS.flatMap((name) => callsIn(read(name)).map((call) => call.key)))
    const unused = [...messages.keys()].filter((key) => !used.has(key))
    expect(unused, 'мёртвые ключи в update.ps1').toEqual([])
  })

  it('аргументов в вызове хватает на все подстановки {0}, {1}, …', () => {
    for (const name of BATS) {
      for (const call of callsIn(read(name))) {
        const template = messages.get(call.key)
        if (!template) continue
        const indexes = [...template.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]))
        const needed = indexes.length ? Math.max(...indexes) + 1 : 0
        expect(call.args, `${name}: ${call.key} ждёт ${needed} аргумент(ов)`).toBeGreaterThanOrEqual(needed)
      }
    }
  })

  it('в .bat не остаётся echo с текстом — сообщения печатает только :say', () => {
    for (const name of BATS) {
      for (const line of read(name).split('\r\n')) {
        const trimmed = line.trim()
        if (!trimmed.toLowerCase().startsWith('echo')) continue
        const isPlainEcho =
          /^@?echo\s+off$/i.test(trimmed) || /^echo\.$/.test(trimmed)
        // Строки, пишущие вспомогательный .vbs, — код, а не сообщение.
        const isFileWrite = /^\d*>\s*\S*\s*echo\s/i.test(trimmed) || /^>>?/.test(trimmed)
        expect(isPlainEcho || isFileWrite, `${name}: echo с текстом → ${trimmed}`).toBe(true)
      }
    }
  })

  it('install.bat передаёт путь проекта и версии через say', () => {
    const calls = callsIn(read('install.bat')).map((c) => c.key)
    expect(calls).toContain('install.folder')
    expect(calls).toContain('install.version-pair')
    expect(calls).toContain('install.updated')
  })
})
