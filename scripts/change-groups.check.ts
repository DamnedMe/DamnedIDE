// Self-check for the kind-of-file groups of Worktree › Changes.
// Run: node --experimental-strip-types scripts/change-groups.check.ts
import assert from 'node:assert/strict'
import { CHANGE_GROUPS, classifyChange, dirOf, fileNameOf, groupChanges } from '../src/shared/changeGroups.ts'

const cases: [string, string][] = [
  // the rows of the reported screenshot
  ['docs/tecnica/impersonation/impersonation.md', 'docs'],
  ['Themis.Application/Services/StoreManagerService.cs', 'service'],
  ['Themis.Tests/Controllers/UsersControllerEntityInfoTests.cs', 'test'],
  ['Themis.Tests/StoreManagerServiceTests.cs', 'test'],
  ['ThemisAPI/Controllers/UsersController.cs', 'controller'],
  // DB
  ['Themis.Infrastructure/Migrations/20240101_Init.cs', 'db'],
  ['Migrations/ThemisDbContextModelSnapshot.cs', 'db'],
  ['Data/ThemisDbContext.cs', 'db'],
  ['Themis.Infrastructure/Persistence/AppContext.cs', 'db'],
  ['Persistence/Configurations/UserConfiguration.cs', 'db'],
  ['scripts/seed.sql', 'db'],
  // backend layers
  ['Themis.Domain/DTOs/UserDto.cs', 'model'],
  ['Themis.Api/Requests/CreateUserRequest.cs', 'model'],
  ['Themis.Application/Interfaces/IStoreService.cs', 'contract'],
  ['Themis.Application/IUserRepository.cs', 'contract'],
  ['Themis.Infrastructure/Repositories/UserRepository.cs', 'repository'],
  ['Helpers/DateHelper.cs', 'helper'],
  ['src/app/core/functions/date-only.functions.ts', 'helper'],
  ['src/app/core/validators/phone.validator.ts', 'helper'],
  ['src/app/core/functions/date-only.functions.spec.ts', 'test'],
  ['Themis.Application/StringExtensions.cs', 'helper'],
  // frontend
  ['src/app/x/x.component.ts', 'ui'],
  ['src/app/x/x.component.html', 'ui'],
  ['src/app/x/x.service.ts', 'service'],
  ['src/app/x/x.service.spec.ts', 'test'],
  ['x.service.spec.ts', 'test'],
  ['src/app/models/user.model.ts', 'model'],
  ['src/app/x/cost-overview.models.ts', 'model'],
  ['src/app/x/components/y/y.models.ts', 'model'],
  // Angular suffixes beat the backend folder names
  ['src/app/modules/store/services/add-service/add-service.component.html', 'ui'],
  ['src/app/modules/requests/affiliation-opening/affiliation-opening.component.ts', 'ui'],
  ['src/app/modules/backoffice/migrations/migrations.component.ts', 'ui'],
  ['src/app/modules/store/services/x.service.ts', 'service'],
  ['src/app/core/auth.guard.ts', 'ui'],
  ['src/environments/environment.prod.ts', 'config'],
  ['e2e/login.ts', 'test'],
  // config / docs / other
  ['ThemisAPI/appsettings.Development.json', 'config'],
  ['ThemisAPI/ThemisAPI.csproj', 'config'],
  ['ThemisAPI/Properties/launchSettings.json', 'config'],
  ['.github/workflows/release.yml', 'config'],
  ['Dockerfile', 'config'],
  ['README.md', 'docs'],
  ['ThemisAPI/Program.cs', 'other'],
  // Windows separators, any case
  ['Themis.Tests\\Controllers\\UsersControllerEntityInfoTests.cs', 'test'],
  ['ThemisAPI\\CONTROLLERS\\Home.cs', 'controller']
]
for (const [path, expected] of cases) assert.equal(classifyChange(path), expected, path)

assert.equal(fileNameOf('a/b/C.cs'), 'C.cs')
assert.equal(fileNameOf('a\\b\\C.cs'), 'C.cs')
assert.equal(fileNameOf('C.cs'), 'C.cs')
assert.equal(dirOf('a/b/C.cs'), 'a/b')
assert.equal(dirOf('a\\b\\C.cs'), 'a\\b')
assert.equal(dirOf('C.cs'), '', 'repo root')
// nested repos / the IDE's worktrees come with a trailing slash
assert.equal(fileNameOf('inner/'), 'inner')
assert.equal(dirOf('inner/'), '')
assert.equal(fileNameOf('.worktrees/feat-1/'), 'feat-1')
assert.equal(dirOf('.worktrees/feat-1/'), '.worktrees')

// only the non-empty groups, in CHANGE_GROUPS order; inside, by file name then path
const files = [
  'README.md',
  'Themis.Tests/StoreManagerServiceTests.cs',
  'ThemisAPI/Controllers/UsersController.cs',
  'Themis.Application/Services/StoreManagerService.cs',
  'Themis.Tests/Controllers/UsersControllerEntityInfoTests.cs',
  'b/Services/AService.cs',
  'a/Services/AService.cs'
].map(path => ({ path }))
const groups = groupChanges(files)
assert.deepEqual(groups.map(g => g.id), ['controller', 'service', 'test', 'docs'])
assert.deepEqual(groups.map(g => g.label), ['Controller', 'Service', 'Test', 'Documentation'])
assert.deepEqual(groups[1].files.map(f => f.path), [
  'a/Services/AService.cs', 'b/Services/AService.cs', 'Themis.Application/Services/StoreManagerService.cs'
])
assert.deepEqual(groups[2].files.map(f => f.path), [
  'Themis.Tests/StoreManagerServiceTests.cs', 'Themis.Tests/Controllers/UsersControllerEntityInfoTests.cs'
])
assert.equal(groups.reduce((n, g) => n + g.files.length, 0), files.length, 'every file in one group')
assert.deepEqual(groupChanges([]), [])
assert.equal(new Set(CHANGE_GROUPS.map(g => g.id)).size, CHANGE_GROUPS.length, 'unique ids')

console.log('ok — change-groups')
