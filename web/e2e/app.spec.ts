import { expect, test, type Page } from '@playwright/test'

const errors = (page: Page) => {
  const list: string[] = []
  page.on('console', (m) => m.type() === 'error' && list.push(m.text()))
  page.on('pageerror', (e) => list.push(String(e)))
  return list
}

test('shows the position of a default profile without errors', async ({ page }) => {
  const errs = errors(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '似た条件の人の年収' })).toBeVisible()
  await expect(page.getByText('同じ条件の人の年収の中央値')).toBeVisible()
  expect(errs).toEqual([])
})

test('a shared link restores the profile, amount type and tab', async ({ page }) => {
  await page.goto('/#c=JP&r=13&o=J012&a=32&s=F&e=bachelor&i=6500000&m=net&t=goal&l=ja')
  await expect(page.getByRole('heading', { name: '目標シミュレーション' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '職業', exact: true })).toHaveValue('J012')
  await expect(page.getByRole('button', { name: '手取り', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('似た条件の人のうち')).toBeVisible()
})

test('entering income shows a percentile, and the URL follows the inputs', async ({ page }) => {
  await page.goto('/#c=JP&l=ja')
  await page.getByLabel(/年収（任意）/).fill('800')
  await expect(page.getByText(/上位 \d/)).toBeVisible()
  await expect(page).toHaveURL(/i=8000000/)
})

test('every tab renders for every country', async ({ page }) => {
  const errs = errors(page)
  for (const c of ['JP', 'US', 'UK', 'CA', 'DE', 'FR', 'IT']) {
    for (const tab of ['position', 'goal', 'career', 'abroad', 'map', 'community']) {
      await page.goto(`/#c=${c}&t=${tab}&l=en`)
      await page.reload()
      await expect(page.locator('main section.card').first()).toBeVisible()
      await expect(page.getByText('Failed to load data')).toHaveCount(0)
    }
  }
  expect(errs).toEqual([])
})

test('switching country keeps a comparable occupation', async ({ page }) => {
  await page.goto('/#c=JP&o=J012&l=en')
  await page.getByRole('combobox', { name: 'Country', exact: true }).selectOption('US')
  await expect(page.getByRole('combobox', { name: 'Occupation', exact: true })).toHaveValue('151252')
})

test('community submissions stay closed without a configured database', async ({ page }) => {
  await page.goto('/#c=JP&t=community&l=ja')
  await page.getByText('あなたのデータを匿名で提供する').click()
  await expect(page.getByText('データの受け付けは準備中です')).toBeVisible()
})

test('has no serious accessibility violations on the main tabs', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright')
  for (const tab of ['position', 'goal', 'scenario', 'career', 'abroad', 'map', 'community']) {
    await page.goto(`/#c=JP&o=J012&a=32&i=6500000&t=${tab}&l=ja`)
    await page.reload()
    await expect(page.locator('main section.card').first()).toBeVisible()
    await page.waitForTimeout(300)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious.map((v) => `${tab}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([])
  }
})
