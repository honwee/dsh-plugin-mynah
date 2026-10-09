// dsh-plugin-mynah — give a DeepSeek Harness agent a talking face.
//
// Registers tools that drive a Mynah realtime digital human
// (https://github.com/honwee/mynah): make it speak, interrupt it, inspect live
// sessions/channels, check health, and feed its knowledge base.
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MynahClient, type MynahConfig } from './client.ts'

export const name = 'mynah'
export const inject = ['tools']

/** Plugin configuration (every field also falls back to MYNAH_* environment variables). */
export interface Config extends MynahConfig {
  /** Max time mynah_speak waits for the avatar to finish its current sentence before speaking (ms). */
  queueTimeoutMs?: number
}

/** Runtime schema used by Cordis to validate the `cordis.yml` row. */
export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().description('Mynah realtime/visitor endpoint, e.g. https://host:8443 (env MYNAH_URL)'),
  adminUrl: Schema.string().description('Mynah admin endpoint, e.g. https://host:9443 (env MYNAH_ADMIN_URL)'),
  username: Schema.string().description('Admin username (env MYNAH_USER)'),
  password: Schema.string().role('secret').description('Admin password (env MYNAH_PASSWORD)'),
  token: Schema.string().role('secret').description('Pre-issued admin JWT instead of username/password (env MYNAH_TOKEN)'),
  insecureTls: Schema.boolean().description('Accept self-signed TLS; defaults to true for 127.0.0.1/localhost'),
  queueTimeoutMs: Schema.number().min(0).default(90_000).description('Max wait for the current sentence to finish before a queued mynah_speak talks (ms)'),
})

export function apply(ctx: Context, config: Config = { queueTimeoutMs: 90_000 }) {
  config = { queueTimeoutMs: 90_000, ...config }
  const mynah = new MynahClient(config)
  const text = (s: string) => [{ type: 'text' as const, text: s }]

  ctx.tools.register(defineTool({
    name: 'mynah_speak',
    description: 'Make the Mynah digital human say something to the person watching it. Use type="echo" to speak the given text verbatim (recommended: you already decided what to say), or type="chat" to let Mynah\'s own conversation brain answer the text. By default the call QUEUES: if the avatar is still talking it waits for that sentence to finish, then speaks, so you can issue several speak calls back to back. Set interrupt=true to cut it off instead. Requires a live session id (see mynah_sessions).',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Live Mynah session id (from mynah_sessions)' },
      text: { type: 'string', required: true, description: 'What the avatar should say (echo) or respond to (chat). Keep it short and spoken-style.' },
      type: { type: 'string', enum: ['echo', 'chat'], description: 'echo = speak verbatim (default); chat = route through Mynah brain' },
      interrupt: { type: 'boolean', description: 'true = cut off current speech and talk now; false/omitted = wait for current speech to finish, then talk (default)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, session_id: { type: 'string' }, type: { type: 'string' }, chars: { type: 'integer' }, waited_ms: { type: 'integer' } } },
      render: (_a, v) => text(`Mynah is speaking (${v.type}, ${v.chars} chars) in session ${v.session_id}${v.waited_ms ? `, after waiting ${(v.waited_ms / 1000).toFixed(1)}s for the previous sentence` : ''}.`),
    },
    async execute(args, exec) {
      if (!args.text.trim()) throw new Error('text must not be empty')
      const type = (args.type ?? 'echo') as 'echo' | 'chat'
      const interrupt = args.interrupt === true
      let waited = 0
      if (!interrupt) {
        // Mynah itself does not queue: a new /human call replaces the current turn.
        // Wait (bounded) until the avatar is quiet so consecutive sentences do not clip.
        const t0 = Date.now()
        while (Date.now() - t0 < config.queueTimeoutMs!) {
          if (exec.signal.aborted) throw new Error('aborted')
          if (!(await mynah.isSpeaking(args.session_id, exec.signal))) break
          await new Promise((r) => setTimeout(r, 150))
        }
        waited = Date.now() - t0
      }
      await mynah.speak(args.session_id, args.text, type, interrupt, exec.signal)
      return { ok: true, session_id: args.session_id, type, chars: args.text.length, waited_ms: waited }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mynah_interrupt',
    description: 'Stop the Mynah digital human mid-sentence in a live session.',
    parameters: { session_id: { type: 'string', required: true, description: 'Live Mynah session id' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } }, render: () => text('Mynah stopped speaking.') },
    async execute(args, exec) { await mynah.interrupt(args.session_id, exec.signal); return { ok: true } },
  }))

  ctx.tools.register(defineTool({
    name: 'mynah_action',
    description: 'Make the Mynah digital human perform a gesture in a live session, e.g. "wave" (挥手). Use it to greet or to punctuate what it says. Gesture ids come from mynah_channels (actions per channel) or default to "wave".',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Live Mynah session id' },
      action: { type: 'string', description: 'Gesture id, default "wave"' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, action: { type: 'string' } } }, render: (_a, v) => text(`Mynah performed gesture "${v.action}".`) },
    async execute(args, exec) { const action = args.action || 'wave'; await mynah.action(args.session_id, action, exec.signal); return { ok: true, action } },
  }))

  ctx.tools.register(defineTool({
    name: 'mynah_sessions',
    description: 'List live Mynah sessions (people currently connected to a digital human). Returns session ids usable with mynah_speak.',
    parameters: {},
    output: {
      schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, created_at: { type: 'string' }, turns: { type: 'integer' }, speaking: { type: 'boolean' }, voice_enabled: { type: 'boolean', description: 'visitor microphone is on' } } } },
      render: (_a, v) => text(v.length ? v.map(s => `- ${s.id} (turns=${s.turns}, speaking=${s.speaking}, mic=${s.voice_enabled ? 'on' : 'off'}, since ${s.created_at})`).join('\n') : 'No live sessions. Ask the user to open a Mynah channel page first.'),
    },
    isConcurrencySafe: () => true,
    async execute(_a, exec) {
      const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
      return (await mynah.sessions(exec.signal)).map((s: any) => ({ id: str(s.id), created_at: str(s.created_at), turns: Number.isFinite(Number(s.turns)) ? Math.trunc(Number(s.turns)) : 0, speaking: !!s.speaking, voice_enabled: !!s.voice }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mynah_channels',
    description: 'List published Mynah channels (shareable digital-human pages) with their visitor URLs and the gesture ids (actions) each channel\'s avatar supports.',
    parameters: {},
    output: {
      schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'integer' }, slug: { type: 'string' }, name: { type: 'string' }, enabled: { type: 'boolean' }, access_mode: { type: 'string' }, url: { type: 'string' }, actions: { type: 'array', items: { type: 'string' } } } } },
      render: (_a, v) => text(v.length ? v.map(c => `- [${c.enabled ? 'on' : 'off'}] ${c.name} (${c.access_mode}) ${c.url}${(c.actions ?? []).length ? ' gestures: ' + (c.actions ?? []).join(',') : ''}`).join('\n') : 'No channels published yet.'),
    },
    isConcurrencySafe: () => true,
    async execute(_a, exec) {
      const list = await mynah.channels(exec.signal)
      return Promise.all(list.map(async (c: any) => {
        let actions: string[] = []
        if (c.enabled) { try { const cfg = await mynah.channelConfig(String(c.slug), exec.signal); actions = Array.isArray(cfg?.actions) ? cfg.actions.map(String) : [] } catch { /* channel page may be private */ } }
        return { id: Math.trunc(Number(c.id)) || 0, slug: String(c.slug ?? ''), name: String(c.name ?? ''), enabled: !!c.enabled, access_mode: String(c.access_mode ?? ''), url: `${mynah.baseUrl}/channel/${c.slug}`, actions }
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mynah_status',
    description: 'Health of the Mynah stack (realtime core, avatar engines, ASR, TTS, database).',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_a, v) => text('```json\n' + JSON.stringify(v, null, 2).slice(0, 4000) + '\n```') },
    isConcurrencySafe: () => true,
    async execute(_a, exec) { return await mynah.health(exec.signal) },
  }))

  ctx.tools.register(defineTool({
    name: 'mynah_kb_add',
    description: 'Add a text document to a Mynah knowledge base so the digital human answers from it. Omit kb_id to use the first knowledge base.',
    parameters: {
      text: { type: 'string', required: true, description: 'Document body (plain text / markdown)' },
      filename: { type: 'string', description: 'Display name, e.g. "pricing-2026.md"' },
      kb_id: { type: 'integer', description: 'Knowledge base id (see Mynah console → 知识库)' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => text('Document added: ' + JSON.stringify(v).slice(0, 500)) },
    async execute(args, exec) {
      let kbId = args.kb_id
      if (kbId == null) {
        const list = await mynah.kbs(exec.signal)
        if (!list.length) throw new Error('No knowledge base exists in Mynah yet; create one in the console first')
        kbId = list[0].id
      }
      return await mynah.kbAddText(kbId, args.filename || `agent-${Date.now()}.md`, args.text, exec.signal)
    },
  }))

  console.log(`[dsh-plugin-mynah] ready → realtime ${mynah.baseUrl}, admin ${mynah.adminUrl}`)
}

export { MynahClient } from './client.ts'
