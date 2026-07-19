// niuke-browser.ts — DS-1 (T-2..T-5: NiukeBrowser + BrowserHandle/PageHandle port).
import { chromium } from 'playwright'
import type { Browser, LaunchOptions, Page, Response } from 'playwright'

import { MiDatabaseError, MiError } from '../errors.ts'

export interface BrowserLaunchOptions {
  headless?: boolean
  executablePath?: string
  args?: string[]
}

export interface PageGotoOptions {
  waitForSelector?: string
  timeoutMs?: number
}

export interface PageHandle {
  goto(url: string, opts?: PageGotoOptions): Promise<void>
  evaluate<T>(fn: () => T): Promise<T>
  close(): Promise<void>
}

export interface BrowserHandle {
  newPage(): Promise<PageHandle>
  close(): Promise<void>
}

interface NiukeBrowserDeps {
  chromiumDriver?: typeof chromium
}

/**
 * Port for Playwright's Chromium driver. Production code calls
 * `launch({ headless: true, args: ['--no-sandbox'] })`; tests use
 * `NiukeBrowser.withFake(handle)` to inject an in-memory implementation.
 */
export class NiukeBrowser {
  private readonly chromiumDriver: typeof chromium | undefined
  private fakeHandle: BrowserHandle | undefined

  constructor(deps: NiukeBrowserDeps = {}) {
    this.chromiumDriver = deps.chromiumDriver ?? chromium
  }

  /**
   * Construct a `NiukeBrowser` backed by an in-memory fake — for tests.
   * Calling `launch()` returns the fake `BrowserHandle` directly without
   * touching Playwright.
   */
  static withFake(handle: BrowserHandle): NiukeBrowser {
    const browser = new NiukeBrowser()
    browser.fakeHandle = handle
    return browser
  }
  async launch(options: BrowserLaunchOptions = {}): Promise<BrowserHandle> {
    if (this.fakeHandle !== undefined) return this.fakeHandle
    const driver = this.chromiumDriver
    if (!driver) {
      throw new MiDatabaseError('牛客浏览器启动失败: chromium 驱动未注入')
    }
    let browser: Browser
    try {
      browser = await driver.launch(buildLaunchOptions(options))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new MiDatabaseError(`牛客浏览器启动失败: ${message}`)
    }
    return new PlaywrightBrowserHandle(browser)
  }

  get hasFakeHandle(): boolean {
    return this.fakeHandle !== undefined
  }
}

function buildLaunchOptions(options: BrowserLaunchOptions): LaunchOptions {
  const launchOptions: LaunchOptions = {
    headless: options.headless ?? true,
    args: options.args ?? ['--no-sandbox'],
  }
  if (options.executablePath !== undefined) {
    launchOptions.executablePath = options.executablePath
  }
  return launchOptions
}

class PlaywrightBrowserHandle implements BrowserHandle {
  private readonly browser: Browser

  constructor(browser: Browser) {
    this.browser = browser
  }

  async newPage(): Promise<PageHandle> {
    const page = await this.browser.newPage()
    return new PlaywrightPageHandle(page)
  }

  async close(): Promise<void> {
    await this.browser.close()
  }
}

class PlaywrightPageHandle implements PageHandle {
  private readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  async goto(url: string, opts: PageGotoOptions = {}): Promise<void> {
    const navigationTimeoutMs = opts.timeoutMs ?? 30_000
    let response: Response | null = null
    try {
      response = await this.page.goto(url, { timeout: navigationTimeoutMs })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new MiDatabaseError(`牛客网页面访问失败: ${message}`)
    }
    if (!response) {
      throw new MiDatabaseError(`牛客网页面访问失败: ${url} 没有响应`)
    }
    if (opts.waitForSelector !== undefined) {
      const timeout = opts.timeoutMs ?? 5000
      await waitForSelectorWithTimeout(this.page, opts.waitForSelector, timeout)
    }
  }

  async evaluate<T>(fn: () => T): Promise<T> {
    try {
      return await this.page.evaluate(fn)
    } catch (err) {
      throw mapEvaluationError(err)
    }
  }

  async close(): Promise<void> {
    await this.page.close()
  }
}

function mapEvaluationError(err: unknown): never {
  if (err instanceof MiError) throw err
  const message = err instanceof Error ? err.message : String(err)
  throw new MiDatabaseError(`牛客页面脚本异常: ${message}`)
}

async function waitForSelectorWithTimeout(
  page: Page,
  selector: string,
  timeoutMs: number,
): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout: timeoutMs })
  } catch {
    throw new MiDatabaseError(`牛客网页面访问超时: ${selector} (${timeoutMs}ms)`)
  }
}
