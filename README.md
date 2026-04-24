# js-ref

Look up JavaScript documentation directly in your terminal — like `go doc` but for JS.

No internet. No browser. Just type `js-ref map` and get the signature, description, and parameters instantly.

## What's covered

**8785 entries** across two categories:

- **JavaScript built-ins** (ES5 → ES2023) — `Array`, `String`, `Object`, `Promise`, `Map`, `Set`, `Math`, `JSON`, typed arrays, and everything in between. Includes ES version badges so you know exactly when a method was introduced.

- **Browser APIs** (full DOM) — `fetch`, `querySelector`, `addEventListener`, `Canvas`, `WebSockets`, `IntersectionObserver`, the works.

**Why only these two?** Because they're stable. The ES spec and the DOM API don't get breaking changes — what's here today will still be accurate in 5 years. Node.js, Deno, and framework APIs change too fast to keep in a static database without it going stale.

The data is sourced directly from TypeScript's official `lib.es*.d.ts` and `lib.dom.d.ts` files — the same definitions your editor uses for autocomplete.

## Install

```bash
npm install -g @esrid/js-ref
```
Requires [Bun](https://bun.sh).

## Usage

```bash
js-ref map                       # fuzzy search — shows all matches
js-ref Array.prototype.map       # exact lookup
js-ref --only Array              # list all Array methods
js-ref --only Array map          # search "map" within Array only
js-ref --since 2022              # methods introduced in ES2022 or later
js-ref --since 2022 at           # search "at" within ES2022+ only
js-ref --fzf                     # interactive browser with live preview (requires fzf)
js-ref --list                    # list all 8785 entries grouped by owner
js-ref --completion zsh          # print shell completion script
js-ref --help
```

### Examples

```
$ js-ref Promise.all

Promise.all
ES2015
────────────────────────────────────────────────────────────
all<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>[]>

  Creates a Promise that is resolved with an array of results when all
  of the provided Promises resolve, or rejected when any Promise is rejected.

  Parameters:
    values  An array of Promises.
  Returns:  A new Promise.
```

```
$ js-ref fliter

No results for "fliter"

Did you mean?
  Array.prototype.filter
  NodeIterator.prototype.filter
```

## Shell completion

Tab-complete any of the 8785 entry names:

```bash
# zsh
js-ref --completion zsh >> ~/.zshrc && source ~/.zshrc

# bash
js-ref --completion bash >> ~/.bashrc && source ~/.bashrc

# fish
js-ref --completion fish >> ~/.config/fish/completions/js-ref.fish
```


## How it works

At build time, `build.ts` parses TypeScript's lib files using `ts-morph` and extracts every interface method and property — signatures, JSDoc descriptions, parameter docs, and ES year. The result is stored in `db.json` (shipped with the package, no rebuild needed).

At runtime, `index.ts` loads the database and does an in-memory lookup — no network, no file I/O after startup, sub-millisecond queries.

## Rebuild the database

`db.json` ships pre-built. To rebuild from a newer TypeScript version:

```bash
bun install
bun run build:db
```

## License

MIT
