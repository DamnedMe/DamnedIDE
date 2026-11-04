// Self-check for the release promotion helpers (develop → qa → prod PRs).
// Pure logic only: the real Azure DevOps API is never called.
// Run: node --experimental-strip-types scripts/ado-promotion.check.ts
import assert from 'node:assert/strict'
import {
  resolveEnvBranch,
  extractWorkItemIds,
  isLongLivedBranch,
  promotionTitle,
  promotionDescription,
  promotionConfigKey,
  STAGE_ROLES,
  ADO_DESCRIPTION_MAX
} from '../src/shared/adoPromotion.ts'

// ── resolveEnvBranch ──────────────────────────────────────────────────────
const classic = ['feature/5444', 'develop', 'qa', 'main']
assert.equal(resolveEnvBranch('dev', classic), 'develop')
assert.equal(resolveEnvBranch('qa', classic), 'qa')
assert.equal(resolveEnvBranch('prod', classic), 'main')

const aliases = ['dev', 'test', 'master']
assert.equal(resolveEnvBranch('dev', aliases), 'dev')
assert.equal(resolveEnvBranch('qa', aliases), 'test')
assert.equal(resolveEnvBranch('prod', aliases), 'master')

// case-insensitive, returns the remote spelling
assert.equal(resolveEnvBranch('qa', ['Develop', 'Staging']), 'Staging')

// candidate order: develop before dev
assert.equal(resolveEnvBranch('dev', ['dev', 'develop']), 'develop')

// the override wins when the remote has it, otherwise the candidates apply
assert.equal(resolveEnvBranch('qa', ['develop', 'qa', 'release/qa'], 'release/qa'), 'release/qa')
assert.equal(resolveEnvBranch('qa', ['develop', 'qa'], 'gone'), 'qa')
assert.equal(resolveEnvBranch('qa', ['develop', 'qa'], '  '), 'qa')

// missing branch → null
assert.equal(resolveEnvBranch('qa', ['develop', 'main']), null)
assert.equal(resolveEnvBranch('prod', []), null)

// stages map to the right roles
assert.deepEqual(STAGE_ROLES['dev-qa'], { from: 'dev', to: 'qa' })
assert.deepEqual(STAGE_ROLES['qa-prod'], { from: 'qa', to: 'prod' })

// ── extractWorkItemIds ────────────────────────────────────────────────────
assert.deepEqual(extractWorkItemIds(['Merged PR 4521: #5444 : add x', '#5444 : y #5450', 'fix typo']), [5444, 5450])
assert.deepEqual(extractWorkItemIds(['#12 then #3', 'multi\nline #7']), [3, 7, 12])
assert.deepEqual(extractWorkItemIds(['no refs', '#0 is not an id', '']), [])
assert.deepEqual(extractWorkItemIds([]), [])

// ── isLongLivedBranch ─────────────────────────────────────────────────────
for (const b of ['develop', 'dev', 'development', 'qa', 'test', 'staging', 'main', 'master', 'prod', 'production', 'QA', 'refs/heads/develop']) {
  assert.equal(isLongLivedBranch(b), true, `${b} is long-lived`)
}
for (const b of ['feature/5444', 'bugfix/12', 'release/qa', 'develop-old', '']) {
  assert.equal(isLongLivedBranch(b), false, `${b} is not long-lived`)
}

// ── promotionTitle ────────────────────────────────────────────────────────
assert.equal(promotionTitle('develop', 'qa', 'BE', new Date(2026, 10, 4)), 'Release develop → qa · BE · 2026-11-04')
assert.equal(promotionTitle('qa', 'main', 'FE', new Date(2027, 0, 9)), 'Release qa → main · FE · 2027-01-09')

// ── promotionConfigKey ────────────────────────────────────────────────────
assert.equal(promotionConfigKey('Revoltech', 'Themis_Platform'), 'revoltech/themis_platform')
assert.equal(promotionConfigKey(' revoltech ', 'Themis_Platform'), promotionConfigKey('REVOLTECH', 'themis_platform'))

// ── promotionDescription ──────────────────────────────────────────────────
const small = promotionDescription(
  [{ id: 5444, title: 'Nuova gara', type: 'Product Backlog Item', state: 'Committed' }, { id: 5450 }],
  [{ message: '#5444 : add x\n\nlong body' }, { message: 'fix typo' }]
)
assert.equal(small, [
  '## Work item (2)',
  '',
  '- #5444 Nuova gara (Product Backlog Item · Committed)',
  '- #5450',
  '',
  '## Commit (2)',
  '',
  '- #5444 : add x',
  '- fix typo'
].join('\n'))

// no work items: only the commit section
assert.equal(promotionDescription([], [{ message: 'one' }]), '## Commit (1)\n\n- one')

// big promotion: never above the ADO limit, ends with the '+N altri' tail
const manyItems = Array.from({ length: 120 }, (_, i) => ({ id: 1000 + i, title: `work item numero ${i} con un titolo abbastanza lungo`, type: 'Task', state: 'Done' }))
const manyCommits = Array.from({ length: 300 }, (_, i) => ({ message: `#${1000 + (i % 120)} : commit ${i} che sistema qualcosa di importante` }))
const big = promotionDescription(manyItems, manyCommits)
assert.ok(big.length <= ADO_DESCRIPTION_MAX, `description ${big.length} <= ${ADO_DESCRIPTION_MAX}`)
const tail = big.split('\n').pop() || ''
const m = tail.match(/^… \+(\d+) altri$/)
assert.ok(m, `tail "${tail}" is '… +N altri'`)
const shownEntries = big.split('\n').filter(l => l.startsWith('- ')).length
assert.equal(shownEntries + Number(m![1]), manyItems.length + manyCommits.length, 'shown + hidden = all entries')
assert.ok(big.startsWith('## Work item (120)'), 'work items come first')

// a custom small limit is respected too
const tiny = promotionDescription(manyItems, manyCommits, 200)
assert.ok(tiny.length <= 200, `tiny ${tiny.length} <= 200`)
assert.match(tiny, /… \+\d+ altri$/)

// exactly at the limit: no tail
const exact = promotionDescription([], [{ message: 'x'.repeat(100) }])
assert.equal(promotionDescription([], [{ message: 'x'.repeat(100) }], exact.length), exact)

console.log('ado-promotion: all checks passed')
