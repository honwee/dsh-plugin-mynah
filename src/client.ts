// Zero-dependency HTTP client for a Mynah instance (https://github.com/honwee/mynah).
// Two surfaces:
//   - realtime (visitor) endpoint, default :8443 — /human, /interrupt_talk, /is_speaking, /channel/<slug>/config
//   - admin endpoint, default :9443 — /api/v1/* behind a JWT obtained via /api/v1/auth/login
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { randomBytes } from 'node:crypto'

export interface MynahConfig {
  /** Realtime / visitor endpoint, e.g. https://do.au56.com:8443 (env MYNAH_URL) */
  baseUrl?: string
  /** Admin console endpoint, e.g. https://do.au56.com:9443 (env MYNAH_ADMIN_URL) */
  adminUrl?: string
  /** Admin login, needed for sessions / channels / status / kb tools (env MYNAH_USER / MYNAH_PASSWORD) */
  username?: string
  password?: string
  /** Pre-issued admin JWT instead of username/password (env MYNAH_TOKEN) */
  token?: string
  /** Accept self-signed TLS. Defaults to true for 127.0.0.1 / localhost, else false (env MYNAH_INSECURE_TLS=1) */
  insecureTls?: boolean
}

export interface MynahSession { id: string; created_at: string; turns: number; speaking: boolean; voice: string }
export interface MynahChannel { id: number; slug: string; name: string; enabled: boolean; access_mode: string; brand_name?: string; version?: number; max_concurrent?: number }

interface ReqInit { method?: string; json?: unknown; multipart?: { field: string; filename: string; content: string; contentType?: string }; auth?: boolean; signal?: AbortSignal }

const trim = (s: string) => s.replace(/\/+$/, '')

export class MynahClient {
  readonly baseUrl: string
  readonly adminUrl: string
  readonly insecureTls: boolean
  private token?: string
  private tokenAt = 0
  constructor(private readonly cfg: MynahConfig = {}) {
    this.baseUrl = trim(cfg.baseUrl || process.env.MYNAH_URL || 'https://127.0.0.1:8443')
    this.adminUrl = trim(cfg.adminUrl || process.env.MYNAH_ADMIN_URL || 'https://127.0.0.1:9443')
    this.token = cfg.token || process.env.MYNAH_TOKEN || undefined
    if (this.token) this.tokenAt = Date.now()
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(this.baseUrl)
    this.insecureTls = cfg.insecureTls ?? (process.env.MYNAH_INSECURE_TLS === '1' || local)
  }

  /** Raw request → parsed body. Unwraps Mynah's {code, msg, data} envelope and throws on non-zero code / non-2xx. */
  private async http(url: string, init: ReqInit = {}): Promise<any> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (init.auth) headers.authorization = 'Bearer ' + (await this.adminToken(init.signal))
    let body: Buffer | undefined
    if (init.multipart) {
      const b = '----mynah' + randomBytes(12).toString('hex')
      const m = init.multipart
      const head = `--${b}\r\nContent-Disposition: form-data; name="${m.field}"; filename="${m.filename.replace(/"/g, '')}"\r\nContent-Type: ${m.contentType || 'text/plain; charset=utf-8'}\r\n\r\n`
      body = Buffer.concat([Buffer.from(head), Buffer.from(m.content, 'utf8'), Buffer.from(`\r\n--${b}--\r\n`)])
      headers['content-type'] = `multipart/form-data; boundary=${b}`
    } else if (init.json !== undefined) {
      body = Buffer.from(JSON.stringify(init.json))
      headers['content-type'] = 'application/json'
    }
    if (body) headers['content-length'] = String(body.length)
    const method = init.method || (body ? 'POST' : 'GET')
    const { status, text } = await this.raw(url, method, headers, body, init.signal)
    let json: any
    try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
    if (status < 200 || status >= 300) throw new Error(`Mynah ${method} ${url} → HTTP ${status}: ${text.slice(0, 300)}`)
    if (json && typeof json === 'object' && 'code' in json && json.code !== 0) throw new Error(`Mynah ${method} ${url} → error ${json.code}: ${json.msg || text.slice(0, 300)}`)
    return json && typeof json === 'object' && 'data' in json ? json.data : json
  }

  private raw(url: string, method: string, headers: Record<string, string>, body?: Buffer, signal?: AbortSignal): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
      const u = new URL(url)
      const fn = u.protocol === 'https:' ? httpsRequest : httpRequest
      const req = fn(u, { method, headers, rejectUnauthorized: !this.insecureTls, signal } as any, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      })
      req.on('error', reject)
      if (body) req.write(body)
      req.end()
    })
  }

  private async adminToken(signal?: AbortSignal): Promise<string> {
    if (this.token && Date.now() - this.tokenAt < 20 * 3600_000) return this.token
    const username = this.cfg.username || process.env.MYNAH_USER
    const password = this.cfg.password || process.env.MYNAH_PASSWORD
    if (!username || !password) throw new Error('Mynah admin credentials missing: set username/password (or MYNAH_USER/MYNAH_PASSWORD), or token (MYNAH_TOKEN)')
    const data = await this.http(`${this.adminUrl}/api/v1/auth/login`, { json: { username, password }, signal })
    this.token = data.token; this.tokenAt = Date.now()
    return this.token!
  }

  // ---- realtime surface (no auth; the session id is the capability) ----
  /** Make the avatar speak. type=echo: verbatim; type=chat: route through Mynah's own brain. */
  speak(sessionid: string, text: string, type: 'echo' | 'chat' = 'echo', interrupt = true, signal?: AbortSignal) {
    return this.http(`${this.baseUrl}/human`, { json: { sessionid, text, type, interrupt }, signal })
  }
  interrupt(sessionid: string, signal?: AbortSignal) { return this.http(`${this.baseUrl}/interrupt_talk`, { json: { sessionid }, signal }) }
  isSpeaking(sessionid: string, signal?: AbortSignal): Promise<boolean> { return this.http(`${this.baseUrl}/is_speaking`, { json: { sessionid }, signal }) }
  channelConfig(slug: string, signal?: AbortSignal) { return this.http(`${this.baseUrl}/channel/${encodeURIComponent(slug)}/config`, { signal }) }

  // ---- admin surface ----
  health(signal?: AbortSignal) { return this.http(`${this.adminUrl}/api/v1/health`, { auth: true, signal }) }
  sessions(signal?: AbortSignal): Promise<MynahSession[]> { return this.http(`${this.adminUrl}/api/v1/sessions`, { auth: true, signal }) }
  channels(signal?: AbortSignal): Promise<MynahChannel[]> { return this.http(`${this.adminUrl}/api/v1/channels`, { auth: true, signal }) }
  kbs(signal?: AbortSignal): Promise<Array<{ id: number; name: string }>> { return this.http(`${this.adminUrl}/api/v1/kb`, { auth: true, signal }) }
  kbAddText(kbId: number, filename: string, text: string, signal?: AbortSignal) {
    return this.http(`${this.adminUrl}/api/v1/kb/${kbId}/documents`, { method: 'POST', multipart: { field: 'file', filename, content: text }, auth: true, signal })
  }
}
