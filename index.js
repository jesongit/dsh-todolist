/**
 * Host half of the todolist plugin.
 *
 * Owns the data: workspace-scoped todo lists and sticky notes, persisted to a
 * JSON file under $DSH_HOME/plugins/dsh-todolist/data.json. All reads/writes go
 * through a small owner-Web RPC surface (same transport pattern as the shipped
 * study-mode bundle) so the browser client never touches the filesystem.
 *
 * Data model (per workspaceId):
 *   tables:
 *     lists: { [listId]: { id, title, items: [{ id, text, done, createdAt }], createdAt } }
 *     notes: { [noteId]:   { id, text, color, createdAt, updatedAt } }
 */

import { join, dirname } from 'node:path'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'

export const name = 'dsh-todolist'
export const inject = ['webServer', 'connection', 'workspaceRegistry']

const CHANNEL = '/dsh-todolist'
const MAX_BODY = 2 * 1024 * 1024
const ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/
const NOTE_COLORS = ['yellow', 'green', 'blue', 'pink']

function defaultStore() {
  const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '.', '.dsh')
  return join(home, 'plugins', 'dsh-todolist', 'data.json')
}

/**
 * Persistence over a single JSON file. Reads are an in-memory cache;
 * every mutation rewrites atomically via a temp file + rename.
 */
class Store {
  constructor(file) {
    this.file = file
    /** @type {{lists: Record<string,any>, notes: Record<string,any>}} */
    this.data = { lists: {}, notes: {} }
    this.loaded = false
  }
  async load() {
    if (this.loaded) return
    this.loaded = true
    try {
      const text = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(text)
      this.data.lists = parsed.lists && typeof parsed.lists === 'object' ? parsed.lists : {}
      this.data.notes = parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {}
    } catch {
      // Missing or corrupt file → start empty.
      this.data = { lists: {}, notes: {} }
    }
  }
  async flush() {
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.${Date.now().toString(36)}.tmp`
    await writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    await rename(tmp, this.file)
  }
}

/** The client runtime exposes workspaces by id; scope data under that id. */
function requireWorkspace(payload) {
  const ws = payload && typeof payload === 'object' ? payload.workspaceId : undefined
  if (typeof ws !== 'string' || ws.length === 0 || ws.length > 256) {
    const err = new Error('workspaceId must be a non-empty string')
    err.code = 'INVALID_INPUT'
    throw err
  }
  return ws
}
function requireId(payload, key) {
  const v = payload && typeof payload === 'object' ? payload[key] : undefined
  if (typeof v !== 'string' || v.length === 0 || v.length > 256) {
    const err = new Error(`${key} must be a non-empty string`)
    err.code = 'INVALID_INPUT'
    throw err
  }
  return v
}
function requireText(payload, key, max = 20000) {
  const v = payload && typeof payload === 'object' ? payload[key] : undefined
  if (typeof v !== 'string' || v.length > max) {
    const err = new Error(`${key} must be a string`)
    err.code = 'INVALID_INPUT'
    throw err
  }
  return v
}
function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
function ok(value) {
  return value === undefined ? {} : value
}
function err(error) {
  return {
    error: {
      code: `todolist/${kebab(String((error && error.code) || 'failed'))}`,
      message: String((error && error.message) || 'operation failed'),
    },
  }
}
function kebab(s) {
  return s.toLowerCase().replace(/_/g, '-')
}

export function apply(ctx, config = {}) {
  const file = typeof config.storagePath === 'string' && config.storagePath ? config.storagePath : null
  const colors = Array.isArray(config.noteColors) && config.noteColors.length ? config.noteColors.slice(0, 12) : NOTE_COLORS
  const store = new Store(file || defaultStore())

  const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '.', '.dsh')
  const workspaceJson = join(home, 'storages', 'workspace.json')
  const diagPath = join(home, 'plugins', 'dsh-todolist', 'diag.log')

  function diag(line) {
    try {
      const dir = diagPath.slice(0, diagPath.lastIndexOf('\\') >= 0 ? diagPath.lastIndexOf('\\') : diagPath.lastIndexOf('/'))
      mkdir(dir, { recursive: true }).then(() => writeFile(diagPath, `${new Date().toISOString()} ${line}\n`, { flag: 'a' })).catch(() => {})
    } catch { /* ignore */ }
  }

  /** Workspaces from the registry when available, else straight from workspace.json. */
  async function listWorkspaces() {
    const registry = (ctx.get && ctx.get('workspaceRegistry')) || ctx.workspaceRegistry
    if (registry && typeof registry.list === 'function') {
      try {
        const list = registry.list()
        if (Array.isArray(list) && list.length) {
          return list.map((w) => ({ id: w && w.id, title: (w && w.title) || (w && w.path) || '', sessionIds: Array.isArray(w && w.sessionIds) ? [...w.sessionIds] : [] }))
        }
      } catch (e) { diag(`registry.list failed: ${String(e && e.message || e)}`) }
    }
    try {
      const raw = await readFile(workspaceJson, 'utf8')
      const j = JSON.parse(raw)
      const table = (j && j.tables && j.tables.workspaces) || {}
      const order = (j && j.global && Array.isArray(j.global.workspaceIds) && j.global.workspaceIds.length) ? j.global.workspaceIds : Object.keys(table)
      return order.map((id) => {
        const w = table[id] || {}
        return { id, title: w.title || w.path || '', sessionIds: Array.isArray(w.sessionIds) ? w.sessionIds : [] }
      })
    } catch (e) { diag(`workspace.json read failed: ${String(e && e.message || e)}`); return [] }
  }

  // Activation diagnostic: did we find workspaces at all?
  listWorkspaces().then((ws) => diag(`activation: workspaces=${ws.length} registry=${!!((ctx.get && ctx.get('workspaceRegistry')) || ctx.workspaceRegistry)}`))

  async function ensureLoaded() {
    await store.load()
  }

  /** Full snapshot of one workspace (lists + notes). */
  function snapshotFor(ws) {
    const lists = []
    for (const key of Object.keys(store.data.lists)) {
      if (!key.startsWith(`${ws}/`)) continue
      const list = store.data.lists[key]
      lists.push({ ...list, id: key.slice(ws.length + 1) })
    }
    const notes = []
    for (const key of Object.keys(store.data.notes)) {
      if (!key.startsWith(`${ws}/`)) continue
      const note = store.data.notes[key]
      notes.push({ ...note, id: key.slice(ws.length + 1) })
    }
    lists.sort((a, b) => a.createdAt - b.createdAt)
    notes.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    return { lists, notes, colors }
  }

  /**
   * RPC dispatch. Every mutation validates input, applies it to the in-memory
   * store and flushes to disk. Returns a plain value for the client.
   */
  async function dispatch(endpoint, payload, signal) {
    signal && signal.throwIfAborted && signal.throwIfAborted()
    await ensureLoaded()
    switch (endpoint) {
      case 'workspaces.list': {
        const workspaces = await listWorkspaces()
        return { workspaces: workspaces.map((w) => ({ id: w.id, title: w.title })) }
      }
      case 'diag.client': {
        diag(`client ${JSON.stringify(payload)}`)
        return { ok: true }
      }
      case 'workspace.current': {
        // Resolve the workspace that owns the given session (the conversation's
        // current session). Falls back to the first workspace when unknown.
        const workspaces = await listWorkspaces()
        const sid = payload && typeof payload.sessionId === 'string' ? payload.sessionId : null
        let ws = null
        if (sid) ws = workspaces.find((w) => Array.isArray(w.sessionIds) && w.sessionIds.includes(sid)) || null
        if (!ws) ws = workspaces[0] || null
        diag(`workspace.current sid=${sid || '-'} -> ${ws ? ws.id : 'none'} (of ${workspaces.length})`)
        return { workspaceId: ws ? ws.id : null, title: ws ? ws.title : '' }
      }
      case 'board': {
        // Aggregate board: every workspace the store has ever touched, with its
        // lists and notes, so the central panel groups tasks by workspace. Only
        // workspaces that actually own data are surfaced (empty ones stay out of
        // the board to keep it scannable).
        const workspaces = await listWorkspaces()
        const byId = new Map(workspaces.map((w) => [w.id, w]))
        const present = new Set([
          ...Object.keys(store.data.lists).map((k) => k.slice(0, k.indexOf('/'))),
          ...Object.keys(store.data.notes).map((k) => k.slice(0, k.indexOf('/'))),
        ])
        const groups = []
        for (const wsId of present) {
          const w = byId.get(wsId)
          groups.push({
            workspaceId: wsId,
            title: (w && w.title) || wsId,
            ...snapshotFor(wsId),
          })
        }
        groups.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
        return { groups, colors }
      }
      case 'snapshot': {
        const ws = requireWorkspace(payload)
        return snapshotFor(ws)
      }
      case 'list.create': {
        const ws = requireWorkspace(payload)
        const title = requireText(payload, 'title', 500)
        const id = uid()
        store.data.lists[`${ws}/${id}`] = { id, title, items: [], createdAt: Date.now() }
        await store.flush()
        return ok(snapshotFor(ws))
      }
      case 'list.rename': {
        const ws = requireWorkspace(payload)
        const id = requireId(payload, 'listId')
        const title = requireText(payload, 'title', 500)
        const list = store.data.lists[`${ws}/${id}`]
        if (!list) throw Object.assign(new Error('list not found'), { code: 'NOT_FOUND' })
        list.title = title
        await store.flush()
        return ok(snapshotFor(ws))
      }
      case 'list.delete': {
        const ws = requireWorkspace(payload)
        const id = requireId(payload, 'listId')
        delete store.data.lists[`${ws}/${id}`]
        await store.flush()
        return ok(snapshotFor(ws))
      }
      case 'item.add': {
        const ws = requireWorkspace(payload)
        const id = requireId(payload, 'listId')
        const text = requireText(payload, 'text', 2000)
        const picked = payload && payload.color
        const color = colors.includes(picked) ? picked : null
        const list = store.data.lists[`${ws}/${id}`]
        if (!list) throw Object.assign(new Error('list not found'), { code: 'NOT_FOUND' })
        list.items.push({ id: uid(), text, done: false, color, createdAt: Date.now() })
        await store.flush()
        return ok(snapshotFor(ws))
      }
      case 'item.setColor': {
        const ws = requireWorkspace(payload)
        const id = requireId(payload, 'listId')
        const itemId = requireId(payload, 'itemId')
        const picked = payload && payload.color
        const color = colors.includes(picked) ? picked : null
        const list = store.data.lists[`${ws}/${id}`]
        if (!list) throw Object.assign(new Error('list not found'), { code: 'NOT_FOUND' })
        const item = list.items.find((i) => i.id === itemId)
        if (!item) throw Object.assign(new Error('item not found'), { code: 'NOT_FOUND' })
        item.color = color
        await store.flush()
        return ok(snapshotFor(ws))
      }
      case 'item.update': {
        const ws = requireWorkspace(payload)
        const id = requireId(payload, 'listId')
        const itemId = requireId(payload, 'itemId')
        const text = requireText(payload, 'text', 2000)
        const list = store.data.lists[`${ws}/${id}`]
        if (!list) throw Object.assign(new Error('list not found'), { code: 'NOT_FOUND' })
        const item = list.items.find((i) => i.id === itemId)
        if (!item) throw Object.assign(new Error('item not found'), { code: 'NOT_FOUND' })
        item.text = text
        await store.flush()
        return ok(snapshotFor(ws))
      }
      case 'item.toggle': {
        const ws = requireWorkspace(payload)
        const id = requireId(payload, 'listId')
        const itemId = requireId(payload, 'itemId')
        const done = payload && typeof payload === 'object' && typeof payload.done === 'boolean' ? payload.done : undefined
        const list = store.data.lists[`${ws}/${id}`]
        if (!list) throw Object.assign(new Error('list not found'), { code: 'NOT_FOUND' })
        const item = list.items.find((i) => i.id === itemId)
        if (!item) throw Object.assign(new Error('item not found'), { code: 'NOT_FOUND' })
        item.done = done === undefined ? !item.done : done
        item.doneAt = item.done ? Date.now() : undefined
        await store.flush()
        return ok(snapshotFor(ws))
      }
      case 'item.remove': {
        const ws = requireWorkspace(payload)
        const id = requireId(payload, 'listId')
        const itemId = requireId(payload, 'itemId')
        const list = store.data.lists[`${ws}/${id}`]
        if (!list) throw Object.assign(new Error('list not found'), { code: 'NOT_FOUND' })
        list.items = list.items.filter((i) => i.id !== itemId)
        await store.flush()
        return ok(snapshotFor(ws))
      }
      case 'item.move': {
        const ws = requireWorkspace(payload)
        const id = requireId(payload, 'listId')
        const from = Number(payload && payload.from)
        const to = Number(payload && payload.to)
        const list = store.data.lists[`${ws}/${id}`]
        if (!list) throw Object.assign(new Error('list not found'), { code: 'NOT_FOUND' })
        const items = list.items
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= items.length || to >= items.length) {
          throw Object.assign(new Error('invalid move indices'), { code: 'INVALID_INPUT' })
        }
        const [moved] = items.splice(from, 1)
        items.splice(to, 0, moved)
        await store.flush()
        return ok(snapshotFor(ws))
      }
      case 'note.add': {
        const ws = requireWorkspace(payload)
        const text = requireText(payload, 'text', 20000)
        const picked = payload && payload.color
        // Default color cycles through the configured palette so new notes vary
        // instead of always being the same color.
        let color
        if (colors.includes(picked)) {
          color = picked
        } else {
          const prefix = `${ws}/`
          const count = Object.keys(store.data.notes).filter((k) => k.startsWith(prefix)).length
          color = colors[count % colors.length]
        }
        store.data.notes[`${ws}/${uid()}`] = { id: uid(), text, color, createdAt: Date.now(), updatedAt: Date.now() }
        await store.flush()
        return ok(snapshotFor(ws))
      }
      case 'note.update': {
        const ws = requireWorkspace(payload)
        const nid = requireId(payload, 'noteId')
        const text = requireText(payload, 'text', 20000)
        const note = store.data.notes[`${ws}/${nid}`]
        if (!note) throw Object.assign(new Error('note not found'), { code: 'NOT_FOUND' })
        note.text = text
        note.updatedAt = Date.now()
        await store.flush()
        return ok(snapshotFor(ws))
      }
      case 'note.setColor': {
        const ws = requireWorkspace(payload)
        const nid = requireId(payload, 'noteId')
        const picked = payload && payload.color
        const color = colors.includes(picked) ? picked : colors[0]
        const note = store.data.notes[`${ws}/${nid}`]
        if (!note) throw Object.assign(new Error('note not found'), { code: 'NOT_FOUND' })
        note.color = color
        note.updatedAt = Date.now()
        await store.flush()
        return ok(snapshotFor(ws))
      }
      case 'note.remove': {
        const ws = requireWorkspace(payload)
        const nid = requireId(payload, 'noteId')
        delete store.data.notes[`${ws}/${nid}`]
        await store.flush()
        return ok(snapshotFor(ws))
      }
      default:
        throw Object.assign(new Error('unknown endpoint'), { code: 'NOT_FOUND' })
    }
  }

  const disposeRoute = registerRoutes(ctx, {
    channel: CHANNEL,
    maxBody: MAX_BODY,
    handler: dispatch,
    log: diag,
  })
  ctx.effect(() => () => void disposeRoute?.(), 'dsh-todolist: routes')

  function dispose() {}
  ctx.effect(() => () => dispose(), 'dsh-todolist: store')
}

/**
 * Owns the /dsh-todolist web RPC transport (owner-only), envelope-compatible
 * with dsh-client-connection's rpc.call. Replicates the study-mode transport.
 */
function registerRoutes(ctx, opts) {
  const webServer = ctx.get('webServer') || (ctx.webServer)
  const connection = ctx.get('connection') || (ctx.connection)
  if (!webServer || !connection || typeof webServer.register !== 'function') {
    ctx.logger && ctx.logger.warn('[dsh-todolist] webServer/connection unavailable; panel will show RPC errors')
    return () => {}
  }

  const readBoundedBody = async (req) => {
    const declared = req.headers && req.headers['content-length']
    if (typeof declared === 'string' && Number(declared) > opts.maxBody) {
      req.resume && req.resume()
      return null
    }
    const chunks = []
    let received = 0
    for await (const chunk of req) {
      received += chunk.byteLength
      if (received > opts.maxBody) {
        req.resume && req.resume()
        return null
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, received).toString('utf8')
  }

  return webServer.register({
    kind: 'prefix',
    path: opts.channel,
    handler: async (req, res) => {
      let admit = { rejection: undefined, peer: undefined }
      try {
        if (connection && typeof connection.admit === 'function') admit = connection.admit(req)
      } catch { /* fall through to explicit principal check */ }
      if (admit.rejection !== undefined) {
        res.statusCode = admit.rejection
        res.end(admit.rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      if (!admit.peer || !admit.peer.principal || admit.peer.principal.kind !== 'owner') {
        res.statusCode = 403
        res.end('forbidden')
        return
      }
      const pathname = new URL(String(req.url || '/'), 'http://dsh.internal').pathname
      if (!pathname.startsWith(`${opts.channel}/`)) {
        res.statusCode = 404
        res.end('not found')
        return
      }
      const endpoint = pathname.slice(opts.channel.length + 1)
      if (endpoint.split('/').some((s) => !s || s === '.' || s === '..' || !ENDPOINT_SEGMENT.test(s))) {
        res.statusCode = 404
        res.end('not found')
        return
      }
      if ((req.method || 'GET') !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST')
        res.end()
        return
      }
      const ctype = String((req.headers && req.headers['content-type']) || '').split(';', 1)[0].trim().toLowerCase()
      if (ctype !== 'application/json') {
        res.statusCode = 415
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.end('content type must be application/json')
        return
      }
      let rpcId = ''
      let method = ''
      let payload
      try {
        const text = await readBoundedBody(req)
        if (text === null) {
          res.statusCode = 413
          res.end()
          return
        }
        const body = JSON.parse(text)
        if (!body || body.type !== 'client-request' || typeof body.rpcId !== 'string' || typeof body.method !== 'string') {
          res.statusCode = 400
          res.end('invalid client-request message')
          return
        }
        rpcId = body.rpcId
        method = body.method
        payload = body.payload
      } catch {
        res.statusCode = 400
        res.end('body is not JSON')
        return
      }
      if (method !== endpoint) {
        respond(res, rpcId, { ok: false, error: { code: 'todolist/bad-request', message: 'method does not match endpoint', details: {} } })
        return
      }
      let result
      try {
        const value = await opts.handler(endpoint, payload, req.signal || new AbortController().signal)
        result = { ok: true, value }
      } catch (error) {
        const code = (error && error.code) || 'todolist-failed'
        result = { ok: false, error: { code: `todolist/${kebab(code)}`, message: String((error && error.message) || error || 'operation failed'), details: {} } }
      }
      if (opts.log) { try { opts.log(`${result.ok ? 'ok' : 'ERR'} ${endpoint}${result.ok ? '' : ' :: ' + (result.error && result.error.message)}`) } catch { /* ignore */ } }
      respond(res, rpcId, result)
    },
  })
}

function respond(res, rpcId, result) {
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ type: 'server-response', rpcId, result }))
}