import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export default class SqlPerformanceReporter implements Reporter {
  private metrics: Record<string, unknown>[] = []

  onTestEnd(test: TestCase, result: TestResult) {
    for (const attachment of result.attachments) {
      if (!attachment.name.endsWith('-performance.json') || !attachment.body) continue
      try {
        this.metrics.push({
          test: test.title,
          status: result.status,
          durationMs: result.duration,
          ...JSON.parse(attachment.body.toString('utf8'))
        })
      } catch { /* malformed optional metric attachment */ }
    }
  }

  onEnd() {
    const directory = resolve('test-results')
    mkdirSync(directory, { recursive: true })
    writeFileSync(resolve(directory, 'sql-performance.json'), JSON.stringify({
      generatedAt: new Date().toISOString(),
      metrics: this.metrics
    }, null, 2))
  }
}
