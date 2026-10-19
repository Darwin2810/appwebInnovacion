import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, copyFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('Hosting rejects missing config, wrong project, emulator build and stale assets before publication', async () => {
  const repo = fileURLToPath(new URL('../', import.meta.url))
  const directory = await mkdtemp(path.join(tmpdir(), 'exlaider-deploy-'))
  const values = { VITE_FIREBASE_API_KEY: 'fake-public-api', VITE_FIREBASE_AUTH_DOMAIN: 'example-test.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'example-test', VITE_FIREBASE_APP_ID: '1:123:web:test' }
  try {
    await mkdir(path.join(directory, 'scripts')); await mkdir(path.join(directory, 'dist', 'assets'), { recursive: true })
    await symlink(path.join(repo, 'node_modules'), path.join(directory, 'node_modules'), 'junction')
    await copyFile(path.join(repo, 'scripts', 'check-deploy.mjs'), path.join(directory, 'scripts', 'check-deploy.mjs'))
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('VITE_') && name !== 'GCLOUD_PROJECT'))
    const run = project => spawnSync(process.execPath, ['scripts/check-deploy.mjs'], { cwd: directory, env: { ...env, GCLOUD_PROJECT: project || 'example-test' }, encoding: 'utf8' })
    assert.notEqual(run().status, 0)
    await writeFile(path.join(directory, '.env.local'), Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n'))
    await writeFile(path.join(directory, 'dist', 'index.html'), '<script type="module" src="/assets/entry.js"></script>')
    await writeFile(path.join(directory, 'dist', 'assets', 'entry.js'), JSON.stringify(values))
    const mode = (value = 'production') => writeFile(path.join(directory, 'dist', 'build-info.json'), JSON.stringify({ mode: value, emulators: value === 'emulator', projectId: 'example-test' }))
    await mode()
    assert.equal(run().status, 0, run().stderr)
    assert.notEqual(run('another-project').status, 0)
    await mode('emulator'); assert.notEqual(run().status, 0)
    await mode(); await writeFile(path.join(directory, 'dist', 'assets', 'entry.js'), 'old-project')
    assert.notEqual(run().status, 0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
