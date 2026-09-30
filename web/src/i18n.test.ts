import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLang, dictFor, formatMoney, label, loadDict } from './i18n'

describe('i18n', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('falls back to English labels for languages the data does not carry', () => {
    const l = { ja: '東京', en: 'Tokyo' }
    expect(label(l, 'zh')).toBe('Tokyo')
    expect(label(l, 'ko')).toBe('Tokyo')
    expect(label({ ...l, vi: 'Tô-ky-ô' }, 'vi')).toBe('Tô-ky-ô')
  })

  it('lazy-loads the zh/ko/vi dictionaries with every key', async () => {
    const keys = Object.keys(dictFor('ja')).sort()
    for (const lang of ['zh', 'ko', 'vi'] as const) {
      const d = await loadDict(lang)
      expect(Object.keys(d).sort()).toEqual(keys)
      expect(dictFor(lang)).toBe(d)
      expect(Object.keys(d.countries).sort()).toEqual(Object.keys(dictFor('ja').countries).sort())
    }
  })

  it('detects the browser language', () => {
    for (const [langs, want] of [[['zh-TW'], 'zh'], [['ko-KR'], 'ko'], [['vi'], 'vi'], [['fr-FR', 'ja-JP'], 'ja'], [['fr'], 'en']] as const) {
      vi.stubGlobal('navigator', { languages: langs, language: langs[0] })
      expect(detectLang()).toBe(want)
    }
  })

  it('formats with the language locale', () => {
    expect(formatMoney(4_500_000, 'JPY', 'ko')).toContain('만')
    expect(formatMoney(4_500_000, 'JPY', 'zh')).toContain('万')
  })
})
