import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as mynahPlugin from '../src/index.ts'

// A tiny fake Mynah: realtime + admin on one plain-HTTP port.
const calls: Array<{ path: string; body: any; auth?: string }> = []
let server: Server; let base = ''
beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null
      calls.push({ path: req.url!, body, auth: req.headers.authorization })
      const send = (o: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)) }
      if (req.url === '/api/v1/auth/login') return send({ code: 0, data: { token: 'jwt-123', must_change_password: false } })
      if (req.url === '/api/v1/sessions') return send({ code: 0, data: [{ id: '100001', created_at: '2026-10-09T03:00:00Z', turns: 2, speaking: false, voice: true }] })
      if (req.url === '/api/v1/channels') return send({ code: 0, data: [{ id: 11, slug: 'test', name: 'Mynah 演示', enabled: true, access_mode: 'public' }] })
      if (req.url === '/channel/test/config') return send({ access_mode: 'public', actions: ['wave'], name: 'Mynah 演示' })
      if (req.url === '/human' || req.url === '/interrupt_talk' || req.url === '/action') return send({ code: 0, data: null })
      send({ code: 0, data: { ok: true } })
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address() as any
  base = `http://127.0.0.1:${addr.port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose())) })

async function boot() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(mynahPlugin, { baseUrl: base, adminUrl: base, username: 'admin', password: 'pw', insecureTls: false })
  return ctx
}

const exec = (name: string, args: any) => ({ callId: 'c1', name, arguments: args, signal: new AbortController().signal, token: Symbol('t') }) as any

describe('dsh-plugin-mynah', () => {
  it('registers the six mynah_* tools into the tool registry', async () => {
    const ctx = await boot()
    const names = ctx.tools.schemas().map((s) => s.name).filter((n) => n.startsWith('mynah_')).sort()
    expect(names).toEqual(['mynah_action', 'mynah_channels', 'mynah_interrupt', 'mynah_kb_add', 'mynah_sessions', 'mynah_speak', 'mynah_status'])
  })
  it('mynah_sessions logs in once and lists live sessions', async () => {
    const ctx = await boot()
    const tool = ctx.tools.get('mynah_sessions')!
    const value = await tool.execute({}, exec('mynah_sessions', {}))
    expect(value).toEqual([{ id: '100001', created_at: '2026-10-09T03:00:00Z', turns: 2, speaking: false, voice_enabled: true }])
    expect(calls.some((c) => c.path === '/api/v1/sessions' && c.auth === 'Bearer jwt-123')).toBe(true)
  })
  it('mynah_speak posts verbatim text to /human with interrupt', async () => {
    const ctx = await boot()
    const tool = ctx.tools.get('mynah_speak')!
    const value = await tool.execute({ session_id: '100001', text: '你好，我是 Mynah。' }, exec('mynah_speak', {}))
    expect(value).toMatchObject({ ok: true, session_id: '100001', type: 'echo' })
    const human = calls.filter((c) => c.path === '/human').at(-1)!
    expect(human.body).toEqual({ sessionid: '100001', text: '你好，我是 Mynah。', type: 'echo', interrupt: true })
  })
  it('mynah_channels reports gestures and mynah_action triggers one', async () => {
    const ctx = await boot()
    const ch = await ctx.tools.get('mynah_channels')!.execute({}, exec('mynah_channels', {})) as any[]
    expect(ch[0]).toMatchObject({ slug: 'test', actions: ['wave'] })
    const v = await ctx.tools.get('mynah_action')!.execute({ session_id: '100001' }, exec('mynah_action', {}))
    expect(v).toEqual({ ok: true, action: 'wave' })
    expect(calls.filter((c) => c.path === '/action').at(-1)!.body).toEqual({ sessionid: '100001', action: 'wave' })
  })
})
