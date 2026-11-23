#!/usr/bin/env node
import { runCli } from './cli-core.ts'

try {
  process.exitCode = await runCli(process.argv.slice(2))
} catch (err) {
  console.error(`network-portal: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
}
