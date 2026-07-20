// niuke-browser.test.ts — TDD specs for DS-1 (T-2..T-5).
import { existsSync } from 'node:fs'

import { chromium } from 'playwright'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MiDatabaseError } from '../errors.ts'
import {
  type BrowserHandle,
  NiukeBrowser,
  type PageGotoOptions,
  type PageHandle,
} from './niuke-browser.ts'

// Best-effort probe for an installed Chromium. CI without `bunx playwright install chromium`
// will skip the real-browser integration tests; the in-memory fake path remains exercised.
const HAS_CHROMIUM = ((): boolean => {
  try {
    const executable = chromium.executablePath()
    return typeof executable === 'string' && executable.length > 0 && existsSync(executable)
  } catch {
    return false
  }
})()

class CountingBrowserHandle implements BrowserHandle {
  newPageCalls = 0
  closeCalls = 0
  page: PageHandle
  throwOnNewPage: Error | undefined

  constructor(page: PageHandle) {
    this.page = page
  }

  async newPage(): Promise<PageHandle> {
    this.newPageCalls += 1
    if (this.throwOnNewPage) throw this.throwOnNewPage
    return this.page
  }

  async close(): Promise<void> {
    this.closeCalls += 1
  }
}

class CountingPageHandle implements PageHandle {
  gotoCalls: { url: string; opts: PageGotoOptions | undefined }[] = []
  evaluateCalls = 0
  closeCalls = 0
  evaluateThrow: Error | undefined
  gotoResult: 'ok' | 'throw' = 'ok'

  async goto(url: string, opts?: PageGotoOptions): Promise<void> {
    this.gotoCalls.push({ url, opts })
    if (this.gotoResult === 'throw') throw new Error('synthetic goto failure')
  }

  async evaluate<T>(fn: () => T): Promise<T> {
    this.evaluateCalls += 1
    if (this.evaluateThrow) throw this.evaluateThrow
    return fn() as T
  }

  async close(): Promise<void> {
    this.closeCalls += 1
  }
}

describe('NiukeBrowser.launch — fake injection path (T-2/T-5)', () => {
  it('returns the injected BrowserHandle without touching Playwright', async () => {
    const page = new CountingPageHandle()
    const browser = new CountingBrowserHandle(page)

    const niuke = NiukeBrowser.withFake(browser)
    const handle = await niuke.launch({ headless: true, args: ['--no-sandbox'] })

    expect(handle).toBe(browser)
    expect(niuke.hasFakeHandle).toBe(true)
    expect(browser.newPageCalls).toBe(0)
    expect(browser.closeCalls).toBe(0)
  })

  it('newPage() returns the injected PageHandle', async () => {
    const page = new CountingPageHandle()
    const browser = new CountingBrowserHandle(page)
    const niuke = NiukeBrowser.withFake(browser)
    const handle = await niuke.launch({ headless: true, args: ['--no-sandbox'] })

    const opened = await handle.newPage()
    expect(opened).toBe(page)
    expect(browser.newPageCalls).toBe(1)
  })

  it('runs BrowserHandle.close inside finally even when newPage throws (T-5)', async () => {
    const page = new CountingPageHandle()
    const browser = new CountingBrowserHandle(page)
    browser.throwOnNewPage = new Error('boom')
    const niuke = NiukeBrowser.withFake(browser)
    const handle = await niuke.launch({ headless: true, args: ['--no-sandbox'] })

    let captured: unknown
    try {
      await handle.newPage()
    } catch (err) {
      captured = err
    } finally {
      await handle.close()
    }

    expect(captured).toBeInstanceOf(Error)
    expect(browser.closeCalls).toBe(1)
  })

  it('runs both page.close and browser.close in finally even when page.evaluate throws (T-5)', async () => {
    const page = new CountingPageHandle()
    page.evaluateThrow = new Error('evaluate failed')
    const browser = new CountingBrowserHandle(page)
    const niuke = NiukeBrowser.withFake(browser)
    const handle = await niuke.launch({ headless: true, args: ['--no-sandbox'] })

    let captured: unknown
    try {
      const opened = await handle.newPage()
      try {
        await opened.evaluate(() => 1)
      } catch (err) {
        captured = err
      } finally {
        await opened.close()
      }
    } finally {
      await handle.close()
    }

    expect(captured).toBeInstanceOf(Error)
    expect(page.closeCalls).toBe(1)
    expect(browser.closeCalls).toBe(1)
  })
})

describe('PageHandle — fake path verifies option passing (T-3/T-4)', () => {
  it('PageHandle.goto forwards waitForSelector + timeoutMs to the wrapped page (T-3)', async () => {
    const page = new CountingPageHandle()
    const niuke = NiukeBrowser.withFake(new CountingBrowserHandle(page))
    const handle = await niuke.launch()
    const opened = await handle.newPage()

    await opened.goto('https://example.com/list', {
      waitForSelector: '.question-list-item',
      timeoutMs: 1000,
    })

    expect(page.gotoCalls).toHaveLength(1)
    expect(page.gotoCalls[0]?.url).toBe('https://example.com/list')
    expect(page.gotoCalls[0]?.opts).toEqual({
      waitForSelector: '.question-list-item',
      timeoutMs: 1000,
    })
  })

  it('PageHandle.evaluate returns the function return value (T-4)', async () => {
    const page = new CountingPageHandle()
    const niuke = NiukeBrowser.withFake(new CountingBrowserHandle(page))
    const handle = await niuke.launch()
    const opened = await handle.newPage()

    const count = await opened.evaluate(() => 42)

    expect(count).toBe(42)
    expect(page.evaluateCalls).toBe(1)
  })
})

describe('Real Chromium integration via Bun.serve fixture (T-2/T-3/T-4)', () => {
  let server: ReturnType<typeof Bun.serve>
  let port = 0

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/list') {
          return new Response(
            '<!doctype html><html><body><ul class="question-list-item">A</ul><ul class="question-list-item">B</ul><ul class="question-list-item">C</ul></body></html>',
            { headers: { 'content-type': 'text/html; charset=utf-8' } },
          )
        }
        if (url.pathname === '/empty') {
          return new Response('<!doctype html><html><body><p>nothing here</p></body></html>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          })
        }
        if (url.pathname === '/boom') {
          return new Response(
            '<!doctype html><html><body><script>throw new Error("upstream kaboom");</script><noscript>ns</noscript></body></html>',
            { headers: { 'content-type': 'text/html; charset=utf-8' } },
          )
        }
        return new Response('not found', { status: 404 })
      },
    })
    port = server.port ?? 0
  })

  afterAll(() => {
    if (server) server.stop()
  })

  describe.skipIf(!HAS_CHROMIUM)('chromium binary installed', () => {
    it('NiukeBrowser.launch opens a new page and returns a closeable handle (T-2)', async () => {
      const niuke = new NiukeBrowser()
      const handle = await niuke.launch({ headless: true, args: ['--no-sandbox'] })
      expect(typeof handle.newPage).toBe('function')
      expect(typeof handle.close).toBe('function')

      let page: PageHandle | undefined
      try {
        page = await handle.newPage()
        expect(typeof page.close).toBe('function')
      } finally {
        if (page) await page.close()
        await handle.close()
      }
    })

    it('NiukeBrowser.launch close() resolves without throwing (T-2)', async () => {
      const niuke = new NiukeBrowser()
      const handle = await niuke.launch({ headless: true, args: ['--no-sandbox'] })
      await expect(handle.close()).resolves.toBeUndefined()
    })

    it('PageHandle.goto waits for the selector then resolves (T-3)', async () => {
      const niuke = new NiukeBrowser()
      const handle = await niuke.launch({ headless: true, args: ['--no-sandbox'] })
      const page = await handle.newPage()
      try {
        await page.goto(`http://127.0.0.1:${port}/list`, {
          waitForSelector: '.question-list-item',
          timeoutMs: 5000,
        })
        const count = await page.evaluate(
          // @ts-expect-error -- `document` lives in the browser context, not in the Node lib.
          () => document.querySelectorAll('.question-list-item').length,
        )
        expect(count).toBe(3)
      } finally {
        await page.close()
        await handle.close()
      }
    })

    it('PageHandle.goto rejects with MiDatabaseError when waitForSelector times out (T-3)', async () => {
      const niuke = new NiukeBrowser()
      const handle = await niuke.launch({ headless: true, args: ['--no-sandbox'] })
      const page = await handle.newPage()
      try {
        await expect(
          page.goto(`http://127.0.0.1:${port}/empty`, {
            waitForSelector: '.question-list-item',
            timeoutMs: 250,
          }),
        ).rejects.toBeInstanceOf(MiDatabaseError)
      } finally {
        await page.close()
        await handle.close()
      }
    })

    it('PageHandle.evaluate rejects with MiDatabaseError when the page script throws (T-4)', async () => {
      const niuke = new NiukeBrowser()
      const handle = await niuke.launch({ headless: true, args: ['--no-sandbox'] })
      const page = await handle.newPage()
      try {
        await page.goto(`http://127.0.0.1:${port}/boom`, { timeoutMs: 5000 })
        await expect(
          // @ts-expect-error -- `document` lives in the browser context, not in the Node lib.
          page.evaluate(() => document.body.innerText),
        ).rejects.toBeInstanceOf(MiDatabaseError)
      } finally {
        await page.close()
        await handle.close()
      }
    })
  })

  describe.skipIf(HAS_CHROMIUM)('chromium binary NOT installed', () => {
    it('gracefully skips the real-browser integration tests', () => {
      expect(HAS_CHROMIUM).toBe(false)
    })
  })
})
