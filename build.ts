import { Project, InterfaceDeclaration, JSDoc } from "ts-morph"
import { writeFileSync } from "fs"
import { resolve, join, basename } from "path"
import type { ParamEntry, Entry, DB } from "./types"

const LIB_DIR = resolve("./node_modules/typescript/lib")

const LIB_FILES = [
  "lib.es5.d.ts",
  "lib.es2015.core.d.ts",
  "lib.es2015.collection.d.ts",
  "lib.es2015.promise.d.ts",
  "lib.es2016.array.include.d.ts",
  "lib.es2017.object.d.ts",
  "lib.es2017.string.d.ts",
  "lib.es2018.promise.d.ts",
  "lib.es2019.array.d.ts",
  "lib.es2019.object.d.ts",
  "lib.es2019.string.d.ts",
  "lib.es2020.bigint.d.ts",
  "lib.es2020.date.d.ts",
  "lib.es2020.intl.d.ts",
  "lib.es2020.number.d.ts",
  "lib.es2020.promise.d.ts",
  "lib.es2020.sharedmemory.d.ts",
  "lib.es2020.string.d.ts",
  "lib.es2020.symbol.wellknown.d.ts",
  "lib.es2021.intl.d.ts",
  "lib.es2021.promise.d.ts",
  "lib.es2021.string.d.ts",
  "lib.es2021.weakref.d.ts",
  "lib.es2022.array.d.ts",
  "lib.es2022.error.d.ts",
  "lib.es2022.intl.d.ts",
  "lib.es2022.object.d.ts",
  "lib.es2022.regexp.d.ts",
  "lib.es2022.string.d.ts",
  "lib.es2023.array.d.ts",
  "lib.es2023.collection.d.ts",
  "lib.es2023.intl.d.ts",
  "lib.es2024.arraybuffer.d.ts",
  "lib.es2024.collection.d.ts",
  "lib.es2024.object.d.ts",
  "lib.es2024.promise.d.ts",
  "lib.es2024.regexp.d.ts",
  "lib.es2024.sharedmemory.d.ts",
  "lib.es2024.string.d.ts",
  "lib.dom.d.ts",
  "lib.dom.iterable.d.ts",
  "lib.dom.asynciterable.d.ts",
]

function yearFromFilename(filename: string): number | undefined {
  const m = basename(filename).match(/lib\.es(\d{4})/)
  if (m) return parseInt(m[1], 10)
  if (basename(filename) === "lib.es5.d.ts") return 5
  return undefined
}

function extractDoc(jsdocs: JSDoc[]): { doc: string; params: ParamEntry[]; returns: string } {
  if (!jsdocs.length) return { doc: "", params: [], returns: "" }
  const jsdoc = jsdocs[jsdocs.length - 1]
  const doc = jsdoc.getDescription().trim().replace(/\n\s*\*/g, "\n").trim()
  const params: ParamEntry[] = []
  let returns = ""

  for (const tag of jsdoc.getTags()) {
    const tagName = tag.getTagName()
    if (tagName === "param") {
      const match = tag.getText().trim().match(/@param\s+(\w+)\s+(.*)/)
      if (match) params.push({ name: match[1], type: "", doc: match[2].replace(/\s*\*\//g, "").trim() })
    } else if (tagName === "returns" || tagName === "return") {
      returns = tag.getText().replace(/@returns?\s*/, "").trim()
    }
  }
  return { doc, params, returns }
}

const ownerMap: Record<string, string> = {
  ArrayConstructor: "Array", StringConstructor: "String", ObjectConstructor: "Object",
  NumberConstructor: "Number", BooleanConstructor: "Boolean", FunctionConstructor: "Function",
  DateConstructor: "Date", RegExpConstructor: "RegExp", ErrorConstructor: "Error",
  MapConstructor: "Map", SetConstructor: "Set", WeakMapConstructor: "WeakMap",
  WeakSetConstructor: "WeakSet", PromiseConstructor: "Promise", SymbolConstructor: "Symbol",
  MathConstructor: "Math", JSONConstructor: "JSON",
}

function buildKey(owner: string, name: string, isStatic: boolean): string {
  const resolved = ownerMap[owner] ?? owner
  if (isStatic) return `${resolved}.${name}`
  return `${owner}.prototype.${name}`
}

function processInterface(iface: InterfaceDeclaration, db: DB, year: number | undefined) {
  const ifaceName = iface.getName()
  const isStatic = ifaceName.endsWith("Constructor") || ifaceName === "Math" || ifaceName === "JSON"

  for (const method of iface.getMethods()) {
    const name = method.getName()
    const key = buildKey(ifaceName, name, isStatic)
    const { doc, params, returns } = extractDoc(method.getJsDocs())
    const typeParams = method.getTypeParameters().map(t => t.getText()).join(", ")
    const paramStr = method.getParameters().map(p => p.getText()).join(", ")
    const retType = method.getReturnTypeNode()?.getText() ?? ""
    const sig = `${name}${typeParams ? `<${typeParams}>` : ""}(${paramStr})${retType ? `: ${retType}` : ""}`

    if (db[key]) {
      if (!db[key].signatures.includes(sig)) db[key].signatures.push(sig)
      if (!db[key].doc && doc) db[key].doc = doc
      if (year !== undefined && (db[key].year === undefined || year < db[key].year!))
        db[key].year = year
    } else {
      db[key] = { key, signatures: [sig], doc, params, returns, year }
    }
  }

  for (const prop of iface.getProperties()) {
    const name = prop.getName()
    const key = buildKey(ifaceName, name, isStatic)
    const { doc, params, returns } = extractDoc(prop.getJsDocs())
    const type = prop.getTypeNode()?.getText() ?? ""

    if (!db[key]) {
      db[key] = { key, signatures: [`${name}: ${type}`], doc, params, returns, year }
    }
  }
}

const project = new Project({ skipAddingFilesFromTsConfig: true })

console.log("Loading lib files...")
for (const file of LIB_FILES) {
  try {
    project.addSourceFileAtPath(join(LIB_DIR, file))
  } catch {
    console.warn(`  skip: ${file}`)
  }
}

const db: DB = {}

console.log("Parsing interfaces...")
for (const sourceFile of project.getSourceFiles()) {
  const year = yearFromFilename(sourceFile.getFilePath())
  for (const iface of sourceFile.getInterfaces()) {
    processInterface(iface, db, year)
  }
}

console.log(`Extracted ${Object.keys(db).length} entries`)
writeFileSync(join(import.meta.dir, "db.json"), JSON.stringify(db, null, 2))
console.log("Written db.json")
