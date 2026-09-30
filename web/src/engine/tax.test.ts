import { describe, expect, it } from 'vitest'
import { bracketTax, deIncomeTax, takeHomeDE, takeHomeFR, takeHomeIT, takeHomeJP, takeHomeUK, takeHomeUS } from './tax'

describe('takeHomeJP', () => {
  it('matches a hand calculation for ¥5,000,000 at age 30', () => {
    const t = takeHomeJP(5_000_000, 30)
    // social = 5,000,000 × (5% + 9.15% + 0.55%) = 735,000
    expect(t.social).toBeCloseTo(735_000, 0)
    // 給与所得 = 5,000,000 − (1,000,000 + 440,000) = 3,560,000; 基礎控除 680,000
    // 課税所得 = 3,560,000 − 735,000 − 680,000 = 2,145,000 → 214,500 − 97,500 = 117,000 × 1.021
    expect(t.incomeTax).toBeCloseTo(119_457, 0)
    // 住民税 = (3,560,000 − 735,000 − 430,000) × 10% − 2,500 + 5,000 = 242,000
    expect(t.localTax).toBeCloseTo(242_000, 0)
    expect(t.net).toBeCloseTo(5_000_000 - 735_000 - 119_457 - 242_000, 0)
  })

  it('adds long-term care insurance from age 40', () => {
    expect(takeHomeJP(5_000_000, 45).social - takeHomeJP(5_000_000, 30).social).toBeCloseTo(5_000_000 * 0.00795, 0)
  })

  it('keeps net pay increasing with gross pay', () => {
    let prev = -1
    for (let g = 1_000_000; g <= 40_000_000; g += 250_000) {
      const n = takeHomeJP(g, 35).net
      expect(n).toBeGreaterThan(prev)
      prev = n
    }
  })
})

describe('takeHomeUS', () => {
  it('computes progressive tax across brackets', () => {
    expect(bracketTax(50_000, [[0, 0.1], [11_925, 0.12], [48_475, 0.22]])).toBeCloseTo(1192.5 + 4386 + 335.5, 6)
  })

  it('matches a hand calculation for $100,000 with no state tax', () => {
    const t = takeHomeUS(100_000, null)
    expect(t.social).toBeCloseTo(7_650, 6)
    // taxable 84,250: 1,192.50 + 4,386 + (84,250 − 48,475) × 22% = 13,449
    expect(t.incomeTax).toBeCloseTo(13_449, 6)
    expect(t.net).toBeCloseTo(100_000 - 7_650 - 13_449, 6)
  })

  it('applies a flat state tax after its deductions and credits', () => {
    const t = takeHomeUS(60_000, { brackets: [[0, 0.05]], standardDeduction: 10_000, personalExemption: 0, personalCredit: 100 })
    expect(t.localTax).toBeCloseTo(2_400, 6)
  })
})

describe('state phase-outs', () => {
  const utah = { brackets: [[0, 0.045]] as [number, number][], standardDeduction: 0, personalExemption: 0, personalCredit: 945, creditPhaseout: { start: 18_213, rate: 0.013 } }

  it('keeps the full credit below the phase-out start', () => {
    expect(takeHomeUS(18_000, utah).localTax).toBeCloseTo(0, 6) // 810 − 945 → 0
  })

  it('removes the credit entirely at high income', () => {
    expect(takeHomeUS(100_000, utah).localTax).toBeCloseTo(4_500, 6)
  })

  it('reduces the credit linearly in between', () => {
    expect(takeHomeUS(50_000, utah).localTax).toBeCloseTo(2_250 - (945 - 0.013 * (50_000 - 18_213)), 6)
  })
})

describe('other countries', () => {
  it('UK: £50,000 in England', () => {
    const t = takeHomeUK(50_000, false)
    expect(t.incomeTax).toBeCloseTo((50_000 - 12_570) * 0.2, 6) // 7,486
    expect(t.social).toBeCloseTo((50_000 - 12_570) * 0.08, 6) // 2,994.40
  })

  it('UK: personal allowance is gone at £125,140', () => {
    const t = takeHomeUK(125_140, false)
    expect(t.incomeTax).toBeCloseTo(37_700 * 0.2 + (125_140 - 37_700) * 0.4, 6)
  })

  it('DE: §32a tariff matches official 2025 values', () => {
    expect(deIncomeTax(12_096)).toBe(0)
    expect(deIncomeTax(20_000)).toBe(1_639) // (176.64·z + 2,397)·z + 1,015.13, z = 0.2557
    expect(deIncomeTax(100_000)).toBe(31_088)
  })

  it('DE: matches the official 2025 payroll algorithm (BMF PAP 2025, Steuerklasse I, childless)', () => {
    // Lohnsteuer + Soli from the PAP 2025 pseudocode
    for (const [gross, official] of [[30_000, 2_336], [50_000, 6_927], [80_000, 16_104], [120_000, 32_224 + 1_460.6]]) {
      expect(Math.abs(takeHomeDE(gross).incomeTax - official)).toBeLessThan(0.05)
    }
  })

  it('FR, IT, DE: net pay stays between 50% and 90% of gross for typical salaries', () => {
    for (const g of [30_000, 50_000, 80_000]) {
      for (const f of [takeHomeDE, takeHomeFR, takeHomeIT]) {
        const r = f(g).net / g
        expect(r).toBeGreaterThan(0.5)
        expect(r).toBeLessThan(0.9)
      }
    }
  })

  it('net pay increases with gross pay in every country', () => {
    for (const f of [(g: number) => takeHomeUK(g, true), takeHomeDE, takeHomeFR, takeHomeIT]) {
      let prev = -Infinity
      for (let g = 5_000; g <= 400_000; g += 1_000) {
        const n = f(g).net
        expect(n).toBeGreaterThan(prev)
        prev = n
      }
    }
  })
})
