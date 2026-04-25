import { readSync, appendFileSync, readFileSync, mkdirSync, existsSync } from "fs"
import { spawnSync } from "child_process"
import { homedir } from "os"
import { join, dirname, basename, resolve } from "path"
import db from "./db.json"
import pkg from "./package.json"
import type { Entry } from "./types"

const DB = db as Record<string, Entry>
const keys = Object.keys(DB)

// --- colors ---

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR && !process.env.CI
const IS_INTERACTIVE = process.stdin.isTTY && !process.env.CI

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
}

function c(color: keyof typeof C, text: string): string {
  return USE_COLOR ? `${C[color]}${text}${C.reset}` : text
}

// --- helpers ---

function getOwner(key: string): string {
  return key.includes(".prototype.") ? key.split(".prototype.")[0] : key.split(".")[0]
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}

// --- search ---

function fuzzySearch(query: string, candidates = keys, limit = 10): string[] {
  if (query.length > 200) return []
  const q = query.toLowerCase()
  const exact: string[] = []
  const methodExact: string[] = []
  const prefix: string[] = []
  const contains: string[] = []

  for (const key of candidates) {
    const k = key.toLowerCase()
    const method = k.split(".").pop() ?? k
    if (k === q) exact.push(key)
    else if (method === q) methodExact.push(key)
    else if (k.startsWith(q)) prefix.push(key)
    else if (k.includes(q)) contains.push(key)
  }

  return [...exact, ...methodExact, ...prefix, ...contains].slice(0, limit)
}

function suggest(query: string, candidates = keys, limit = 3): string[] {
  if (query.length > 100) return []
  const q = query.toLowerCase()
  const threshold = Math.floor(q.length / 4) + 1
  return candidates
    .map(key => ({ key, dist: levenshtein(q, (key.split(".").pop() ?? key).toLowerCase()) }))
    .filter(({ dist }) => dist <= threshold)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit)
    .map(({ key }) => key)
}

// --- filters ---

function filterByOwner(owner: string, candidates = keys): string[] {
  const o = owner.toLowerCase()
  return candidates.filter(k => getOwner(k).toLowerCase() === o)
}

function filterBySince(year: number, candidates = keys): string[] {
  return candidates.filter(k => {
    const y = DB[k].year
    return y !== undefined && y >= year
  })
}

// --- format ---

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*`([^`]+)`\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
}

function extractMDN(doc: string): { text: string; url: string | null } {
  const match = doc.match(/\[MDN Reference\]\((https?:\/\/[^)]+)\)/)
  return {
    text: stripMarkdown(doc.replace(/\n?\[MDN Reference\]\([^)]+\)/g, "").trim()),
    url: match?.[1] ?? null,
  }
}

function formatEntry(entry: Entry): string {
  const width = process.stdout.columns ?? 72
  const lines: string[] = [""]

  // header: key left, ES year right
  const yearStr = entry.year ? `ES${entry.year}` : ""
  const pad = Math.max(1, width - entry.key.length - yearStr.length)
  lines.push(c("bold", entry.key) + " ".repeat(pad) + c("dim", yearStr))
  lines.push(c("dim", "─".repeat(width)))
  lines.push("")

  // signatures
  for (const sig of entry.signatures) lines.push(c("bold", sig))

  // description
  if (entry.doc) {
    const { text, url } = extractMDN(entry.doc)
    if (text) {
      lines.push("")
      lines.push(text.split("\n").map(l => "  " + l).join("\n"))
    }
    if (url) {
      lines.push("")
      lines.push(c("dim", `  ↗  ${url.replace("https://", "")}`))
    }
  }

  // parameters
  if (entry.params.length) {
    lines.push("")
    lines.push(c("bold", "  PARAMETERS"))
    const nameWidth = Math.max(...entry.params.map(p => p.name.length)) + 2
    for (const p of entry.params) {
      lines.push(`    ${c("bold", p.name.padEnd(nameWidth))}${c("dim", p.doc)}`)
    }
  }

  // returns
  if (entry.returns) {
    lines.push("")
    lines.push(`  ${c("bold", "RETURNS")}  ${c("dim", entry.returns)}`)
  }

  lines.push("")
  return lines.join("\n")
}

function formatEntryJson(entry: Entry): string {
  const { text, url } = extractMDN(entry.doc)
  return JSON.stringify({ ...entry, doc: text, mdnUrl: url }, null, 2)
}

// --- output ---

const PAGER_ALLOWLIST = new Set(["less", "more", "most", "bat", "pg", "cat"])

function resolvePager(): string {
  const raw = (process.env.PAGER ?? "less").split(/\s+/)[0]
  return PAGER_ALLOWLIST.has(basename(raw)) ? raw : "less"
}

function print(output: string): void {
  if (!process.stdout.isTTY) {
    process.stdout.write(output)
    return
  }
  const lineCount = output.split("\n").length
  if (lineCount <= (process.stdout.rows ?? 24)) {
    process.stdout.write(output)
    return
  }
  const pager = resolvePager()
  const flags = pager === "bat" ? ["--paging=always", "--color=always"] : ["-R"]
  const result = spawnSync(pager, flags, {
    input: output,
    stdio: ["pipe", "inherit", "inherit"],
  })
  if (result.error) process.stdout.write(output)
}

// --- list ---

function printList(candidates: string[]): void {
  const groups: Record<string, string[]> = {}
  for (const key of candidates) {
    const owner = getOwner(key)
    ;(groups[owner] ??= []).push(key)
  }
  const lines: string[] = []
  for (const [owner, entries] of Object.entries(groups).sort()) {
    lines.push(c("bold", owner))
    for (const e of entries) lines.push(c("dim", `  ${e}`))
  }
  print(lines.join("\n") + "\n")
}

// --- fzf ---

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

function selfCmd(): string {
  const path = shellQuote(process.argv[1])
  return process.argv[1].endsWith(".ts") ? `bun run ${path}` : path
}

function runFzf(candidates = keys): void {
  const check = spawnSync("which", ["fzf"], { stdio: "pipe" })
  if (check.status !== 0) {
    console.error(c("dim", "fzf not found. Install: brew install fzf"))
    process.exit(1)
  }

  const proc = spawnSync(
    "fzf",
    ["--ansi", "--preview", `${selfCmd()} '{}'`, "--preview-window", "right:60%:wrap", "--height", "80%"],
    { input: candidates.join("\n"), stdio: ["pipe", "pipe", "inherit"] }
  )

  const selected = (proc.stdout?.toString() ?? "").trim()
  if (selected && DB[selected]) print(formatEntry(DB[selected]))
}

// --- completions ---

function printCompletion(shell: string): void {
  if (shell === "zsh") {
    console.log(`_js_ref() {
  local -a completions
  completions=(\${(f)"\$(js-ref --list-keys 2>/dev/null)"})
  _describe 'js-ref entries' completions
}
compdef _js_ref js-ref`)
  } else if (shell === "bash") {
    console.log(`_js_ref() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local IFS=$'\\n'
  COMPREPLY=(\$(compgen -W "\$(js-ref --list-keys 2>/dev/null)" -- "\$cur"))
}
complete -F _js_ref js-ref`)
  } else if (shell === "fish") {
    console.log(`complete -c js-ref -f -a "(js-ref --list-keys 2>/dev/null)"`)
  } else {
    console.error(`Unknown shell: ${shell}. Use zsh, bash, or fish.`)
    process.exit(1)
  }
}

// --- history ---

function historyPath(): string {
  const home = homedir()
  const xdg = process.env.XDG_DATA_HOME
  let base: string
  if (xdg) {
    const resolved = resolve(xdg)
    base = resolved.startsWith(home + "/") || resolved === home
      ? resolved
      : join(home, ".local", "share")
  } else {
    base = join(home, ".local", "share")
  }
  return join(base, "js-ref", "history")
}

function appendHistory(key: string): void {
  try {
    const p = historyPath()
    if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true })
    appendFileSync(p, key + "\n", "utf8")
  } catch {}
}

function readHistory(limit = 20): string[] {
  try {
    const lines = readFileSync(historyPath(), "utf8").trimEnd().split("\n")
    const seen = new Set<string>()
    const result: string[] = []
    for (let i = lines.length - 1; i >= 0; i--) {
      const k = lines[i].trim()
      if (k && DB[k] && !seen.has(k)) {
        seen.add(k)
        result.push(k)
        if (result.length >= limit) break
      }
    }
    return result
  } catch {
    return []
  }
}

function printHistory(): void {
  const entries = readHistory()
  if (!entries.length) {
    console.log(c("dim", "No history yet."))
    process.exit(0)
  }
  console.log(`\n${c("bold", "Recent entries:")}\n`)
  entries.forEach((k, i) => console.log(`  ${c("dim", String(i + 1).padStart(2))}  ${k}`))
  console.log()
  const chosen = IS_INTERACTIVE ? pickInteractive(entries) : entries[0]
  print(formatEntry(DB[chosen]))
  appendHistory(chosen)
}

// --- help ---

function printHelp(): void {
  console.log(`
${c("bold", "js-ref")} — JavaScript built-in and DOM documentation

${c("bold", "Usage:")}
  js-ref <query>                search built-ins and DOM APIs
  js-ref Array.prototype.map    exact lookup
  js-ref --only <owner> [query] filter by owner (e.g. Array, Promise)
  js-ref --since <year> [query] filter by ES year (e.g. 2022)
  js-ref --fzf                  interactive search with fzf
  js-ref --history              show recently viewed entries
  js-ref --json                 output as JSON (machine-readable)
  js-ref --first                auto-pick first match, no prompt
  js-ref --list                 list all entries
  js-ref --completion <shell>   print shell completion script (zsh/bash/fish)
  js-ref --version              print version
  js-ref --help                 show this help

${c("bold", "Examples:")}
  js-ref map
  js-ref --only Array
  js-ref --only Array map
  js-ref --since 2022
  js-ref --since 2022 at
  js-ref --fzf
  js-ref --completion zsh >> ~/.zshrc
`)
}

// --- interactive picker ---

function pickInteractive(matches: string[]): string {
  process.stdout.write(c("dim", "Pick a number (or press Enter to show first): "))
  const buf = Buffer.alloc(16)
  const n = readSync(0, buf, 0, buf.length, null)
  const input = buf.slice(0, n).toString().trim()
  const idx = input ? parseInt(input, 10) - 1 : 0
  return matches[Number.isNaN(idx) ? 0 : Math.max(0, Math.min(idx, matches.length - 1))]
}

// --- main ---

function main(): void {
  const argv = process.argv.slice(2)

  let only: string | null = null
  let since: number | null = null
  let listMode = false
  let fzfMode = false
  let historyMode = false
  let jsonMode = false
  let firstMode = false
  let completion: string | null = null
  const positional: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--only" && argv[i + 1] !== undefined) {
      only = argv[++i]
      if (!only) { console.error(c("dim", "--only requires a non-empty owner name")); process.exit(1) }
    } else if (arg === "--since" && argv[i + 1]) {
      since = parseInt(argv[++i], 10)
      if (Number.isNaN(since) || since < 5 || since > 2100) {
        console.error(c("dim", `Invalid year: "${argv[i]}". Use e.g. --since 2022`))
        process.exit(1)
      }
    } else if (arg === "--list" || arg === "-l") {
      listMode = true
    } else if (arg === "--list-keys") {
      for (const key of keys) console.log(key)
      process.exit(0)
    } else if (arg === "--fzf") {
      fzfMode = true
    } else if (arg === "--history") {
      historyMode = true
    } else if (arg === "--json") {
      jsonMode = true
    } else if (arg === "--first") {
      firstMode = true
    } else if (arg === "--completion" && argv[i + 1]) {
      completion = argv[++i]
    } else if (arg === "--version" || arg === "-v") {
      console.log(pkg.version)
      process.exit(0)
    } else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else if (!arg.startsWith("-")) {
      positional.push(arg)
    }
  }

  if (!argv.length) {
    printHelp()
    process.exit(0)
  }

  if (historyMode) {
    printHistory()
    process.exit(0)
  }

  if (completion) {
    printCompletion(completion)
    process.exit(0)
  }

  let candidates = keys
  if (only) {
    candidates = filterByOwner(only, candidates)
    if (!candidates.length) {
      console.log(c("dim", `No entries found for owner: "${only}"`))
      console.log(c("dim", "Tip: use --list to see all available owners"))
      process.exit(1)
    }
  }
  if (since !== null && !Number.isNaN(since)) {
    candidates = filterBySince(since, candidates)
    if (!candidates.length) {
      console.log(c("dim", `No entries found for --since ${since}`))
      process.exit(1)
    }
  }

  if (fzfMode) {
    runFzf(candidates)
    process.exit(0)
  }

  if (listMode || (!positional.length && (only || since !== null))) {
    printList(candidates)
    process.exit(0)
  }

  const query = positional[0]

  const output = (entry: Entry) =>
    jsonMode ? process.stdout.write(formatEntryJson(entry) + "\n") : print(formatEntry(entry))

  if (DB[query] && candidates.includes(query)) {
    appendHistory(query)
    output(DB[query])
    process.exit(0)
  }

  const matches = fuzzySearch(query, candidates)

  if (!matches.length) {
    if (jsonMode) process.stdout.write(JSON.stringify({ error: `No results for "${query}"` }) + "\n")
    else {
      console.log(c("dim", `No results for "${query}"`))
      const hints = suggest(query, candidates)
      if (hints.length) {
        console.log(c("dim", "\nDid you mean?"))
        for (const s of hints) console.log(`  ${c("dim", s)}`)
        console.log()
      }
    }
    process.exit(1)
  }

  if (jsonMode) {
    const results = firstMode ? [matches[0]] : matches
    process.stdout.write(JSON.stringify(results.map(k => {
      const { text, url } = extractMDN(DB[k].doc)
      return { ...DB[k], doc: text, mdnUrl: url }
    }), null, 2) + "\n")
    results.forEach(k => appendHistory(k))
    process.exit(0)
  }

  if (matches.length === 1) {
    appendHistory(matches[0])
    output(DB[matches[0]])
    process.exit(0)
  }

  if (firstMode) {
    appendHistory(matches[0])
    output(DB[matches[0]])
    process.exit(0)
  }

  if (matches.length <= 5) {
    const out = matches.map(k => formatEntry(DB[k])).join("\n" + c("dim", "─".repeat(process.stdout.columns ?? 72)) + "\n")
    print(out)
    matches.forEach(k => appendHistory(k))
    process.exit(0)
  }

  // 6+ matches: show list + first entry
  console.log(`\n${c("bold", `Found ${matches.length} matches for "${query}"`)}\n`)
  matches.forEach((m, i) => console.log(`  ${c("dim", String(i + 1).padStart(2))}  ${m}`))
  console.log()
  if (IS_INTERACTIVE) {
    const chosen = pickInteractive(matches)
    appendHistory(chosen)
    output(DB[chosen])
  } else {
    console.log(c("dim", `Showing first result. Use --first or --json for scripting.`))
    appendHistory(matches[0])
    output(DB[matches[0]])
  }
}

main()
