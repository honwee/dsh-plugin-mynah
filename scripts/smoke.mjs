// Smoke test against a real Mynah: node scripts/smoke.mjs [sessionId "text to say"]
// Reads MYNAH_URL / MYNAH_ADMIN_URL / MYNAH_USER / MYNAH_PASSWORD.
import { MynahClient } from '../dist/client.js'
const m = new MynahClient({})
const [sid, ...rest] = process.argv.slice(2)
console.log('realtime', m.baseUrl, 'admin', m.adminUrl)
const h = await m.health(); console.log('health:', JSON.stringify(h).slice(0, 300))
const ch = await m.channels(); console.log('channels:', ch.map(c => `${c.slug}(${c.enabled ? 'on' : 'off'})`).join(', '))
const ss = await m.sessions(); console.log('sessions:', ss.map(s => `${s.id} turns=${s.turns} speaking=${s.speaking}`).join(', ') || '(none)')
if (sid) { await m.speak(sid, rest.join(' ') || '你好，我是 Mynah。', 'echo', true); console.log('spoke in', sid); await new Promise(r => setTimeout(r, 1500)); console.log('is_speaking:', await m.isSpeaking(sid)) }
