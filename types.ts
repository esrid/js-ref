export type ParamEntry = { name: string; type: string; doc: string }

export type Entry = {
  key: string
  signatures: string[]
  doc: string
  params: ParamEntry[]
  returns: string
  year?: number
}

export type DB = Record<string, Entry>
