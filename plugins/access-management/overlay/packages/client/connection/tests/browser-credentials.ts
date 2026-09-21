import type { Context } from '@deepseek-ai/cordis'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'

/** Key standing for the single record a spec seeded through {@link RecordCredentials.record}. */
const SEEDED = '\u0000seeded'

/** Credential-key text; the seam's key is a branded string. */
function keyText(key: unknown): string {
  return typeof key === 'string' ? key : String(key)
}

/**
 * Mutable credential-record double for Connection authentication tests. It
 * keeps one record per key, and the `record` accessors address a seeded
 * single record so a spec that owns exactly one key reads and writes it
 * without naming the key authentication happens to use.
 */
export class RecordCredentials {
  private readonly records = new Map<string, CredentialRecord>()
  discardWrites = false
  reads = 0
  modifies = 0

  /** The spec-seeded record, or the sole stored record when no seed is set. */
  get record(): CredentialRecord | undefined {
    const seeded = this.records.get(SEEDED)
    if (seeded !== undefined) return seeded
    return this.records.values().next().value
  }

  set record(value: CredentialRecord | undefined) {
    this.records.delete(SEEDED)
    if (value === undefined) {
      this.records.clear()
      return
    }
    this.records.set(SEEDED, value)
  }

  readRecord(key: unknown): Promise<CredentialRecord | undefined> {
    this.reads += 1
    return Promise.resolve(this.records.get(SEEDED) ?? this.records.get(keyText(key)))
  }

  async modifyRecord(
    key: unknown,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    this.modifies += 1
    const address = this.records.has(SEEDED) ? SEEDED : keyText(key)
    const next = await mutate(this.records.get(address))
    if (this.discardWrites) return undefined
    if (next !== undefined) this.records.set(address, next)
    return this.records.get(address)
  }

  deleteRecord(key?: unknown): Promise<void> {
    if (key === undefined) {
      // Spec-facing single-record call: drop whichever record `record` reads.
      if (!this.records.delete(SEEDED)) this.records.clear()
      return Promise.resolve()
    }
    this.records.delete(keyText(key))
    return Promise.resolve()
  }
}

/** Provide the record operations Connection needs during authentication setup. */
export function provideBrowserCredentials(ctx: Context): void {
  ctx.provide('credentials', new RecordCredentials() as unknown as CredentialProvider)
}
