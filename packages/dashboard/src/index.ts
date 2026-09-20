import { SessionStore } from "@louisdev/agent"
import { VERSION } from "@louisdev/cli"
import {
  type LouisDevConfig,
  loadConfig,
  orderedSources,
  sunsetFlowDark,
  sunsetFlowLight,
  type Theme,
} from "@louisdev/config"
import { QuotaManager, type SourceView } from "@louisdev/quota"
import { formatWait } from "@louisdev/tui"
import { Hono } from "hono"

export interface DashboardDeps {
  sessionDb: string
}

function themeByName(name: string | undefined): Theme {
  const dark = sunsetFlowDark()
  const light = sunsetFlowLight()
  if (name === light.name) return light
  return dark
}

function viewJson(view: SourceView) {
  return {
    id: view.source.id,
    label: view.source.label,
    trust: view.source.trust,
    baseUrl: view.source.baseUrl,
    status: view.status,
    waitMs: view.waitMs,
    wait: formatWait(view.waitMs),
    consecutiveRefusals: view.consecutiveRefusals,
    lastMessage: view.lastMessage,
  }
}

export function createApp(deps: DashboardDeps): Hono {
  const app = new Hono()

  app.get("/api/version", (c) => c.json({ name: "louisdev", version: VERSION }))

  app.get("/api/quota", async (c) => {
    const config = await loadConfig().catch(() => undefined)
    const manager = new QuotaManager(config?.chain ?? { sources: [] })
    const views = manager.snapshot()
    const ready = views.filter((view) => view.status === "ok").length
    return c.json({
      ready,
      total: views.length,
      allCooling: views.length > 0 && ready === 0,
      sources: views.map(viewJson),
    })
  })

  app.get("/api/chain", async (c) => {
    const config = await loadConfig().catch((): LouisDevConfig | undefined => undefined)
    if (!config) return c.json({ sources: [] })
    return c.json({
      sources: orderedSources(config.chain).map((source) => ({
        id: source.id,
        label: source.label,
        trust: source.trust,
        priority: source.priority,
        baseUrl: source.baseUrl,
        models: source.models,
      })),
    })
  })

  app.get("/api/sessions", (c) => {
    const store = new SessionStore(deps.sessionDb)
    try {
      return c.json({ sessions: store.list() })
    } finally {
      store.close()
    }
  })

  app.get("/", (c) => c.html(renderPage(themeByName(process.env.LOUISDEV_THEME))))

  return app
}

/** Single-file page. Vanilla JS polls the API; no build pipeline needed. */
export function renderPage(theme: Theme): string {
  const t = theme.tokens
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LouisDev Dashboard</title>
<style>
  :root {
    --primary: ${t.primary}; --secondary: ${t.secondary}; --accent: ${t.accent};
    --text: ${t.text}; --muted: ${t.textMuted}; --bg: ${t.background};
    --panel: ${t.backgroundPanel}; --element: ${t.backgroundElement};
    --border: ${t.border}; --ok: ${t.success}; --warn: ${t.warning}; --err: ${t.error};
  }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--bg); color: var(--text); font: 15px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 32px; }
  h1 { font-size: 22px; color: var(--primary); letter-spacing: 1px; }
  h1 small { color: var(--muted); font-weight: normal; letter-spacing: 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 20px; max-width: 1100px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: var(--muted); margin-bottom: 12px; }
  .row { display: flex; align-items: baseline; gap: 10px; padding: 7px 10px; border-radius: 6px; background: var(--element); margin-bottom: 6px; }
  .dot { font-size: 10px; }
  .ok { color: var(--ok); } .cooling { color: var(--warn); } .exhausted { color: var(--err); }
  .id { font-weight: bold; }
  .muted { color: var(--muted); }
  .wait { color: var(--accent); margin-left: auto; }
  .empty { color: var(--muted); font-style: italic; }
  .footer { margin-top: 18px; color: var(--muted); max-width: 1100px; }
  .warnbar { display: none; margin-top: 16px; max-width: 1100px; padding: 10px 14px; border-radius: 8px; background: var(--panel); border: 1px solid var(--warn); color: var(--warn); }
  @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
  <h1>LouisDev <small>free-max coding CLI · dashboard</small></h1>
  <div class="warnbar" id="warnbar"></div>
  <div class="grid">
    <div class="card"><h2>Quota board</h2><div id="quota"><span class="empty">loading…</span></div></div>
    <div class="card"><h2>Source chain</h2><div id="chain"><span class="empty">loading…</span></div></div>
    <div class="card"><h2>Sessions</h2><div id="sessions"><span class="empty">loading…</span></div></div>
  </div>
  <div class="footer" id="footer">Live free-max view · refreshes every 5s</div>
<script>
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&", "<": "<", ">": ">", '"': """, "'": "&#39;" }[ch]))
  async function refresh() {
    try {
      const [quota, chain, sessions] = await Promise.all([
        fetch("/api/quota").then((r) => r.json()),
        fetch("/api/chain").then((r) => r.json()),
        fetch("/api/sessions").then((r) => r.json()),
      ])
      document.getElementById("quota").innerHTML =
        '<div class="row"><span class="muted">ready</span><b>' + quota.ready + "/" + quota.total + '</b></div>' +
        quota.sources.map((s) =>
          '<div class="row"><span class="dot ' + esc(s.status) + '">●</span><span class="id">' + esc(s.id) + '</span>' +
          '<span class="muted">' + esc(s.trust) + '</span><span class="wait">' + (s.status === "ok" ? "ready" : esc(s.wait)) + (s.lastMessage ? " · " + esc(s.lastMessage) : "") + '</span></div>'
        ).join("")
      const warn = document.getElementById("warnbar")
      warn.style.display = quota.allCooling ? "block" : "none"
      warn.textContent = "All sources cooling - the CLI is waiting for the fastest recovery."
      document.getElementById("chain").innerHTML = chain.sources.map((s) =>
        '<div class="row"><span class="muted">#' + s.priority + '</span><span class="id">' + esc(s.id) + '</span>' +
        '<span class="muted">' + esc(s.trust) + '</span><span class="wait">' + (s.models.length ? esc(s.models.join(", ")) : "discover from catalog") + '</span></div>'
      ).join("")
      document.getElementById("sessions").innerHTML = sessions.sessions.length === 0
        ? '<span class="empty">no sessions yet - run louisdev chat in your terminal</span>'
        : sessions.sessions.slice(0, 8).map((s) =>
            '<div class="row"><span class="id">' + esc(s.id) + '</span><span class="muted">' + esc(s.title) + '</span><span class="wait">' + new Date(s.updatedAt).toLocaleString("en-US") + '</span></div>'
          ).join("")
    } catch (error) {
      const warn = document.getElementById("warnbar")
      warn.style.display = "block"
      warn.textContent = "dashboard backend unreachable: " + error
    }
  }
  refresh()
  setInterval(refresh, 5000)
</script>
</body>
</html>`
}
