// Keep emulator test diagnostics in the public check summary as well as logs.
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const task = process.argv[2]
if (!['test:cloud', 'test:browser'].includes(task)) throw new Error('Unsupported CI check')
const child = spawn('npm', ['run', task], { stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
  process.stdout.write(chunk)
  output = (output + chunk.toString()).slice(-24000)
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => {
  process.exitCode = code ?? 1
  if (!process.env.GITHUB_ACTIONS) return
  const clean = output.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '')
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### ${task}: ${code === 0 ? 'passed' : 'failed'}\n\n<pre>${clean.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>\n`)
  if (code !== 0) {
    // GitHub truncates a single annotation; retain the failure at the end too.
    const tail = clean.slice(-18000)
    for (let index = 0; index < tail.length; index += 2700) {
      const part = tail.slice(index, index + 2700).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
      console.log(`::error title=${task} diagnostics ${1 + index / 2700}::${part}`)
    }
  }
})
