/**
 * Rough take-home pay for a single employee with no dependents and wage income only.
 * These are estimates for comparing groups, not tax advice: see DESIGN.md §6.5 for what is left out.
 */

export interface TakeHome {
  gross: number
  social: number
  incomeTax: number
  localTax: number
  net: number
}

// ---------------------------------------------------------------- Japan (令和7年分)

/** 給与所得控除（令和7年分以降） */
function jpEmploymentDeduction(g: number): number {
  if (g <= 1_900_000) return Math.min(g, 650_000)
  if (g <= 3_600_000) return g * 0.3 + 80_000
  if (g <= 6_600_000) return g * 0.2 + 440_000
  if (g <= 8_500_000) return g * 0.1 + 1_100_000
  return 1_950_000
}

/** 所得税の基礎控除（令和7・8年分。合計所得金額による特例加算を含む） */
function jpBasicDeduction(income: number): number {
  if (income <= 1_320_000) return 950_000
  if (income <= 3_360_000) return 880_000
  if (income <= 4_890_000) return 680_000
  if (income <= 6_550_000) return 630_000
  if (income <= 23_500_000) return 580_000
  if (income <= 24_000_000) return 480_000
  if (income <= 24_500_000) return 320_000
  if (income <= 25_000_000) return 160_000
  return 0
}

const JP_BRACKETS: [number, number, number][] = [
  // [upper bound of taxable income, rate, quick deduction]
  [1_950_000, 0.05, 0],
  [3_300_000, 0.1, 97_500],
  [6_950_000, 0.2, 427_500],
  [9_000_000, 0.23, 636_000],
  [18_000_000, 0.33, 1_536_000],
  [40_000_000, 0.4, 2_796_000],
  [Infinity, 0.45, 4_796_000],
]

export const JP_SOCIAL_RATES = {
  health: 0.05, // 協会けんぽ 全国平均 10.00% の労使折半
  care: 0.00795, // 介護保険 1.59% の折半（40〜64歳）
  pension: 0.0915, // 厚生年金 18.3% の折半
  employment: 0.0055, // 雇用保険（一般の事業）
  healthCap: 1_390_000 * 12, // 標準報酬月額の上限
  pensionCap: 650_000 * 12 + 1_500_000 * 2, // 標準報酬月額 65万円 + 賞与 150万円×2回 で近似
}

export function takeHomeJP(gross: number, age: number | null): TakeHome {
  const r = JP_SOCIAL_RATES
  const healthBase = Math.min(gross, r.healthCap)
  const careRate = age != null && age >= 40 && age < 65 ? r.care : 0
  const social =
    healthBase * (r.health + careRate) + Math.min(gross, r.pensionCap) * r.pension + gross * r.employment

  const income = Math.max(gross - jpEmploymentDeduction(gross), 0) // 給与所得 = 合計所得金額
  const taxable = Math.floor(Math.max(income - social - jpBasicDeduction(income), 0) / 1000) * 1000
  const [, rate, quick] = JP_BRACKETS.find(([ub]) => taxable <= ub)!
  const incomeTax = Math.max(taxable * rate - quick, 0) * 1.021 // 復興特別所得税を含む

  // 住民税: 所得割 10%（基礎控除 43万円、調整控除 2,500円）+ 均等割 5,000円（森林環境税を含む）
  let localTax = 0
  if (income > 450_000) {
    const localTaxable = Math.floor(Math.max(income - social - (income <= 24_000_000 ? 430_000 : 0), 0) / 1000) * 1000
    const adjustment = localTaxable <= 2_000_000 ? Math.min(50_000, localTaxable) * 0.05 : 2_500
    localTax = Math.max(localTaxable * 0.1 - adjustment, 0) + 5_000
  }
  return { gross, social, incomeTax, localTax, net: gross - social - incomeTax - localTax }
}

// ---------------------------------------------------------------- United States (tax year 2025)

/** amount − rate × (income − start), floored at 0 */
export interface Phaseout {
  start: number
  rate: number
}

export interface StateTax {
  brackets: [number, number][]
  standardDeduction: number
  personalExemption: number
  personalCredit: number
  deductionPhaseout?: Phaseout
  exemptionPhaseout?: Phaseout
  creditPhaseout?: Phaseout
}

function phase(amount: number, income: number, p?: Phaseout): number {
  return p ? Math.max(amount - p.rate * Math.max(income - p.start, 0), 0) : amount
}

const US_STANDARD_DEDUCTION = 15_750
const US_BRACKETS: [number, number][] = [
  [0, 0.1], [11_925, 0.12], [48_475, 0.22], [103_350, 0.24], [197_300, 0.32], [250_525, 0.35], [626_350, 0.37],
]
const SS_RATE = 0.062
const SS_WAGE_BASE = 176_100
const MEDICARE_RATE = 0.0145
const ADDITIONAL_MEDICARE = { rate: 0.009, threshold: 200_000 }

export function bracketTax(taxable: number, brackets: [number, number][]): number {
  let tax = 0
  for (let i = 0; i < brackets.length; i++) {
    const [lo, rate] = brackets[i]
    const hi = brackets[i + 1]?.[0] ?? Infinity
    if (taxable <= lo) break
    tax += (Math.min(taxable, hi) - lo) * rate
  }
  return tax
}

export function takeHomeUS(gross: number, state: StateTax | null): TakeHome {
  const social =
    Math.min(gross, SS_WAGE_BASE) * SS_RATE +
    gross * MEDICARE_RATE +
    Math.max(gross - ADDITIONAL_MEDICARE.threshold, 0) * ADDITIONAL_MEDICARE.rate
  const incomeTax = bracketTax(Math.max(gross - US_STANDARD_DEDUCTION, 0), US_BRACKETS)
  let localTax = 0
  if (state && state.brackets.length) {
    const deduction = phase(state.standardDeduction, gross, state.deductionPhaseout)
    const exemption = phase(state.personalExemption, gross, state.exemptionPhaseout)
    const credit = phase(state.personalCredit, gross, state.creditPhaseout)
    localTax = Math.max(bracketTax(Math.max(gross - deduction - exemption, 0), state.brackets) - credit, 0)
  }
  return { gross, social, incomeTax, localTax, net: gross - social - incomeTax - localTax }
}

// ---------------------------------------------------------------- United Kingdom (tax year 2025/26)

const UK_PERSONAL_ALLOWANCE = 12_570
// Bands on taxable income. The top band starts at £125,140, where the personal allowance has fully tapered away.
const UK_BANDS: [number, number][] = [[0, 0.2], [37_700, 0.4], [125_140, 0.45]]
const SCOTLAND_BANDS: [number, number][] = [
  [0, 0.19], [2_827, 0.2], [14_921, 0.21], [31_092, 0.42], [62_430, 0.45], [125_140, 0.48],
]
const UK_NI = { primaryThreshold: 12_570, upperEarningsLimit: 50_270, main: 0.08, upper: 0.02 }

export function takeHomeUK(gross: number, scotland: boolean): TakeHome {
  // Personal allowance tapers by £1 for every £2 over £100,000
  const allowance = Math.max(UK_PERSONAL_ALLOWANCE - Math.max(gross - 100_000, 0) / 2, 0)
  const incomeTax = bracketTax(Math.max(gross - allowance, 0), scotland ? SCOTLAND_BANDS : UK_BANDS)
  const social =
    (Math.min(gross, UK_NI.upperEarningsLimit) - Math.min(gross, UK_NI.primaryThreshold)) * UK_NI.main +
    Math.max(gross - UK_NI.upperEarningsLimit, 0) * UK_NI.upper
  return { gross, social, incomeTax, localTax: 0, net: gross - social - incomeTax }
}

// ---------------------------------------------------------------- Germany (2025)

/** Einkommensteuer nach §32a EStG 2025 (Grundtarif). */
export function deIncomeTax(zve: number): number {
  const x = Math.floor(zve)
  if (x <= 12_096) return 0
  if (x <= 17_443) {
    const y = (x - 12_096) / 10_000
    return Math.floor((932.3 * y + 1_400) * y)
  }
  if (x <= 68_480) {
    const z = (x - 17_443) / 10_000
    return Math.floor((176.64 * z + 2_397) * z + 1_015.13)
  }
  if (x <= 277_825) return Math.floor(0.42 * x - 10_911.92)
  return Math.floor(0.45 * x - 19_246.67)
}

export const DE_SOCIAL = {
  pension: 0.093, unemployment: 0.013, pensionCap: 96_600, // Beitragsbemessungsgrenze RV/AV
  health: 0.073 + 0.0125, care: 0.018 + 0.006, healthCap: 66_150, // + halber durchschn. Zusatzbeitrag; Pflege inkl. Kinderlosenzuschlag
}

export function takeHomeDE(gross: number): TakeHome {
  const s = DE_SOCIAL
  const pension = Math.min(gross, s.pensionCap) * s.pension
  const unemployment = Math.min(gross, s.pensionCap) * s.unemployment
  const health = Math.min(gross, s.healthCap) * s.health
  const care = Math.min(gross, s.healthCap) * s.care
  const social = pension + unemployment + health + care
  // Werbungskostenpauschale 1,230, Sonderausgabenpauschale 36, Vorsorgeaufwendungen:
  // Rentenbeiträge voll, Basis-Kranken- (ohne 4% Krankengeldanteil) und Pflegeversicherung
  const zve = Math.max(gross - 1_230 - 36 - pension - health * 0.96 - care, 0)
  const est = deIncomeTax(zve)
  // Solidaritätszuschlag: Freigrenze 19,950 EUR ESt, Milderungszone 11.9%
  const soli = est <= 19_950 ? 0 : Math.min(est * 0.055, (est - 19_950) * 0.119)
  const incomeTax = est + soli
  return { gross, social, incomeTax, localTax: 0, net: gross - social - incomeTax }
}

// ---------------------------------------------------------------- France (salaires 2025, 1 part)

const FR_PSS = 47_100 // plafond annuel de la sécurité sociale 2025
const FR_BAREME: [number, number][] = [[0, 0], [11_497, 0.11], [29_315, 0.3], [83_823, 0.41], [180_294, 0.45]]

export function takeHomeFR(gross: number): TakeHome {
  const t1 = Math.min(gross, FR_PSS)
  const t2 = Math.min(Math.max(gross - FR_PSS, 0), 7 * FR_PSS)
  const csgBase = Math.min(gross, 4 * FR_PSS) * 0.9825 + Math.max(gross - 4 * FR_PSS, 0)
  const csgDeductible = csgBase * 0.068
  const csgCrds = csgBase * (0.024 + 0.005) // CSG non déductible + CRDS
  const contributions =
    t1 * 0.069 + gross * 0.004 + // vieillesse plafonnée / déplafonnée
    t1 * (0.0315 + 0.0086) + t2 * (0.0864 + 0.0108 + 0.0014) // AGIRC-ARRCO T1 / T2 (+ CEG, CET)
  const social = contributions + csgDeductible + csgCrds
  // Net imposable, puis abattement de 10 % (min 504, max 14,426)
  const netImposable = gross - contributions - csgDeductible
  const revenu = Math.max(netImposable - Math.min(Math.max(netImposable * 0.1, 504), 14_426), 0)
  let impot = bracketTax(revenu, FR_BAREME)
  if (impot < 1_964) impot = Math.max(impot - (889 - impot * 0.4525), 0) // décote
  return { gross, social, incomeTax: impot, localTax: 0, net: gross - social - impot }
}

// ---------------------------------------------------------------- Italy (2025)

const IT_IRPEF: [number, number][] = [[0, 0.23], [28_000, 0.35], [50_000, 0.43]]
const IT_ADDIZIONALI = 0.023 // media nazionale approssimativa: regionale ~1.7% + comunale ~0.6%

function itWorkDeduction(r: number): number {
  let d = 0
  if (r <= 15_000) d = 1_955
  else if (r <= 28_000) d = 1_910 + (1_190 * (28_000 - r)) / 13_000
  else if (r <= 50_000) d = (1_910 * (50_000 - r)) / 22_000
  if (r > 25_000 && r <= 35_000) d += 65
  return d
}

export function takeHomeIT(gross: number): TakeHome {
  // INPS a carico del lavoratore: 9.19% + 1% oltre la prima fascia pensionabile
  const social = gross * 0.0919 + Math.max(gross - 55_448, 0) * 0.01
  const r = gross - social
  let irpef = Math.max(bracketTax(r, IT_IRPEF) - itWorkDeduction(r), 0)
  // Cuneo fiscale 2025: ulteriore detrazione 20–40k; sotto 20k un'indennità esente (trattata come imposta negativa)
  if (r > 20_000 && r <= 32_000) irpef = Math.max(irpef - 1_000, 0)
  else if (r > 32_000 && r <= 40_000) irpef = Math.max(irpef - (1_000 * (40_000 - r)) / 8_000, 0)
  const bonus = r <= 8_500 ? r * 0.071 : r <= 15_000 ? r * 0.053 : r <= 20_000 ? r * 0.048 : 0
  const incomeTax = irpef - bonus
  const localTax = r * IT_ADDIZIONALI
  return { gross, social, incomeTax, localTax, net: gross - social - incomeTax - localTax }
}

// ---------------------------------------------------------------- Canada (2025)

export interface CaProvince {
  brackets: [number, number][]
  basicPersonalAmount: number
  creditRate: number
  surtax?: [number, number][]
  /** [taxable income threshold, base premium, rate, cap] */
  healthPremiumSegments?: [number, number, number, number][]
  bpaFollowsFederal?: boolean
  canadaEmploymentAmount?: number
}

export interface CaTaxTable {
  federal: {
    brackets: [number, number][]
    basicPersonalAmount: { max: number; min: number; phaseoutStart: number; phaseoutEnd: number }
    creditRate: number
    canadaEmploymentAmount: number
    quebecAbatement: number
  }
  payroll: Record<'cpp' | 'qpp', { rate: number; basicExemption: number; ympe: number; baseRate: number; firstAdditionalRate: number }> &
    Record<'cpp2' | 'qpp2', { rate: number; yampe: number }> &
    Record<'ei' | 'eiQuebec' | 'qpip', { rate: number; maxInsurable: number }>
  provinces: Record<string, CaProvince>
}

const QC_EMPLOYMENT_DEDUCTION = { rate: 0.06, max: 1_420 }

export function takeHomeCA(gross: number, province: string | null, table: CaTaxTable): TakeHome {
  const quebec = province === 'QC'
  const pay = table.payroll
  const pension = quebec ? pay.qpp : pay.cpp
  const pension2 = quebec ? pay.qpp2 : pay.cpp2
  const ei = quebec ? pay.eiQuebec : pay.ei
  const pensionContrib = Math.max(Math.min(gross, pension.ympe) - pension.basicExemption, 0) * pension.rate
  const pension2Contrib = Math.max(Math.min(gross, pension2.yampe) - pension.ympe, 0) * pension2.rate
  const eiPremium = Math.min(gross, ei.maxInsurable) * ei.rate
  const qpip = quebec ? Math.min(gross, pay.qpip.maxInsurable) * pay.qpip.rate : 0
  const social = pensionContrib + pension2Contrib + eiPremium + qpip

  // The enhanced part of CPP/QPP (first additional rate and CPP2) is deducted from income;
  // the base part and EI earn non-refundable credits.
  const pensionBase = (pensionContrib * pension.baseRate) / pension.rate
  const taxable = Math.max(gross - (pensionContrib - pensionBase) - pension2Contrib, 0)

  const f = table.federal
  const bpa = f.basicPersonalAmount
  const phase = Math.min(Math.max((taxable - bpa.phaseoutStart) / (bpa.phaseoutEnd - bpa.phaseoutStart), 0), 1)
  const federalBpa = bpa.max - (bpa.max - bpa.min) * phase
  const contributionCredits = pensionBase + eiPremium + qpip
  let federal = Math.max(
    bracketTax(taxable, f.brackets) - f.creditRate * (federalBpa + Math.min(f.canadaEmploymentAmount, gross) + contributionCredits),
    0,
  )
  if (quebec) federal *= 1 - f.quebecAbatement

  let provincial = 0
  const p = province ? table.provinces[province] : null
  if (p) {
    const provTaxable = quebec ? Math.max(taxable - Math.min(gross * QC_EMPLOYMENT_DEDUCTION.rate, QC_EMPLOYMENT_DEDUCTION.max), 0) : taxable
    const provBpa = p.bpaFollowsFederal ? federalBpa : p.basicPersonalAmount
    const credits = provBpa + (quebec ? 0 : contributionCredits) + Math.min(p.canadaEmploymentAmount ?? 0, gross)
    provincial = Math.max(bracketTax(provTaxable, p.brackets) - p.creditRate * credits, 0)
    // Surtax (Ontario) is levied on basic provincial tax above each threshold
    const basic = provincial
    for (const [threshold, rate] of p.surtax ?? []) provincial += Math.max(basic - threshold, 0) * rate
    const seg = [...(p.healthPremiumSegments ?? [])].reverse().find(([threshold]) => taxable > threshold)
    if (seg) provincial += Math.min(seg[1] + seg[2] * (taxable - seg[0]), seg[3])
  }
  return { gross, social, incomeTax: federal, localTax: provincial, net: gross - social - federal - provincial }
}
