import { test, expect, openMockTables } from './sql.fixture'

test('a 250k-row SELECT stays virtualized and becomes usable within the budget', async ({ page }, testInfo) => {
  await openMockTables(page)

  const started = Date.now()
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()

  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible({ timeout: 10_000 })
  const readyMs = Date.now() - started
  const grid = page.getByLabel('query results grid')
  await expect(grid).toBeVisible()

  const renderedRows = await grid.locator('[data-result-row]').count()
  expect(renderedRows).toBeLessThan(80)
  expect(readyMs).toBeLessThan(8_000)

  await grid.evaluate(element => { element.scrollLeft = element.scrollWidth; element.dispatchEvent(new Event('scroll')) })
  const nullCell = grid.locator('[data-result-column="Notes"][data-null-cell="true"]').first()
  await expect(nullCell).toBeVisible()
  const nullStyle = await nullCell.evaluate(element => {
    const style = getComputedStyle(element)
    return { backgroundColor: style.backgroundColor, fontStyle: style.fontStyle }
  })
  expect(nullStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(nullStyle.fontStyle).toBe('italic')

  const scroll = await grid.evaluate(async element => {
    const started = performance.now()
    element.scrollTop = element.scrollHeight - element.clientHeight
    element.dispatchEvent(new Event('scroll'))
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    return { elapsedMs: performance.now() - started, scrollTop: element.scrollTop }
  })
  await expect.poll(async () => {
    const indexes = await grid.locator('[data-result-row]').evaluateAll(rows => rows.map(row => Number(row.getAttribute('data-result-row'))))
    return Math.max(...indexes)
  }).toBeGreaterThan(249900)
  expect(scroll.elapsedMs).toBeLessThan(250)

  await testInfo.attach('massive-rows-performance.json', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ totalRows: 250000, renderedRows, readyMs, verticalScrollMs: scroll.elapsedMs }, null, 2))
  })
})

test('continuous vertical scrolling keeps the rendered row window stable', async ({ page }, testInfo) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible({ timeout: 10_000 })

  const grid = page.getByLabel('query results grid')
  const metrics = await grid.evaluate(async element => {
    const body = element.querySelector('[data-result-body]')
    if (!body) throw new Error('Virtualized result body not found')

    let mutationBatches = 0
    const frameDurations: number[] = []
    const observer = new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.type === 'childList')) mutationBatches++
    })
    observer.observe(body, { childList: true })

    for (let step = 1; step <= 80; step++) {
      const started = performance.now()
      element.scrollTop = step * 52
      await new Promise(requestAnimationFrame)
      frameDurations.push(performance.now() - started)
    }
    await new Promise(requestAnimationFrame)
    observer.disconnect()

    const sorted = [...frameDurations].sort((a, b) => a - b)
    return {
      mutationBatches,
      p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
      maxFrameMs: Math.max(...frameDurations),
      renderedRows: body.querySelectorAll('[data-result-row]').length
    }
  })

  await testInfo.attach('continuous-vertical-scroll-performance.json', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(metrics, null, 2))
  })

  expect(metrics.renderedRows).toBeLessThan(100)
  expect(metrics.mutationBatches).toBeLessThan(25)
  expect(metrics.p95FrameMs).toBeLessThan(34)
})

test('a 240-column result scrolls horizontally without desynchronizing its header', async ({ page }, testInfo) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.WideRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()

  await expect(page.getByText('5000 rows', { exact: true })).toBeVisible({ timeout: 10_000 })
  const grid = page.getByLabel('query results grid')
  const renderedHeaders = await grid.getByRole('columnheader').count()
  const renderedCells = await grid.getByRole('gridcell').count()
  expect(renderedHeaders).toBeLessThan(40)
  expect(renderedCells).toBeLessThan(1_500)
  const scroll = await grid.evaluate(async element => {
    const started = performance.now()
    element.scrollLeft = element.scrollWidth - element.clientWidth
    element.dispatchEvent(new Event('scroll'))
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    return {
      elapsedMs: performance.now() - started,
      scrollLeft: element.scrollLeft,
      maxScrollLeft: element.scrollWidth - element.clientWidth
    }
  })

  expect(scroll.scrollLeft).toBeGreaterThan(20_000)
  expect(scroll.scrollLeft).toBe(scroll.maxScrollLeft)
  expect(scroll.elapsedMs).toBeLessThan(250)

  const header = page.getByRole('columnheader', { name: 'WideColumn239', exact: true })
  const cell = page.getByRole('gridcell', { name: '239', exact: true }).first()
  const [headerBox, cellBox] = await Promise.all([header.boundingBox(), cell.boundingBox()])
  expect(headerBox).not.toBeNull()
  expect(cellBox).not.toBeNull()
  expect(Math.abs(headerBox!.x - cellBox!.x)).toBeLessThan(1)

  await testInfo.attach('wide-grid-performance.json', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ rows: 5000, columns: 240, renderedHeaders, renderedCells, horizontalScrollMs: scroll.elapsedMs, maxScrollLeft: scroll.maxScrollLeft }, null, 2))
  })
})

test('result table zoom responds to Ctrl shortcuts without disabling virtualization', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible({ timeout: 10_000 })

  const grid = page.getByLabel('query results grid')
  const zoom = page.getByTestId('result-grid-zoom-level')
  const readZoom = async () => Number((await zoom.textContent())?.replace('%', '') || 0)
  await grid.focus()
  const initial = await readZoom()

  await page.keyboard.down('Control')
  await page.keyboard.press('+')
  await page.keyboard.up('Control')
  await expect.poll(readZoom).toBeGreaterThan(initial)

  const afterPlus = await readZoom()
  await grid.dispatchEvent('wheel', { deltaY: -100, ctrlKey: true })
  await expect.poll(readZoom).toBeGreaterThan(afterPlus)
  expect(await grid.locator('[data-result-row]').count()).toBeLessThan(80)
})
