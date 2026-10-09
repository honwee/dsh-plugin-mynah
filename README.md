# dsh-plugin-mynah

Give your [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent a talking face.

This plugin lets a dsh agent drive a [Mynah](https://github.com/honwee/mynah) realtime digital human: make it speak to the person watching, interrupt it, see who is connected, list published channels, check health, and feed its knowledge base. Mynah is the open-source, self-hosted digital human stack (WebRTC lip-synced video, admin console, channels, knowledge base, free EdgeTTS by default, runs on a 6 GB GPU or with remote inference).

```
agent (DeepSeek Harness)  ──mynah_speak──▶  Mynah cored  ──WebRTC──▶  browser: a face that talks
```

## Tools

| Tool | What it does | Needs admin login |
|---|---|---|
| `mynah_speak` | Avatar says `text` in a live session. `type=echo` speaks verbatim (default); `type=chat` routes through Mynah's own brain. | no |
| `mynah_interrupt` | Stop the avatar mid-sentence. | no |
| `mynah_sessions` | List live sessions (ids for `mynah_speak`). | yes |
| `mynah_channels` | List published channels with visitor URLs. | yes |
| `mynah_status` | Health of core / avatar engines / ASR / TTS / DB. | yes |
| `mynah_kb_add` | Add a text/markdown document to a knowledge base. | yes |

The realtime tools only need the session id, which is the capability a visitor's page already holds. Admin tools log in once with the console account and cache the JWT.

## Install

```sh
dsh plugin --profile web add dsh-plugin-mynah      # from npm
# or, from a checkout:
dsh plugin --profile web add ./dsh-plugin-mynah
```

Then tell it where Mynah lives. Either edit the bundle row in your profile's `cordis.patch.yml`:

```yaml
- id: mynah
  name: dsh-plugin-mynah
  config:
    baseUrl: https://do.au56.com:8443      # visitor / realtime endpoint
    adminUrl: https://do.au56.com:9443     # admin console
    username: admin
    password: ********
```

or set environment variables (`MYNAH_URL`, `MYNAH_ADMIN_URL`, `MYNAH_USER`, `MYNAH_PASSWORD`, optional `MYNAH_TOKEN`, `MYNAH_INSECURE_TLS=1`). A patch row replaces the whole `config` block, so restate every key you need.

Verify and run:

```sh
dsh --profile web --dump-config | grep -A3 'id: mynah'
dsh --profile web
```

## Try it in 60 seconds

1. Open a Mynah channel page (e.g. `https://<your-mynah>:8443/channel/test`) and click **开始对话**.
2. In dsh, ask: *“Find the live Mynah session and have the digital human greet me by name.”*
3. The agent calls `mynah_sessions`, then `mynah_speak` — the avatar on your screen speaks.

Headless, for scripts and CI:

```sh
dsh --profile headless "Use mynah_sessions, then make the digital human say: 今天的部署已经完成。"
```

## Development

```sh
npm install
npm run build          # tsc against published @deepseek-ai packages
npm run check:local    # build + vitest against a sibling deepseek-harness checkout (see tsconfig.local.json)
```

`tests/cordis-integration.spec.ts` boots the real `@deepseek-ai/dsh-tools` registry, mounts this plugin, and exercises the tools against a fake Mynah on localhost.

## Requirements

- DeepSeek Harness ≥ 0.1.2-alpha.5, Node ≥ 22.19
- A reachable Mynah instance (`docker compose up -d` from the Mynah repo; EdgeTTS default means no API key is needed to hear it talk)

MIT © honwee
