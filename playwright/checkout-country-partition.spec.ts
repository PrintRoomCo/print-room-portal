import { expect, test, type Page, type TestInfo } from '@playwright/test'

const fixture = {
  baseURL: process.env.PORTAL_E2E_BASE_URL,
  storageState: process.env.PORTAL_E2E_STORAGE_STATE,
  organization: process.env.PORTAL_E2E_MULTI_COUNTRY_ORG,
}
const fixtureReady = Object.values(fixture).every(Boolean)

type StoreOption = { label: string; value: string }

function assertSafeTarget() {
  const url = new URL(fixture.baseURL!)
  const safeHost =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    /(?:preview|staging|test|\.vercel\.app$)/i.test(url.hostname)
  if (!safeHost) {
    throw new Error(`Refusing checkout E2E against non-local/non-preview host: ${url.hostname}`)
  }
}

async function waitForPreview(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/checkout/preview',
  )
}

async function storeOptions(select: ReturnType<Page['getByRole']>): Promise<StoreOption[]> {
  return select.locator('option').evaluateAll((options) =>
    options.map((option) => ({
      label: option.textContent?.trim() ?? '',
      value: (option as HTMLOptionElement).value,
    })),
  )
}

function optionForCountry(options: StoreOption[], country: 'AU' | 'NZ') {
  const countryPattern = country === 'AU'
    ? /(?:\bAU\b|Australia|Melbourne|Sydney)/i
    : /(?:\bNZ\b|New Zealand|Auckland|Wellington)/i
  const match = options.find(
    (option) => option.value !== '__custom__' && countryPattern.test(option.label),
  )
  if (!match) {
    throw new Error(
      `Safe fixture needs a visible ${country} store marker in its store name or city; saw: ${options
        .map((option) => option.label)
        .join(', ')}`,
    )
  }
  return match
}

async function productNamesInPartition(page: Page, orderType: string) {
  const heading = page.getByRole('heading', { name: orderType, exact: true }).first()
  const section = heading.locator('xpath=ancestor::section[1]')
  const selects = section.getByRole('combobox', { name: 'Ship to' })
  const names: string[] = []
  for (let index = 0; index < await selects.count(); index += 1) {
    const row = selects.nth(index).locator('xpath=ancestor::div[contains(@class,"flex-wrap")][1]')
    names.push((await row.locator('.text-base.font-medium').first().innerText()).trim())
  }
  return names
}

async function selectCountryForProduct(
  page: Page,
  productName: string,
  option: StoreOption,
) {
  const product = page.getByText(productName, { exact: true }).first()
  const row = product.locator('xpath=ancestor::div[.//select][1]')
  const select = row.getByRole('combobox', { name: 'Ship to' })
  if ((await select.inputValue()) === option.value) return
  await Promise.all([waitForPreview(page), select.selectOption(option.value)])
}

async function openPreparedReview(page: Page, testInfo: TestInfo) {
  await page.goto('/checkout')
  await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  await expect(page.getByText(fixture.organization!, { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Open navigation menu' }).click()

  await expect(page.getByRole('heading', { name: 'Purchase order', exact: true })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Stock-on-hand order', exact: true })).toHaveCount(1)
  const purchaseProducts = await productNamesInPartition(page, 'Purchase order')
  const stockProducts = await productNamesInPartition(page, 'Stock-on-hand order')
  expect(purchaseProducts, 'fixture must contain one made-to-order line').toHaveLength(1)
  expect(stockProducts, 'fixture must contain two stocked lines').toHaveLength(2)

  const firstSelect = page.getByRole('combobox', { name: 'Ship to' }).first()
  const options = await storeOptions(firstSelect)
  const auStore = optionForCountry(options, 'AU')
  const nzStore = optionForCountry(options, 'NZ')
  await selectCountryForProduct(page, purchaseProducts[0], auStore)
  await selectCountryForProduct(page, stockProducts[0], auStore)
  await selectCountryForProduct(page, stockProducts[1], nzStore)

  await expect(page.getByText('Australia · AUD', { exact: true })).toBeVisible()
  await expect(page.getByText('New Zealand · NZD', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Purchase order', exact: true })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Stock-on-hand order', exact: true })).toHaveCount(2)

  const au = page.getByText('Australia · AUD', { exact: true }).locator('xpath=ancestor::section[1]')
  const nz = page.getByText('New Zealand · NZD', { exact: true }).locator('xpath=ancestor::section[1]')
  await expect(au.getByText('GST 10%', { exact: true })).toBeVisible()
  await expect(nz.getByText('GST 15%', { exact: true })).toBeVisible()
  await expect(nz.getByText('Picking fee', { exact: true })).toBeVisible()
  await expect(au.getByText('Total', { exact: true })).toBeVisible()
  await expect(nz.getByText('Total', { exact: true })).toBeVisible()
  await expect(au.getByText(/\$[\d,.]+ AUD/).first()).toBeVisible()
  await expect(nz.getByText(/\$[\d,.]+ NZD/).first()).toBeVisible()
  await expect(page.getByText(/Repriced from [A-Z]{3} for delivery to (Australia|New Zealand)\./)).toBeVisible()
  await expect(page.getByText(/grand total|Total across/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Place 3 orders' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review order' })).toBeEnabled()

  await testInfo.attach('country-totals-before-review', {
    body: Buffer.from(`${await au.innerText()}\n\n${await nz.innerText()}`),
    contentType: 'text/plain',
  })
  await page.getByRole('button', { name: 'Review order' }).click()
  await expect(page).toHaveURL(/\/checkout\/review$/)
  await expect(page.getByRole('button', { name: 'Place 3 orders' })).toBeVisible()
  await expect(page.getByText(/grand total|Total across/i)).toHaveCount(0)
}

test.describe('SP3 authenticated multi-country checkout', () => {
  test.skip(
    !fixtureReady,
    'Set PORTAL_E2E_BASE_URL, PORTAL_E2E_STORAGE_STATE, and PORTAL_E2E_MULTI_COUNTRY_ORG.',
  )

  test.beforeAll(() => assertSafeTarget())

  test('places the three safe fixture orders through the real route', async ({ page }, testInfo) => {
    await openPreparedReview(page, testInfo)
    await page.getByLabel(/I have read and agree/i).check()

    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/checkout',
    )
    await page.getByRole('button', { name: 'Place 3 orders' }).click()
    const response = await responsePromise
    expect(response.status()).toBe(200)
    const payload = await response.json()
    expect(payload.outcomes.filter((outcome: { ok: boolean }) => outcome.ok)).toHaveLength(3)
    await testInfo.attach('real-order-outcomes', {
      body: Buffer.from(JSON.stringify(payload.outcomes, null, 2)),
      contentType: 'application/json',
    })
    await expect(page).toHaveURL(/\/checkout\/confirmation\//)
    await page.screenshot({ path: testInfo.outputPath('three-country-orders.png'), fullPage: true })
  })

  test('keeps two successes attached and retries one synthetic 207 failure', async ({ page }, testInfo) => {
    await openPreparedReview(page, testInfo)
    let requestCount = 0
    let idempotencyBase: string | null = null
    await page.route('**/api/checkout', async (route) => {
      requestCount += 1
      const body = route.request().postDataJSON() as { idempotency_key: string }
      if (requestCount === 1) {
        idempotencyBase = body.idempotency_key
        await route.fulfill({
          status: 207,
          contentType: 'application/json',
          body: JSON.stringify({ outcomes: [
            {
              ok: true, partitionKey: 'AU:purchase_order', countryCode: 'AU', currency: 'AUD',
              orderType: 'purchase_order', orderId: 'pw-order-au-po', orderRef: 'PW-AU-PO',
            },
            {
              ok: true, partitionKey: 'AU:stock_on_hand', countryCode: 'AU', currency: 'AUD',
              orderType: 'stock_on_hand', orderId: 'pw-order-au-stock', orderRef: 'PW-AU-STOCK',
            },
            {
              ok: false, partitionKey: 'NZ:stock_on_hand', countryCode: 'NZ', currency: 'NZD',
              orderType: 'stock_on_hand', code: 'submit_failed',
              error: 'New Zealand fixture order could not be placed.',
            },
          ] }),
        })
        return
      }
      expect(body.idempotency_key).toBe(idempotencyBase)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ outcomes: [{
          ok: true, partitionKey: 'NZ:stock_on_hand', countryCode: 'NZ', currency: 'NZD',
          orderType: 'stock_on_hand', orderId: 'pw-order-nz-stock', orderRef: 'PW-NZ-STOCK',
        }] }),
      })
    })

    await page.getByLabel(/I have read and agree/i).check()
    await page.getByRole('button', { name: 'Place 3 orders' }).click()
    await expect(page.getByText('Placed · PW-AU-PO', { exact: true })).toBeVisible()
    await expect(page.getByText('Placed · PW-AU-STOCK', { exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText(
      'New Zealand fixture order could not be placed.',
    )
    await expect(page.getByRole('button', { name: 'Retry 1 order' })).toBeEnabled()

    await page.getByRole('button', { name: 'Retry 1 order' }).click()
    await expect.poll(() => requestCount).toBe(2)
    await expect(page).toHaveURL(/\/checkout\/confirmation\/pw-order-au-po$/)
    await page.screenshot({ path: testInfo.outputPath('synthetic-207-retry.png'), fullPage: true })
  })
})
