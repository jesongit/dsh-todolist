/**
 * Browser half of the todolist plugin.
 *
 * Mounts three surfaces via slot registration:
 *   - shell.overlay : a collapsible floating panel anchored near the top-left
 *     of the conversation area, with [待办][便签] tabs.
 *   - sidebar.panellist + main : an aggregate "看板" entry in the left panel
 *     rail that opens a full central panel.
 *
 * All data goes to the host through ctx.connection.rpc.call('/dsh-todolist',
 * endpoint, payload, signal) (owner-Web RPC, study-mode transport pattern).
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-todolist',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /* ── inline icon set (single stroke, no emoji) ─── */
    const ICON = {
      plus: 'M12 5v14M5 12h14',
      x: 'M6 6l12 12M18 6L6 18',
      check: 'M5 12.5l4.5 4.5L19 7',
    }
    function Icon({ d, size = 16, strokeWidth = 2 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d }))
    }

    /* ── panel open state, remembered per workspace ─── */
    function loadPanelOpenMap() {
      try { const raw = localStorage.getItem('dsh-todolist-open'); const v = raw ? JSON.parse(raw) : null; return v && typeof v === 'object' ? v : {} } catch { return {} }
    }
    function savePanelOpenMap(m) { try { localStorage.setItem('dsh-todolist-open', JSON.stringify(m)) } catch { /* ignore */ } }

    /* ── note pins, per workspace: an ordered id list, newest pin first ─── */
    function loadPinMap() {
      try { const raw = localStorage.getItem('dsh-todolist-pins'); const v = raw ? JSON.parse(raw) : null; return v && typeof v === 'object' ? v : {} } catch { return {} }
    }
    function savePinMap(m) { try { localStorage.setItem('dsh-todolist-pins', JSON.stringify(m)) } catch { /* ignore */ } }
    function useNotePins(workspaceId) {
      const [pins, setPins] = React.useState(() => (loadPinMap()[workspaceId] || []).slice())
      React.useEffect(() => { setPins((loadPinMap()[workspaceId] || []).slice()) }, [workspaceId])
      const toggle = (noteId) => {
        setPins((cur) => {
          const next = cur.includes(noteId) ? cur.filter((id) => id !== noteId) : [noteId, ...cur]
          const all = loadPinMap(); all[workspaceId] = next; savePinMap(all)
          return next
        })
      }
      return [pins, toggle]
    }
    // Pinned notes first (newest pin first), then the rest by creation order.
    function orderNotes(notes, pins) {
      return notes.slice().sort((a, b) => {
        const ia = pins.indexOf(a.id), ib = pins.indexOf(b.id)
        const pa = ia >= 0, pb = ib >= 0
        if (pa && pb) return ia - ib
        if (pa) return -1
        if (pb) return 1
        return (a.createdAt || 0) - (b.createdAt || 0)
      })
    }

    /* ── todo-list pins (separate store); newest pin first, pinned float up ─── */
    function loadListPinMap() {
      try { const raw = localStorage.getItem('dsh-todolist-list-pins'); const v = raw ? JSON.parse(raw) : null; return v && typeof v === 'object' ? v : {} } catch { return {} }
    }
    function saveListPinMap(m) { try { localStorage.setItem('dsh-todolist-list-pins', JSON.stringify(m)) } catch { /* ignore */ } }
    function useListPins(workspaceId) {
      const [pins, setPins] = React.useState(() => (loadListPinMap()[workspaceId] || []).slice())
      React.useEffect(() => { setPins((loadListPinMap()[workspaceId] || []).slice()) }, [workspaceId])
      const toggle = (listId) => {
        setPins((cur) => {
          const next = cur.includes(listId) ? cur.filter((id) => id !== listId) : [listId, ...cur]
          const all = loadListPinMap(); all[workspaceId] = next; saveListPinMap(all)
          return next
        })
      }
      return [pins, toggle]
    }
    function orderLists(lists, pins) {
      return lists.slice().sort((a, b) => {
        const ia = pins.indexOf(a.id), ib = pins.indexOf(b.id)
        const pa = ia >= 0, pb = ib >= 0
        if (pa && pb) return ia - ib
        if (pa) return -1
        if (pb) return 1
        return (a.createdAt || 0) - (b.createdAt || 0)
      })
    }
    // Stable per-id hash so a list's header color doesn't change when reordered.
    function hashId(s) {
      let h = 0
      for (let i = 0; i < String(s || '').length; i++) h = (h * 31 + String(s).charCodeAt(i)) >>> 0
      return h
    }
    function PinIcon({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true },
        h('path', { d: 'M16 9V4h1V2H7v2h1v5c0 1.66-1.34 3-3 3v2h5.97v7.01l1 1 1-1V14H19v-2c-1.66 0-3-1.34-3-3z' }))
    }

    /* ── persisted boolean toggle per id (expand/collapse memory) ─── */
    function loadFlagMap(storeKey) {
      try { const raw = localStorage.getItem(storeKey); const v = raw ? JSON.parse(raw) : null; return v && typeof v === 'object' ? v : {} } catch { return {} }
    }
    function saveFlagMap(storeKey, m) { try { localStorage.setItem(storeKey, JSON.stringify(m)) } catch { /* ignore */ } }
    function usePersistentToggle(storeKey, id, defaultVal) {
      const read = () => { if (!id) return defaultVal; const v = loadFlagMap(storeKey)[id]; return v === undefined ? defaultVal : !!v }
      const [on, setOn] = React.useState(read)
      React.useEffect(() => { setOn(read()) }, [storeKey, id, defaultVal]) // eslint-disable-line react-hooks/exhaustive-deps
      const set = (val) => setOn((cur) => {
        const next = typeof val === 'function' ? val(cur) : val
        if (id) { const all = loadFlagMap(storeKey); all[id] = next; saveFlagMap(storeKey, all) }
        return next
      })
      return [on, set]
    }

    /* ── is the Conversation showing the Trajectory view? (dom signal) ─── */
    function useTrajectoryView() {
      const [traj, setTraj] = React.useState(false)
      React.useEffect(() => {
        const compute = () => {
          const center = typeof document !== 'undefined' ? document.querySelector('[class*="centerCol"]') : null
          if (!center) { setTraj(false); return }
          const tabs = Array.from(center.querySelectorAll('[role="tab"]'))
          const sel = tabs.find((t) => t.getAttribute('aria-selected') === 'true')
          if (!sel) { setTraj(false); return }
          setTraj(/轨迹|trajectory/i.test((sel.textContent || '').trim()))
        }
        compute()
        const iv = window.setInterval(compute, 200)
        return () => window.clearInterval(iv)
      }, [])
      return traj
    }

    /* ── clipboard + external open helpers ─── */
    function copyText(text) {
      const s = String(text == null ? '' : text)
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(s).catch(() => fallbackCopy(s))
      }
      return Promise.resolve(fallbackCopy(s))
    }
    function fallbackCopy(s) {
      try {
        const ta = document.createElement('textarea')
        ta.value = s; ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.left = '-9999px'
        document.body.appendChild(ta); ta.focus(); ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
      } catch { return false }
    }
    function openExternal(url) {
      try { window.open(url, '_blank', 'noopener,noreferrer') }
      catch { try { window.location.href = url } catch { /* ignore */ } }
    }

    /* ── detect links / secrets in note text for quick copy ─── */
    // Returns segments ready to render inline: `{ text }` runs are plain text,
    // `{ token }` runs are clickable chips carrying {type, value, label, key}.
    function buildSegments(text) {
      const src = String(text || '')
      const tokens = []
      const seen = new Set()
      const push = (type, value, label) => {
        const v = String(value || '').trim()
        if (!v) return
        const k = `${type}:${v}`
        if (seen.has(k)) return
        seen.add(k)
        tokens.push({ type, value: v, label: label || v })
      }
      // 1) URLs
      const urlRe = /https?:\/\/[^\s<>"'（）)】\]，。；;]+/g
      let m
      while ((m = urlRe.exec(src))) push('link', m[0].replace(/[.,;:]+$/u, ''), m[0].replace(/[.,;:]+$/u, ''))
      // 2) explicit secrets: key:value or 密钥：value … including {{...}} placeholders
      const secretRe = /(?:密码|口令|password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|密钥|秘钥)\s*[:=：]\s*([^\s，。；;、]+)/g
      while ((m = secretRe.exec(src))) {
        push('secret', m[1], m[1])
      }
      // 3) {{...}} placeholder secrets, e.g. feT9y7F@-!7LzHipQ (mixed case)
      const braceRe = /\{\{[A-Za-z0-9_\-]+\}\}/g
      while ((m = braceRe.exec(src))) push('secret', m[0], m[0])
      // 4) token-bearing prefixes
      const tokenRe = /\b(?:sk|pk|ghp|gho|ghs|glpat|AKIA|xox[baprs])[-_A-Za-z0-9]{12,}\b/g
      while ((m = tokenRe.exec(src))) push('secret', m[0], m[0])
      // 5) standalone numeric codes (passwords / OTP / verification numbers)
      const numRe = /\b\d{6,}\b/g
      while ((m = numRe.exec(src))) push('secret', m[0], m[0])
      // 6) standalone "secret-like" tokens: a whole line that is a single
      // printable-ASCII token with no spaces (random passwords, keys, codes).
      // Catches e.g. feT9y7F#!7LzHipQ and short passwords like sadfasf.
      const isSecretish = (tok) => {
        if (tok.length < 6) return false
        if (!/^[\x21-\x7e]+$/.test(tok)) return false // printable ASCII, no spaces
        const hasDigit = /\d/.test(tok)
        const hasSymbol = /[^A-Za-z0-9]/.test(tok)
        const hasUpper = /[A-Z]/.test(tok)
        const hasLower = /[a-z]/.test(tok)
        if (hasDigit || hasSymbol || hasUpper) return true
        return hasLower && tok.length >= 7 // pure lowercase word-like password
      }
      for (const line of src.split('\n')) {
        const t = line.trim()
        if (!t) continue
        if (/^https?:\/\//i.test(t)) continue // URLs handled above
        if (/\s/.test(t)) continue // only single-token lines
        if (!isSecretish(t)) continue
        push('secret', t, t)
      }
      // 7) strong secrets embedded inside a sentence: any ASCII run of 6+
      // printable non-space chars that mixes letters with digits (or symbols),
      // excluding URLs/domains. Catches e.g. feT9y7F@-!7LzHipQ.
      const runRe = /[\x21-\x7e]{6,}/g
      let rm
      while ((rm = runRe.exec(src))) {
        const t = rm[0]
        if (/:\/\//.test(t)) continue // part of a URL
        if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(t)) continue // domain-like
        if (/^www\./i.test(t)) continue
        if (!/[A-Za-z]/.test(t)) continue // needs a letter; pure digits handled above
        const hasDigit = /\d/.test(t)
        const hasSymbol = /[^A-Za-z0-9]/.test(t)
        if (hasDigit || (hasSymbol && t.length >= 8)) push('secret', t, t)
      }

      // Merge token spans into plain-text segments in source order.
      const spans = tokens.map((t) => ({ ...t, start: 0, end: 0 }))
      for (const sp of spans) {
        const at = src.indexOf(sp.value)
        sp.start = at < 0 ? 0 : at
        sp.end = at < 0 ? 0 : at + sp.value.length
      }
      spans.sort((a, b) => a.start - b.start)
      const segs = []
      let pos = 0
      let n = 0
      for (const sp of spans) {
        if (sp.end <= pos) continue
        if (sp.start > pos) segs.push({ text: src.slice(pos, sp.start) })
        segs.push({ token: { type: sp.type, value: sp.value, label: sp.label, key: `${sp.type}:${sp.value}:${n++}` } })
        pos = sp.end
      }
      if (pos < src.length) segs.push({ text: src.slice(pos) })
      return segs
    }

    /* ── error boundary: show a message instead of a blank slot ─── */
    class DtlBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      render() {
        if (this.state.error) {
          return h('div', { style: { padding: 12, color: 'var(--dsw-alias-label-secondary,#888)', fontSize: 12, fontFamily: '"Segoe UI",system-ui,sans-serif' }, role: 'alert' },
            '任务面板渲染出错：', h('div', null, String((this.state.error && this.state.error.message) || this.state.error)),
            h('button', { onClick: () => this.setState({ error: null }), style: { marginTop: 8, background: 'none', border: '1px solid var(--dsw-alias-border-l1,#ccc)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', color: 'var(--dsw-alias-label-primary,#222)' } }, '重试'))
        }
        return this.props.children
      }
    }

    /* ── tiny RPC helper ─────────────────────────────── */
    function makeRpc(ctx) {
      const rpc = (ctx.get && ctx.get('connection')) || ctx.connection
      async function call(endpoint, payload, signal) {
        const result = await rpc.rpc.call('/dsh-todolist', endpoint, payload || {}, signal)
        if (result && result.ok) return result.value
        const e = (result && result.error) || {}
        const err = new Error(String(e.message || '操作失败'))
        err.code = String(e.code || 'RPC_ERROR')
        throw err
      }
      return call
    }

    /* ── style ───────────────────────────────────────── */
    const STYLE = `
.dtl-panel,.dtl-root{--dtl-bg:var(--dsw-alias-bg-layer-1,#fff);--dtl-bg2:var(--dsw-alias-bg-layer-2,#f6f6f6);--dtl-fg:var(--dsw-alias-label-primary,#222);--dtl-fg2:var(--dsw-alias-label-secondary,#666);--dtl-border:var(--dsw-alias-border-l1,#d8d8d8);--dtl-brand:var(--dsw-alias-brand-primary,#247bbf);--dtl-ok:var(--dsw-alias-state-success-primary,#2ea043);--dtl-warn:var(--dsw-alias-state-warn-primary,#d29922);--dtl-err:var(--dsw-alias-state-error-primary,#cf222e);font-family:inherit;font-size:13px;color:var(--dtl-fg)}
.dtl-panel{position:fixed;z-index:1000;width:330px;max-height:75vh;display:flex;flex-direction:column;background:var(--dtl-bg);border:1px solid var(--dtl-border);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);overflow:hidden}
.dtl-panel .dtl-root{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
.dtl-panel .dtl-head{flex:none}
.dtl-panel .dtl-body{flex:1 1 auto;min-height:0}
.dtl-panel--pinned{resize:both;overflow:auto}
.dtl-head{display:flex;align-items:center;gap:2px;padding:6px 16px 6px 8px;border-bottom:1px solid var(--dtl-border);background:var(--dtl-bg2)}
.dtl-tabs{display:flex;gap:2px;flex:none}
.dtl-dragspace{flex:1 1 auto;align-self:stretch;min-width:16px;border-radius:6px;cursor:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="%23ffffff" stroke-width="4"><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></g><g stroke="%23374151" stroke-width="1.75"><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></g></svg>') 11 11, move;touch-action:none;user-select:none}
.dtl-head-new{flex:none;display:inline-flex;align-items:center;justify-content:center;line-height:1;background:none;border:1px solid var(--dtl-border);border-radius:8px;padding:4px 9px;cursor:pointer;color:var(--dtl-fg);font:inherit;font-size:12px}
.dtl-head-new:hover{background:rgba(127,127,127,.12)}
.dtl-head-input{flex:1 1 auto;min-width:0;max-width:132px;background:var(--dtl-bg);border:1px solid var(--dtl-brand);border-radius:8px;padding:3px 8px;font:inherit;font-size:12px;color:var(--dtl-fg);outline:none}
.dtl-tab{background:none;border:none;border-bottom:2px solid transparent;padding:5px 10px;cursor:pointer;color:var(--dtl-fg2);font:inherit;white-space:nowrap}
.dtl-tab:hover{background:rgba(127,127,127,.12);border-radius:6px}
.dtl-tab[data-on="1"]{color:var(--dtl-fg);font-weight:600;border-bottom-color:var(--dtl-brand)}
.dtl-iconbtn{display:inline-flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;color:var(--dtl-fg2);padding:3px;border-radius:6px;font-size:14px;line-height:1}
.dtl-iconbtn:hover{background:rgba(127,127,127,.15);color:var(--dtl-fg)}
.dtl-iconbtn[data-danger="1"]{color:var(--dtl-err)}
.dtl-iconbtn[data-danger="1"]:hover{background:color-mix(in srgb,var(--dtl-err) 15%,transparent);color:var(--dtl-err)}
.dtl-gh{position:relative;opacity:0;transition:opacity .15s ease}
.dtl-head:hover .dtl-gh,.dtl-gh:focus-visible{opacity:1}
.dtl-gh::after{content:'欢迎 Star ~';position:absolute;top:calc(100% + 6px);right:0;z-index:10;padding:3px 8px;border-radius:6px;background:var(--dtl-fg);color:var(--dtl-bg);font-size:11px;line-height:1.4;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .15s ease .1s}
.dtl-gh:hover::after,.dtl-gh:focus-visible::after{opacity:1}
.dtl-body{overflow:auto;padding:8px;display:flex;flex-direction:column;gap:8px;min-height:80px}
.dtl-body > *,.dtl-wsbody > *{flex:0 0 auto}
.dtl-empty{color:var(--dtl-fg2);text-align:center;padding:18px 8px;font-size:12px}
.dtl-listcard{border:1px solid var(--dtl-border);border-radius:10px;overflow:hidden;background:var(--dtl-bg)}
.dtl-listhead{display:flex;align-items:center;gap:2px;padding:6px 8px;background:var(--dtl-bg2);font-weight:600;cursor:pointer;user-select:none}
.dtl-listhead .dtl-iconbtn{padding:3px;border-radius:4px}
.dtl-listhead .dtl-iconbtn:hover{background:transparent;color:var(--dtl-fg)}
.dtl-listhead .dtl-iconbtn[data-danger="1"]:hover{background:transparent;color:var(--dtl-err)}
.dtl-list-pin{opacity:0;transition:opacity .15s ease}
.dtl-listhead .dtl-list-pin{padding:0;width:22px;height:22px}
.dtl-listhead:hover .dtl-list-pin{opacity:.75}
.dtl-list-pin[data-on="1"]{opacity:1;color:var(--dtl-brand)}
.dtl-listhead[data-pinned="1"][data-c="0"]{background:color-mix(in srgb,#3b82f6 34%,var(--dtl-bg2))}
.dtl-listhead[data-pinned="1"][data-c="1"]{background:color-mix(in srgb,#8b5cf6 34%,var(--dtl-bg2))}
.dtl-listhead[data-pinned="1"][data-c="2"]{background:color-mix(in srgb,#ec4899 32%,var(--dtl-bg2))}
.dtl-listhead[data-pinned="1"][data-c="3"]{background:color-mix(in srgb,#0891b2 34%,var(--dtl-bg2))}
.dtl-listhead[data-pinned="1"][data-c="4"]{background:color-mix(in srgb,#ef4444 30%,var(--dtl-bg2))}
.dtl-listhead[data-c="0"]{background:color-mix(in srgb,#3b82f6 20%,var(--dtl-bg2))}
.dtl-listhead[data-c="1"]{background:color-mix(in srgb,#8b5cf6 20%,var(--dtl-bg2))}
.dtl-listhead[data-c="2"]{background:color-mix(in srgb,#ec4899 18%,var(--dtl-bg2))}
.dtl-listhead[data-c="3"]{background:color-mix(in srgb,#0891b2 20%,var(--dtl-bg2))}
.dtl-listhead[data-c="4"]{background:color-mix(in srgb,#ef4444 16%,var(--dtl-bg2))}
.dtl-listtitle{flex:1;min-width:0}
.dtl-listtitle-btn{display:block;max-width:100%;padding:0;background:none;border:none;color:inherit;font:inherit;text-align:left;overflow-wrap:anywhere;cursor:pointer}
.dtl-listtitle-btn:focus-visible{outline:2px solid var(--dtl-brand);outline-offset:2px;border-radius:2px}
.dtl-listhead .dtl-listtitle-input{width:100%;min-width:0;box-sizing:border-box;background:var(--dtl-bg);border:1px solid var(--dtl-brand);border-radius:4px;padding:2px 4px;color:var(--dtl-fg);font:inherit;font-weight:600;outline:none;user-select:text}
.dtl-listtitle-input:focus{outline:2px solid var(--dtl-brand);outline-offset:1px}
.dtl-listtitle-input[aria-invalid="true"]{border-color:var(--dtl-err)}
.dtl-listtitle-status{display:block;margin-top:4px;color:var(--dtl-fg2);font-size:11px;font-weight:400;overflow-wrap:anywhere}
.dtl-listtitle-status[role="alert"]{color:var(--dtl-err)}
.dtl-count{font-size:11px;color:var(--dtl-fg2);font-weight:400}
.dtl-items{list-style:none;margin:0;padding:2px 6px 6px;display:flex;flex-direction:column;gap:1px}
.dtl-item{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;background:color-mix(in srgb,#f97316 16%,transparent);transition:background-color .2s ease}
.dtl-item:hover{background:color-mix(in srgb,#f97316 24%,transparent)}
.dtl-item[data-done="1"]{background:color-mix(in srgb,var(--dtl-ok) 17%,transparent)}
.dtl-checkbtn{flex:none;width:20px;height:20px;border-radius:50%;border:2px solid color-mix(in srgb,var(--dtl-fg2) 50%,transparent);background:transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;margin:0;transition:border-color .15s ease,background-color .2s ease,transform .12s ease}
.dtl-checkbtn:hover{border-color:var(--dtl-ok)}
.dtl-checkbtn:active{transform:scale(.9)}
.dtl-checkbtn svg{width:12px;height:12px;display:block;overflow:visible}
.dtl-tick{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:22;stroke-dashoffset:22;transition:stroke-dashoffset .22s ease .04s}
.dtl-item[data-done="1"] .dtl-checkbtn{background:var(--dtl-ok);border-color:var(--dtl-ok);animation:dtl-pop .24s cubic-bezier(.22,1,.36,1)}
.dtl-item[data-done="1"] .dtl-checkbtn .dtl-tick{stroke-dashoffset:0}
@keyframes dtl-pop{0%{transform:scale(.7)}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.dtl-checkbtn{animation:none!important;transition:none!important}.dtl-tick{transition:none!important}}
.dtl-itemview{flex:1;background:none;border:none;color:var(--dtl-fg);font:inherit;line-height:1.35;padding:1px 0;cursor:text;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;outline:none}
.dtl-item:hover .dtl-itemview{white-space:normal;overflow:visible;text-overflow:clip}
.dtl-item[data-done="1"] .dtl-itemview{text-decoration:line-through;color:var(--dtl-fg2)}
.dtl-itemtext{flex:1;background:none;border:none;color:var(--dtl-fg);font:inherit;resize:none;outline:none;line-height:1.35;padding:1px 0}
.dtl-mini{background:none;border:none;cursor:pointer;color:var(--dtl-fg2);padding:4px 6px;border-radius:6px;line-height:1;opacity:0;flex:none}
.dtl-item:hover .dtl-mini{opacity:1}
.dtl-mini:hover{color:var(--dtl-err);background:color-mix(in srgb,var(--dtl-err) 12%,transparent)}
.dtl-addrow{display:flex;gap:4px;padding:4px 8px 6px}
.dtl-input{flex:1;background:var(--dtl-bg2);color:var(--dtl-fg);border:1px solid var(--dtl-border);border-radius:8px;padding:6px 8px;font:inherit}
.dtl-btn{background:none;border:1px solid var(--dtl-border);border-radius:8px;padding:5px 10px;cursor:pointer;color:var(--dtl-fg);font:inherit}
.dtl-btn:hover:not(:disabled){background:rgba(127,127,127,.12)}
.dtl-btn:disabled{opacity:.5;cursor:default}
.dtl-note{position:relative;border:1px solid var(--dtl-border);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px}
.dtl-note[data-color="yellow"]{background:color-mix(in srgb,var(--dtl-warn) 12%,var(--dtl-bg))}
.dtl-note[data-color="green"]{background:color-mix(in srgb,var(--dtl-ok) 12%,var(--dtl-bg))}
.dtl-note[data-color="blue"]{background:color-mix(in srgb,var(--dtl-brand) 12%,var(--dtl-bg))}
.dtl-note[data-color="pink"]{background:color-mix(in srgb,var(--dtl-err) 10%,var(--dtl-bg))}
.dtl-note[data-pinned="1"][data-color="yellow"]{background:color-mix(in srgb,var(--dtl-warn) 21%,var(--dtl-bg))}
.dtl-note[data-pinned="1"][data-color="green"]{background:color-mix(in srgb,var(--dtl-ok) 21%,var(--dtl-bg))}
.dtl-note[data-pinned="1"][data-color="blue"]{background:color-mix(in srgb,var(--dtl-brand) 21%,var(--dtl-bg))}
.dtl-note[data-pinned="1"][data-color="pink"]{background:color-mix(in srgb,var(--dtl-err) 19%,var(--dtl-bg))}
.dtl-note .dtl-note-ta{background:none;border:none;color:var(--dtl-fg);font:inherit;resize:none;overflow-y:hidden;outline:none;min-height:40px;max-height:240px;box-sizing:border-box;line-height:1.4;padding:2px 0;width:100%}
.dtl-note-body{background:none;border:none;color:var(--dtl-fg);font:inherit;overflow-y:hidden;outline:none;min-height:40px;max-height:240px;box-sizing:border-box;line-height:1.4;padding:2px 0;white-space:pre-wrap;word-break:break-word;cursor:text}
.dtl-pin{position:absolute;top:-2px;left:-2px;z-index:2;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:none;cursor:pointer;color:var(--dtl-fg2);padding:2px;border-radius:6px;line-height:1;opacity:0;transition:opacity .15s ease,color .15s ease}
.dtl-note:hover .dtl-pin{opacity:.6}
.dtl-pin:hover{opacity:1;color:var(--dtl-brand);background:transparent}
.dtl-pin[data-on="1"]{opacity:1;color:var(--dtl-brand)}
.dtl-note-del{position:absolute;top:-2px;right:-2px;z-index:2;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:none;cursor:pointer;color:var(--dtl-fg2);padding:2px;border-radius:6px;line-height:1;opacity:0;transition:opacity .15s ease,color .15s ease}
.dtl-note:hover .dtl-note-del{opacity:.7}
.dtl-note-del:hover{opacity:1;color:var(--dtl-err);background:transparent}
.dtl-note-del[data-danger="1"]{opacity:1;color:var(--dtl-err)}
.dtl-note-copy{position:absolute;right:-2px;bottom:-2px;z-index:2;display:inline-flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;color:var(--dtl-fg2);padding:3px;border-radius:6px;line-height:1;opacity:0;transition:opacity .15s ease,color .15s ease}
.dtl-note:hover .dtl-note-copy{opacity:.7}
.dtl-note-copy:hover{opacity:1;color:var(--dtl-brand);background:transparent}
.dtl-ctxmenu{position:fixed;z-index:1000;min-width:150px;box-sizing:border-box;background:var(--dtl-bg);color:var(--dtl-fg);border:1px solid var(--dtl-border);border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.20);padding:8px;display:flex;flex-direction:column;gap:8px;font-weight:400;font-size:13px}
.dtl-ctx-title{font-size:11px;color:var(--dtl-fg2);padding:0 2px}
.dtl-ctx-colors{display:flex;gap:8px;padding:0 2px}
.dtl-ctx-sep{height:1px;background:var(--dtl-border)}
.dtl-ctx-del{background:none;border:none;text-align:left;color:var(--dtl-err);font:inherit;font-size:13px;padding:5px 6px;border-radius:6px;cursor:pointer}
.dtl-ctx-del:hover{background:color-mix(in srgb,var(--dtl-err) 12%,transparent)}
.dtl-ctx-item{background:none;border:none;text-align:left;color:var(--dtl-fg);font:inherit;font-size:13px;padding:5px 6px;border-radius:6px;cursor:pointer}
.dtl-ctx-item:hover{background:rgba(127,127,127,.12)}
.dtl-token{display:inline-flex;align-items:center;vertical-align:baseline;max-width:100%;margin:0 2px;padding:1px 8px;border-radius:999px;border:1px solid var(--dtl-border);background:var(--dtl-bg2);color:var(--dtl-fg);font-size:12px;line-height:1.5;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dtl-token:hover{background:rgba(127,127,127,.14)}
.dtl-token[data-type="link"]{color:var(--dtl-brand);text-decoration:underline;text-underline-offset:2px}
.dtl-token[data-type="secret"]{color:var(--dtl-err)}
.dtl-token[data-copied="1"]{border-color:var(--dtl-ok);color:var(--dtl-ok)}
.dtl-swatch{width:16px;height:16px;border-radius:50%;border:1px solid var(--dtl-border);cursor:pointer;opacity:.5}
.dtl-swatch[data-on="1"]{opacity:1;box-shadow:0 0 0 1px var(--dtl-brand)}
.dtl-swatch[data-c="yellow"]{background:var(--dtl-warn)}
.dtl-swatch[data-c="green"]{background:var(--dtl-ok)}
.dtl-swatch[data-c="blue"]{background:var(--dtl-brand)}
.dtl-swatch[data-c="pink"]{background:var(--dtl-err)}
.dtl-foot{border-top:1px solid var(--dtl-border);padding:6px 8px;font-size:11px;color:var(--dtl-fg2);display:flex;gap:6px;align-items:center}
.dtl-newlist{display:flex;gap:4px}
.dtl-cap{font-size:11px;opacity:.7;text-transform:uppercase;margin-top:4px}
.dtl-boardroot{background:var(--dtl-bg2);height:100%;box-sizing:border-box}
.dtl-board{display:flex;flex-direction:column;gap:16px;padding:18px}
.dtl-boardhead{display:flex;align-items:baseline;gap:8px;padding:2px 2px 2px}
.dtl-boardtitle{font-size:15px;font-weight:650;letter-spacing:-.01em;color:var(--dtl-fg)}
.dtl-boardsub{font-size:12px;color:var(--dtl-fg2)}
.dtl-boardgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;align-items:start}
.dtl-wscard{position:relative;display:flex;flex-direction:column;border:1px solid var(--dtl-border);border-radius:14px;background:var(--dtl-bg);overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.07),0 12px 28px -16px rgba(0,0,0,.32);max-height:50vh}
.dtl-wscard:focus-within{box-shadow:0 0 0 2px var(--dtl-brand)}
.dtl-wscard[data-dragging="1"]{opacity:.45}
.dtl-wscard[data-over="1"]::before{content:'';position:absolute;top:8px;bottom:8px;width:3px;border-radius:3px;background:var(--dtl-brand);z-index:3}
.dtl-wscard[data-over="1"][data-side="left"]::before{left:0}
.dtl-wscard[data-over="1"][data-side="right"]::before{right:0}
.dtl-wshdr{background:color-mix(in srgb,var(--dtl-brand) 8%,var(--dtl-bg2));border-bottom:1px solid var(--dtl-border);display:flex;flex-direction:column;gap:8px;padding:11px 12px;flex:none}
.dtl-wshead{display:flex;align-items:center;gap:8px;cursor:grab;user-select:none}
.dtl-wshead:active{cursor:grabbing}
.dtl-wsname{flex:1;min-width:0;font-weight:700;font-size:16px;letter-spacing:-.01em;color:var(--dtl-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dtl-wssub{display:flex;align-items:center;gap:6px;min-height:24px}
.dtl-wsmeta{flex:none;font-size:11px;color:var(--dtl-fg2);white-space:nowrap}
.dtl-wsbody{padding:8px 10px 10px;display:flex;flex-direction:column;gap:8px;overflow:auto;min-height:0;flex:1 1 auto}
.dtl-wsbody .dtl-listcard{border-color:var(--dtl-border)}
.dtl-wsempty{padding:10px 4px;color:var(--dtl-fg2);font-size:12px;text-align:center}
`

    /* ── shared app model hooks ──────────────────────── */
    function useSnapshot(ctx, workspaceId, call) {
      const [snap, setSnap] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const load = React.useCallback(
        (signal) => {
          if (!workspaceId) return Promise.resolve(null)
          setBusy(true)
          return call('snapshot', { workspaceId }, signal)
            .then((value) => { setSnap(value); setError(null); return value })
            .catch((e) => { setError(String(e.message || e)); return null })
            .finally(() => setBusy(false))
        },
        [call, workspaceId],
      )
      React.useEffect(() => {
        if (!workspaceId) return
        const c = new AbortController()
        void load(c.signal)
        return () => c.abort()
      }, [load, workspaceId])
      return { snap, busy, error, reload: load }
    }

    // Current conversation session id, from the slot's useSessions selector
    // (state.byId[session].retainedBy.mainView > 0 is the one shown in the main view).
    function useCurrentSessionId(props) {
      const useSessions = props && props.useSessions
      if (typeof useSessions !== 'function') return null
      return useSessions((state) => {
        if (!state || !state.byId) return null
        const found = Object.values(state.byId).find((s) => s && s.retainedBy && (s.retainedBy.mainView ?? 0) > 0)
        return found ? found.id : null
      })
    }

    // Resolve the workspace of the current session via the host registry. This
    // auto-switches when the user opens a session/workspace, with no dropdown.
    // Without a session (e.g. the left 看板 panel), reuse the last workspace.
    let lastWsCache = null
    function useCurrentWorkspace(call, sessionId) {
      const [state, setState] = React.useState(() => (lastWsCache ? { ...lastWsCache } : { workspaceId: null, title: '' }))
      React.useEffect(() => {
        let alive = true
        if (!sessionId && lastWsCache) {
          setState({ ...lastWsCache })
          return () => { alive = false }
        }
        call('workspace.current', { sessionId: sessionId || null })
          .then((v) => {
            if (!alive) return
            const next = { workspaceId: (v && v.workspaceId) || null, title: (v && v.title) || '' }
            setState(next)
            if (sessionId && next.workspaceId) lastWsCache = next
          })
          .catch(() => { if (alive) setState((prev) => (prev.workspaceId ? prev : { workspaceId: null, title: '' })) })
        return () => { alive = false }
      }, [call, sessionId])
      return state
    }

    /* ── measure the conversation column so the panel hugs it exactly ── */
    // The Host frame is a CSS grid: sidebarCol | centerCol | rightbarCol, so
    // centerCol's rectangle IS the conversation area. We only use it to (a) place
    // the panel initially just below the 对话/轨迹 tabs and (b) clamp dragging so
    // the panel can never leave the conversation area. The panel does NOT follow
    // the sidebar: its own position lives in component state.
    function useConvArea() {
      const [state, setState] = React.useState({ area: null, ready: false })
      React.useEffect(() => {
        if (typeof window === 'undefined') return
        let has = false
        const center = () => document.querySelector('[class*="centerCol"]')
        const measure = () => {
          const col = center()
          if (!col) return
          const cr = col.getBoundingClientRect()
          if (!(cr.width > 0 && cr.left > 0)) return // layout not settled yet
          // Top of the usable area = bottom of the view tab bar (对话/轨迹).
          let top = cr.top + 52
          const tablists = Array.from(col.querySelectorAll('[role="tablist"]'))
          const tab = tablists
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.height > 12 && r.top <= cr.top + 120)
            .sort((a, b) => a.top - b.top)[0]
          if (tab) top = tab.bottom
          else {
            const first = col.firstElementChild
            if (first) {
              const fr = first.getBoundingClientRect()
              if (fr.height > 20 && fr.height < 220 && fr.top <= cr.top + 2) top = fr.bottom
            }
          }
          setState({ area: { left: Math.round(cr.left), top: Math.round(top), right: Math.round(cr.right), bottom: Math.round(cr.bottom) }, ready: true })
          has = true
        }
        measure()
        let raf = 0
        const sched = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) }
        const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(sched) : null
        const observe = () => { const col = center(); if (col) ro && ro.observe(col); if (col && col.parentElement) ro && ro.observe(col.parentElement) }
        observe()
        window.addEventListener('resize', sched)
        document.addEventListener('transitionend', sched, true)
        const iv = window.setInterval(() => { if (!has) { observe(); measure() } }, 500)
        return () => {
          ro && ro.disconnect()
          window.removeEventListener('resize', sched)
          document.removeEventListener('transitionend', sched, true)
          clearInterval(iv)
          cancelAnimationFrame(raf)
        }
      }, [])
      return state
    }

    /* ── todo list widget ────────────────────────────── */
    // Display a todo's text as a single truncatable line; click to edit inline.
    function ItemText({ item, call, workspaceId, listId, onChange }) {
      const [editing, setEditing] = React.useState(false)
      if (editing) {
        return h('textarea', {
          className: 'dtl-itemtext', rows: 1, autoFocus: true, defaultValue: item.text, 'aria-label': '事项内容',
          onClick: (e) => e.stopPropagation(),
          onBlur: (e) => { setEditing(false); const t = e.target.value.trim(); if (t && t !== item.text) void call('item.update', { workspaceId, listId, itemId: item.id, text: t }).then(onChange).catch((err) => onChange && onChange(null, err)) },
          onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.target.blur(); if (e.key === 'Escape') setEditing(false) },
        })
      }
      return h('div', {
        className: 'dtl-itemview', title: '点击编辑', role: 'textbox', tabIndex: 0, 'aria-label': '事项内容',
        onClick: (e) => { e.stopPropagation(); setEditing(true) },
      }, item.text || ' ')
    }

    function ListTitle({ list, call, workspaceId, onChange, onToggle, expanded }) {
      const [editing, setEditing] = React.useState(false)
      const [title, setTitle] = React.useState('')
      const [saving, setSaving] = React.useState(false)
      const [error, setError] = React.useState('')
      const clickTimer = React.useRef(null)
      const active = React.useRef(false)
      const pending = React.useRef(false)
      const inputRef = React.useRef(null)
      const buttonRef = React.useRef(null)
      const restoreFocus = React.useRef(false)
      const clearClick = () => { clearTimeout(clickTimer.current); clickTimer.current = null }
      React.useEffect(() => () => clearTimeout(clickTimer.current), [])
      React.useEffect(() => {
        if (editing) { inputRef.current?.focus(); inputRef.current?.select() }
        else if (restoreFocus.current) { restoreFocus.current = false; buttonRef.current?.focus() }
      }, [editing])
      const start = () => {
        clearClick()
        active.current = true
        setTitle(list.title || '')
        setError('')
        setEditing(true)
      }
      const save = async (fromKeyboard = false) => {
        if (!active.current || pending.current) return
        const next = title.trim()
        if (!next) { setError('清单名称不能为空，请输入名称。'); return }
        restoreFocus.current = fromKeyboard
        if (next === list.title) { active.current = false; setEditing(false); return }
        pending.current = true
        setSaving(true)
        setError('')
        try {
          const result = await call('list.rename', { workspaceId, listId: list.id, title: next })
          active.current = false
          setEditing(false)
          onChange?.(result)
        } catch (err) {
          setError(`重命名失败：${String(err.message || err)}。请按回车重试。`)
        } finally {
          pending.current = false
          setSaving(false)
        }
      }
      return h('div', { className: 'dtl-listtitle', onClick: (e) => e.stopPropagation(), onDoubleClick: (e) => e.stopPropagation() },
        editing
          ? h('input', {
              ref: inputRef, className: 'dtl-listtitle-input', value: title, maxLength: 500,
              'aria-label': '清单名称', 'aria-invalid': !!error, 'aria-busy': saving, readOnly: saving,
              title: '回车保存，Esc 取消，点击其他位置保存',
              onChange: (e) => { setTitle(e.target.value); setError('') },
              onBlur: () => { void save() },
              onKeyDown: (e) => {
                e.stopPropagation()
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter') { e.preventDefault(); void save(true) }
                if (e.key === 'Escape' && !pending.current) {
                  e.preventDefault(); active.current = false; restoreFocus.current = true; setEditing(false); setError('')
                }
              },
            })
          : h('button', {
              ref: buttonRef, type: 'button', className: 'dtl-listtitle-btn',
              title: '单击展开/收起，双击重命名（键盘 F2）', 'aria-expanded': expanded,
              onClick: (e) => {
                clearClick()
                if (e.detail === 0) onToggle()
                else if (e.detail === 1) clickTimer.current = setTimeout(onToggle, 300)
              },
              onDoubleClick: start,
              onKeyDown: (e) => { if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); start() } },
            }, list.title || '未命名清单', h('span', { className: 'dtl-count' }, ` ${list.items.filter((i) => i.done).length}/${list.items.length}`)),
        editing && error ? h('span', { className: 'dtl-listtitle-status', role: 'alert' }, error) : null,
        editing && saving ? h('span', { className: 'dtl-listtitle-status', role: 'status' }, '正在保存…') : null,
      )
    }

    function ListCard({ list, call, workspaceId, onChange, index, pinned, onTogglePin }) {
      const [hi, setHi] = usePersistentToggle('dsh-todolist-list-expanded', list.id, false)
      const [adding, setAdding] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const [confirmDel, setConfirmDel] = React.useState(false)
      const colorIdx = hashId(list.id) % 5
      const reload = (v) => onChange(v)
      // Delete needs two clicks; the confirmation auto-cancels after a moment.
      React.useEffect(() => {
        if (!confirmDel) return () => {}
        const t = setTimeout(() => setConfirmDel(false), 3000)
        return () => clearTimeout(t)
      }, [confirmDel])
      // Empty lists show the input without a click; otherwise the ＋事项
      // button opens it. Either way it closes right after one item is added.
      const showAdd = adding || list.items.length === 0
      const addItem = () => {
        const t = draft.trim()
        if (!t) return
        setDraft('')
        setAdding(false)
        void call('item.add', { workspaceId, listId: list.id, text: t }).then(reload).catch((err) => onChange && onChange(null, err))
      }
      return h(
        'div',
        { className: 'dtl-listcard' },
        h(
          'div',
          { className: 'dtl-listhead', 'data-c': colorIdx, 'data-pinned': pinned ? 1 : 0, onClick: () => setHi(!hi) },
          h(ListTitle, { key: `${workspaceId}/${list.id}`, list, call, workspaceId, onChange, expanded: hi, onToggle: () => setHi((open) => !open) }),
          h(
            'button',
            {
              className: 'dtl-iconbtn dtl-list-pin', 'data-on': pinned ? 1 : 0,
              title: pinned ? '取消置顶清单' : '置顶清单', 'aria-label': pinned ? '取消置顶清单' : '置顶清单', 'aria-pressed': pinned ? 'true' : 'false',
              onClick: (e) => { e.stopPropagation(); if (onTogglePin) onTogglePin() },
            },
            h(PinIcon, { size: 13 }),
          ),
          h(
            'button',
            {
              className: 'dtl-iconbtn', title: '添加事项', 'aria-label': '添加事项',
              onClick: (e) => { e.stopPropagation(); setHi(true); setAdding(true) },
            },
            h(Icon, { d: ICON.plus }),
          ),
          h(
            'button',
            {
              className: 'dtl-iconbtn', 'data-danger': confirmDel ? 1 : 0,
              title: confirmDel ? '再次点击确认删除清单' : '删除清单',
              'aria-label': confirmDel ? '确认删除清单' : '删除清单',
              onClick: (e) => {
                e.stopPropagation()
                if (confirmDel) { void call('list.delete', { workspaceId, listId: list.id }).then(reload).catch((err) => onChange && onChange(null, err)) }
                else setConfirmDel(true)
              },
            },
            h(Icon, { d: confirmDel ? ICON.check : ICON.x }),
          ),
        ),
        hi
          ? h(
              'div',
              null,
              showAdd
                ? h('div', { className: 'dtl-addrow' },
                    h('input', {
                      className: 'dtl-input', placeholder: '输入事项，回车添加', 'aria-label': '添加事项', autoFocus: adding, value: draft,
                      onClick: (e) => e.stopPropagation(),
                      onChange: (e) => setDraft(e.target.value),
                      onBlur: () => { setAdding(false); setDraft('') },
                      onKeyDown: (e) => {
                        if (e.key === 'Enter') addItem()
                        if (e.key === 'Escape') { setAdding(false); setDraft('') }
                      },
                    }),
                  )
                : null,
              h('ul', { className: 'dtl-items' }, list.items.map((item, idx) =>
                h('li', { key: item.id, className: 'dtl-item', 'data-done': item.done ? 1 : 0 },
                  h('button', {
                    type: 'button', className: 'dtl-checkbtn',
                    'aria-pressed': item.done ? 'true' : 'false',
                    'aria-label': item.done ? '标记为未完成' : '标记为完成',
                    title: item.done ? '标记为未完成' : '标记为完成',
                    onClick: (e) => { e.stopPropagation(); void call('item.toggle', { workspaceId, listId: list.id, itemId: item.id, done: !item.done }).then(reload).catch((err) => onChange && onChange(null, err)) },
                  },
                    h('svg', { viewBox: '0 0 24 24', 'aria-hidden': true },
                      h('path', { className: 'dtl-tick', d: 'M5 12.5l4.5 4.5L19 7' }),
                    ),
                  ),
                  h(ItemText, { item, call, workspaceId, listId: list.id, onChange: reload }),
                  h('button', { className: 'dtl-mini', title: '删除事项', 'aria-label': '删除事项', onClick: () => void call('item.remove', { workspaceId, listId: list.id, itemId: item.id }).then(reload).catch((err) => onChange && onChange(null, err)) }, h(Icon, { d: ICON.x, size: 17 })),
                ),
              )),
            )
          : null,
      )
    }

    /* ── tab container used by both overlay and panel ── */
    function App({ ctx, workspaceId, workspaceTitle, call, compact, drag, onCollapse }) {
      const state = useSnapshot(ctx, workspaceId, call)
      const { snap, reload } = state
      const [tab, setTab] = React.useState(() => {
        try { return localStorage.getItem('dsh-todolist-tab') === 'notes' ? 'notes' : 'todo' } catch { return 'todo' }
      })
      const [creating, setCreating] = React.useState(false)
      const [newTitle, setNewTitle] = React.useState('')
      const onchange = (v) => { if (v) reload() }
      const snapId = React.useRef(0)
      React.useEffect(() => { snapId.current++ }, [snap])

      const createList = () => {
        const t = newTitle.trim() || '新清单'
        setCreating(false)
        setNewTitle('')
        void call('list.create', { workspaceId, title: t }).then(onchange).catch((err) => onchange(null, err))
      }
      const addNote = () => {
        const pal = (snap && snap.colors) || ['yellow', 'green', 'blue', 'pink']
        const n = (snap && snap.notes && snap.notes.length) || 0
        const color = pal[n % pal.length]
        void call('note.add', { workspaceId, text: '', color }).then(onchange).catch((err) => onchange(null, err))
      }
      const switchTab = (next) => { setTab(next); try { localStorage.setItem('dsh-todolist-tab', next) } catch { /* ignore */ } ; setCreating(false); setNewTitle('') }

      // sidecar: aggregate counts for the sidebar icon
      if (typeof window !== 'undefined') {
        try {
          const container = document
          const totals = snap ? { lists: snap.lists.length, notes: snap.notes.length } : null
          container.__dshTodolistTotals = totals
        } catch { /* ignore */ }
      }

      const headRight = tab === 'notes'
        ? h('button', { className: 'dtl-iconbtn', onClick: addNote, title: '新建便签', 'aria-label': '新建便签' }, h(Icon, { d: ICON.plus }))
        : (creating
            ? h('input', {
                className: 'dtl-head-input', autoFocus: true, placeholder: '清单名，回车新建', value: newTitle,
                onChange: (e) => setNewTitle(e.target.value),
                onKeyDown: (e) => { if (e.key === 'Enter') createList(); if (e.key === 'Escape') { setCreating(false); setNewTitle('') } },
                onBlur: () => { setCreating(false); setNewTitle('') },
              })
            : h('button', { className: 'dtl-iconbtn', onClick: () => setCreating(true), title: '新建清单', 'aria-label': '新建清单' }, h(Icon, { d: ICON.plus })))

      return h('div', { className: 'dtl-root' },
        h('style', { type: 'text/css' }, STYLE),
        h('div', { className: 'dtl-head' },
          h('div', { className: 'dtl-tabs', role: 'tablist', 'aria-label': '待办与便签' },
            h('button', { role: 'tab', 'data-on': tab === 'todo' ? 1 : 0, className: 'dtl-tab', 'aria-selected': tab === 'todo', onClick: () => switchTab('todo') }, '待办'),
            h('button', { role: 'tab', 'data-on': tab === 'notes' ? 1 : 0, className: 'dtl-tab', 'aria-selected': tab === 'notes', onClick: () => switchTab('notes') }, '便签'),
          ),
          h('div', Object.assign({ className: 'dtl-dragspace', title: '按住拖动面板', role: 'presentation' }, drag || {})),
          h('button', {
            className: 'dtl-iconbtn dtl-gh', 'aria-label': '在浏览器打开 GitHub 项目主页（欢迎 Star ~）',
            onClick: () => openExternal('https://github.com/jesongit/dsh-todolist'),
          },
            h('svg', { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true },
              h('path', { d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z' }),
            ),
          ),
          headRight,
          onCollapse
            ? h('button', { className: 'dtl-iconbtn', title: '收起', 'aria-label': '收起', onClick: onCollapse },
                h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
                  h('path', { d: 'M6 15l6-6 6 6' }),
                ),
              )
            : null,
        ),
        h('div', { className: 'dtl-body' },
          state.error ? h('div', { className: 'dtl-empty', role: 'alert' }, '加载失败：', String(state.error)) : null,
          tab === 'todo'
            ? h(TodoTab, { workspaceId, snap, call, onchange })
            : h(NotesTab, { workspaceId, snap, call, onchange }),
        ),
      )
    }

    function TodoTab({ workspaceId, snap, call, onchange }) {
      const lists = (snap && snap.lists) || []
      const [pins, togglePin] = useListPins(workspaceId)
      const ordered = orderLists(lists, pins)
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        lists.length === 0 ? h('div', { className: 'dtl-empty' }, '暂无待办清单，点右上角「＋新建」创建。') : null,
        ordered.map((list, i) => h(ListCard, { key: list.id, list, call, workspaceId, onChange: onchange, index: i, pinned: pins.includes(list.id), onTogglePin: () => togglePin(list.id) })),
      )
    }

    /* ── sticky note: right-click menu (copy/color/delete) + smart copy chips ── */
    function NoteCard({ note, call, workspaceId, colors, onChange, pinned, onTogglePin }) {
      const [menu, setMenu] = React.useState(null) // {x, y}
      const [copied, setCopied] = React.useState(null)
      const [editing, setEditing] = React.useState(false)
      const [confirmDel, setConfirmDel] = React.useState(false)
      const colorLabel = { yellow: '黄', green: '绿', blue: '蓝', pink: '粉' }
      const close = () => setMenu(null)
      // Delete needs two clicks (like todo lists); auto-cancels after a moment.
      React.useEffect(() => {
        if (!confirmDel) return () => {}
        const t = setTimeout(() => setConfirmDel(false), 3000)
        return () => clearTimeout(t)
      }, [confirmDel])
      const taRef = React.useRef(null)
      const segRef = React.useRef(null)
      const clickTimer = React.useRef(null)
      // A leading backtick opts the note out of link/secret detection ("raw"
      // mode). The backtick itself is hidden in the read view, shown only while
      // editing.
      const raw = /^\s*`/.test(note.text || '')
      const segs = React.useMemo(() => {
        if (raw) { const body = String(note.text || '').replace(/^\s*`/, ''); return [{ text: body || ' ' }] }
        return buildSegments(note.text)
      }, [note.text, raw])
      // Auto-grow with content; no scrollbar until it hits the cap. We toggle
      // overflow off while the content fits to avoid a phantom scrollbar from
      // sub-pixel rounding, and re-measure when the width changes.
      const autosize = React.useCallback(() => {
        const el = taRef.current
        if (!el) return
        el.style.height = 'auto'
        const full = el.scrollHeight
        if (full >= 238) {
          el.style.height = '240px'
          el.style.overflowY = 'auto'
        } else {
          el.style.height = `${full}px`
          el.style.overflowY = 'hidden'
        }
      }, [])
      React.useLayoutEffect(() => {
        autosize()
        const el = taRef.current
        if (!el || typeof ResizeObserver !== 'function') return () => {}
        let raf = 0
        let lastW = el.clientWidth
        const ro = new ResizeObserver(() => {
          if (el.clientWidth === lastW) return // ignore our own height changes
          lastW = el.clientWidth
          cancelAnimationFrame(raf)
          raf = requestAnimationFrame(autosize)
        })
        ro.observe(el)
        return () => { ro.disconnect(); cancelAnimationFrame(raf) }
      }, [autosize, editing])
      React.useEffect(() => {
        if (!menu) return () => {}
        const onDown = (e) => { if (!(e.target && e.target.closest && e.target.closest('[data-dtl-ctx]'))) close() }
        const onKey = (e) => { if (e.key === 'Escape') close() }
        const onScroll = () => close()
        document.addEventListener('pointerdown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onScroll)
        return () => {
          document.removeEventListener('pointerdown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
          window.removeEventListener('scroll', onScroll, true)
          window.removeEventListener('resize', onScroll)
        }
      }, [menu])
      const showCopied = (k) => { setCopied(k); window.setTimeout(() => setCopied((c) => (c === k ? null : c)), 1200) }
      const copyValue = (value, k) => { copyText(value).then(() => showCopied(k)).catch(() => {}) }
      // Link chip: single click copies, double click opens in the browser. A short
      // timer distinguishes the two so a double click does not also copy.
      const onLinkClick = (t, k) => {
        if (clickTimer.current) { window.clearTimeout(clickTimer.current); clickTimer.current = null; return }
        clickTimer.current = window.setTimeout(() => { clickTimer.current = null; copyValue(t.value, k) }, 230)
      }
      const onLinkDbl = (t) => {
        if (clickTimer.current) { window.clearTimeout(clickTimer.current); clickTimer.current = null }
        openExternal(t.value)
      }
      // Copy the whole note; a leading backtick (raw mode) is stripped.
      const copyNoteAll = () => {
        const src = editing && taRef.current ? taRef.current.value : (note.text || '')
        const out = /^\s*`/.test(src) ? String(src).replace(/^\s*`/, '') : src
        copyText(out).catch(() => {})
      }
      const setColor = (c) => { close(); if (note.color !== c) void call('note.setColor', { workspaceId, noteId: note.id, color: c }).then(onChange).catch((err) => onChange(null, err)) }
      const remove = () => { close(); void call('note.remove', { workspaceId, noteId: note.id }).then(onChange).catch((err) => onChange(null, err)) }
      // Render inline segments: plain text runs + clickable chips (values shown).
      const renderSegs = () => h('div', {
        ref: segRef, className: 'dtl-note-body', role: 'textbox', 'aria-label': '便签内容', tabIndex: 0,
        onClick: (e) => { setEditing(true) },
      }, segs.map((s) => s.token
        ? h('button', {
            key: s.token.key, type: 'button', className: 'dtl-token', 'data-type': s.token.type, 'data-copied': copied === s.token.key ? 1 : 0,
            title: s.token.type === 'link' ? '单击复制链接，双击用浏览器打开' : '单击复制',
            onClick: (e) => { e.stopPropagation(); s.token.type === 'link' ? onLinkClick(s.token, s.token.key) : copyValue(s.token.value, s.token.key) },
            onDoubleClick: s.token.type === 'link' ? (e) => { e.stopPropagation(); onLinkDbl(s.token) } : undefined,
          }, copied === s.token.key ? '已复制 ✓' : s.token.label)
        : s.text))
      const saveEdit = () => {
        setEditing(false)
        const t = (taRef.current && taRef.current.value || '').trim()
        if (t !== note.text) void call('note.update', { workspaceId, noteId: note.id, text: t }).then(onChange).catch((err) => onChange(null, err))
      }
      return h('div', {
        className: 'dtl-note', 'data-color': note.color, 'data-raw': raw ? 1 : 0, 'data-pinned': pinned ? 1 : 0, title: '点击编辑，右键可改颜色',
        onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }) },
      },
        h('button', {
          className: 'dtl-pin', type: 'button', 'data-on': pinned ? 1 : 0,
          title: pinned ? '取消置顶' : '置顶便签', 'aria-label': pinned ? '取消置顶' : '置顶便签', 'aria-pressed': pinned ? 'true' : 'false',
          onClick: (e) => { e.stopPropagation(); if (onTogglePin) onTogglePin() },
        }, h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true },
          h('path', { d: 'M16 9V4h1V2H7v2h1v5c0 1.66-1.34 3-3 3v2h5.97v7.01l1 1 1-1V14H19v-2c-1.66 0-3-1.34-3-3z' }),
        )),
        h('button', {
          className: 'dtl-note-del', type: 'button', 'data-danger': confirmDel ? 1 : 0,
          title: confirmDel ? '再次点击确认删除便签' : '删除便签', 'aria-label': confirmDel ? '确认删除便签' : '删除便签',
          onClick: (e) => { e.stopPropagation(); if (confirmDel) remove(); else setConfirmDel(true) },
        }, h(Icon, { d: confirmDel ? ICON.check : ICON.x, size: 14 })),
        h('button', {
          className: 'dtl-note-copy', type: 'button', title: '复制全部内容', 'aria-label': '复制全部内容',
          onClick: (e) => { e.stopPropagation(); copyNoteAll() },
          onDoubleClick: (e) => e.stopPropagation(),
        }, h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }),
          h('path', { d: 'M5 15V5a2 2 0 0 1 2-2h8' }),
        )),
        editing
          ? h('textarea', { ref: taRef, rows: 1, defaultValue: note.text, autoFocus: true, 'aria-label': '便签内容', className: 'dtl-note-ta', onInput: autosize, onBlur: saveEdit, onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit() } })
          : renderSegs(),
        menu
          ? h('div', {
              className: 'dtl-ctxmenu', 'data-dtl-ctx': 1,
              style: { left: `${Math.max(8, Math.min(menu.x, (window.innerWidth || 9999) - 190))}px`, top: `${Math.max(8, Math.min(menu.y, (window.innerHeight || 9999) - 160))}px` },
              onContextMenu: (e) => e.preventDefault(),
            },
              h('div', { className: 'dtl-ctx-title' }, '便签颜色'),
              h('div', { className: 'dtl-ctx-colors' }, colors.map((c) => h('button', { key: c, className: 'dtl-swatch', 'data-c': c, 'data-on': note.color === c ? 1 : 0, title: colorLabel[c] || c, 'aria-label': `设为${colorLabel[c] || c}色`, onClick: () => setColor(c) }))),
            )
          : null,
      )
    }

    function NotesTab({ workspaceId, snap, call, onchange }) {
      const notes = (snap && snap.notes) || []
      const colors = (snap && snap.colors) || ['yellow', 'green', 'blue', 'pink']
      const [pins, togglePin] = useNotePins(workspaceId)
      const ordered = orderNotes(notes, pins)
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        notes.length === 0 ? h('div', { className: 'dtl-empty' }, '暂无便签，点右上角「＋」添加；右键便签可改色或删除。') : null,
        ordered.map((note) => h(NoteCard, { key: note.id, note, call, workspaceId, colors, onChange: onchange, pinned: pins.includes(note.id), onTogglePin: () => togglePin(note.id) })),
      )
    }

    /* ── aggregate board: tasks grouped by workspace ─── */
    function useBoard(call) {
      const [state, setState] = React.useState({ groups: null, error: null, busy: false })
      const load = React.useCallback((signal) => {
        setState((s) => ({ ...s, busy: true }))
        return call('board', {})
          .then((value) => { setState({ groups: (value && value.groups) || [], error: null, busy: false }); return value })
          .catch((e) => setState((s) => ({ ...s, busy: false, error: String((e && e.message) || e) })))
      }, [call])
      React.useEffect(() => {
        const c = new AbortController()
        void load(c.signal)
        return () => c.abort()
      }, [load])
      return { ...state, reload: load }
    }

    function WorkspaceCard({ group, call, onchange, drag }) {
      const [open, setOpen] = usePersistentToggle('dsh-todolist-ws-expanded', group.workspaceId, true)
      const [creating, setCreating] = React.useState(false)
      const [title, setTitle] = React.useState('')
      const lists = group.lists || []
      const notes = group.notes || []
      const colors = group.colors || ['yellow', 'green', 'blue', 'pink']
      const [pins, togglePin] = useNotePins(group.workspaceId)
      const orderedNotes = orderNotes(notes, pins)
      const [listPins, toggleListPin] = useListPins(group.workspaceId)
      const orderedLists = orderLists(lists, listPins)
      const itemCount = lists.reduce((n, l) => n + (l.items || []).length, 0)
      const commitList = () => {
        const t = title.trim()
        setCreating(false)
        setTitle('')
        if (!t) return
        void call('list.create', { workspaceId: group.workspaceId, title: t }).then(onchange).catch((err) => onchange(null, err))
      }
      const addNote = () => {
        const color = colors[notes.length % colors.length]
        void call('note.add', { workspaceId: group.workspaceId, text: '', color }).then(onchange).catch((err) => onchange(null, err))
      }
      return h('section', {
        className: 'dtl-wscard', 'data-ws': group.workspaceId,
        'data-dragging': drag && drag.id === group.workspaceId ? 1 : 0,
        'data-over': drag && drag.over === group.workspaceId && drag.id !== group.workspaceId ? 1 : 0,
        'data-side': drag && drag.over === group.workspaceId && drag.id !== group.workspaceId ? drag.side : undefined,
        onDragOver: (e) => {
          if (!drag) return
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          drag.onDragOver(group.workspaceId, e.clientX < r.left + r.width / 2 ? 'left' : 'right')
        },
        onDrop: (e) => {
          if (!drag) return
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          drag.onDrop(group.workspaceId, e.clientX < r.left + r.width / 2 ? 'left' : 'right')
        },
        onDragEnd: () => { if (drag) drag.onDragEnd() },
      },
        h('div', { className: 'dtl-wshdr' },
          h('div', {
            className: 'dtl-wshead',
            draggable: drag ? true : undefined,
            title: drag ? '按住拖动调整卡片顺序，点击展开/收起' : undefined,
            onDragStart: (e) => {
              if (!drag) return
              drag.onDragStart(group.workspaceId)
              try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', group.workspaceId) } catch { /* ignore */ }
            },
            onClick: () => setOpen(!open),
          },
            h('span', { className: 'dtl-wsname' }, group.title || group.workspaceId),
            h('span', { 'aria-hidden': true, style: { color: 'var(--dtl-fg2)', fontSize: 14, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' } }, '›'),
          ),
          h('div', { className: 'dtl-wssub' },
            h('span', { className: 'dtl-wsmeta' }, `${lists.length} 清单 · ${notes.length} 便签 · ${itemCount} 项`),
            h('span', { style: { flex: 1 } }),
            creating
              ? h('input', {
                  className: 'dtl-head-input', autoFocus: true, placeholder: '清单名，回车新建', value: title,
                  onChange: (e) => setTitle(e.target.value),
                  onKeyDown: (e) => { if (e.key === 'Enter') commitList(); if (e.key === 'Escape') { setCreating(false); setTitle('') } },
                  onBlur: () => { if (!title.trim()) { setCreating(false); setTitle('') } },
                })
              : h('button', { className: 'dtl-head-new', title: '在本工作区新建清单', onClick: () => setCreating(true) }, '＋清单'),
            h('button', { className: 'dtl-head-new', title: '在本工作区新建便签', onClick: addNote }, '＋便签'),
          ),
        ),
        open
          ? h('div', { className: 'dtl-wsbody' },
              lists.length === 0 && notes.length === 0
                ? h('div', { className: 'dtl-wsempty' }, '该工作区暂无任务')
                : null,
              orderedLists.map((list, i) => h(ListCard, { key: list.id, list, call, workspaceId: group.workspaceId, onChange: onchange, index: i, pinned: listPins.includes(list.id), onTogglePin: () => toggleListPin(list.id) })),
              orderedNotes.map((note) => h(NoteCard, { key: note.id, note, call, workspaceId: group.workspaceId, colors, onChange: onchange, pinned: pins.includes(note.id), onTogglePin: () => togglePin(note.id) })),
            )
          : null,
      )
    }

    // Board card order: remembered per profile in localStorage; unknown ids
    // (newly appearing workspaces) fall to the end, alphabetically.
    function loadOrder() {
      try { const raw = localStorage.getItem('dsh-todolist-order'); const v = raw ? JSON.parse(raw) : null; return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] }
    }
    function orderGroups(groups, order) {
      const idx = new Map(order.map((id, i) => [id, i]))
      return groups.slice().sort((a, b) => {
        const ia = idx.has(a.workspaceId) ? idx.get(a.workspaceId) : Infinity
        const ib = idx.has(b.workspaceId) ? idx.get(b.workspaceId) : Infinity
        if (ia !== ib) return ia - ib
        return String(a.title || '').localeCompare(String(b.title || ''), 'zh')
      })
    }

    function BoardMain(props) {
      const call = ctxRef.call
      const board = useBoard(call)
      const groups = board.groups || []
      const reload = (v) => { if (v) board.reload() }
      const [order, setOrder] = React.useState(loadOrder)
      const [dragId, setDragId] = React.useState(null)
      const [overId, setOverId] = React.useState(null)
      const [overSide, setOverSide] = React.useState(null)
      const ordered = React.useMemo(() => orderGroups(groups, order), [groups, order])
      const moveCard = (fromId, toId, side) => {
        if (!fromId || fromId === toId) return
        const ids = ordered.map((g) => g.workspaceId)
        const without = ids.filter((id) => id !== fromId)
        let at = without.indexOf(toId)
        if (at < 0) return
        if (side === 'right') at += 1
        without.splice(at, 0, fromId)
        setOrder(without)
        try { localStorage.setItem('dsh-todolist-order', JSON.stringify(without)) } catch { /* ignore */ }
      }
      const drag = {
        id: dragId, over: overId, side: overSide,
        onDragStart: (id) => setDragId(id),
        onDragOver: (id, side) => { if (dragId && dragId !== id) { setOverId(id); setOverSide(side) } },
        onDrop: (id, side) => { moveCard(dragId, id, side); setDragId(null); setOverId(null); setOverSide(null) },
        onDragEnd: () => { setDragId(null); setOverId(null); setOverSide(null) },
      }
      const totals = ordered.reduce((acc, g) => {
        acc.ws += 1
        acc.lists += (g.lists || []).length
        acc.items += (g.lists || []).reduce((n, l) => n + (l.items || []).length, 0)
        return acc
      }, { ws: 0, lists: 0, items: 0 })
      return h(DtlBoundary, null, h('div', { style: { height: '100%', boxSizing: 'border-box', overflow: 'auto' } },
        h('div', { className: 'dtl-root dtl-boardroot' },
          h('style', { type: 'text/css' }, STYLE),
          h('div', { className: 'dtl-board' },
            h('div', { className: 'dtl-boardhead' },
              h('span', { className: 'dtl-boardtitle' }, '待办清单'),
              h('span', { className: 'dtl-boardsub' }, `${totals.ws} 个工作区 · ${totals.lists} 清单 · ${totals.items} 项`),
            ),
            board.error ? h('div', { className: 'dtl-empty', role: 'alert' }, '加载失败：', board.error) : null,
            ordered.length === 0
              ? h('div', { className: 'dtl-empty' }, '还没有任何任务，从页面右上角的浮窗开始创建。')
              : h('div', { className: 'dtl-boardgrid' }, ordered.map((g) => h(WorkspaceCard, { key: g.workspaceId, group: g, call, onchange: reload, drag }))),
          ),
        ),
      ))
    }

    /* ── floating overlay (collapsible, draggable) ───── */
    const PANEL_W = 330
    const PANEL_MIN_H = 120
    const PANEL_GAP = 16 // breathing room from the conversation area's left/right/top edges
    function FloatingPanel(ctxRef, call) {
      return function FloatingPanelInner(props) {
        const ctx = ctxRef.ctx
        const sessionId = useCurrentSessionId(props)
        const ws = useCurrentWorkspace(call, sessionId)
        const { area } = useConvArea()
        const traj = useTrajectoryView()
        // Expand state is remembered per workspace; default is collapsed.
        const [openMap, setOpenMap] = React.useState(loadPanelOpenMap)
        const wsKey = ws.workspaceId || ''
        const open = wsKey && Object.prototype.hasOwnProperty.call(openMap, wsKey) ? !!openMap[wsKey] : false
        const setOpen = (val) => {
          const next = typeof val === 'function' ? val(open) : val
          setOpenMap((m) => { const nm = { ...m, [wsKey]: next }; savePanelOpenMap(nm); return nm })
        }
        // Panel's own top-left; null until placed once inside the area.
        const [pos, setPos] = React.useState(null)
        const [dragging, setDragging] = React.useState(false)
        const dragRef = React.useRef(null)

        // Counts shown on the collapsed pill (fetched when collapsed).
        const [counts, setCounts] = React.useState(null)
        React.useEffect(() => {
          if (open || !ws.workspaceId) { return }
          let alive = true
          call('snapshot', { workspaceId: ws.workspaceId }).then((snap) => {
            if (!alive) return
            let pending = 0, done = 0
            for (const l of (snap && snap.lists) || []) for (const it of (l.items || [])) { if (it.done) done++; else pending++ }
            setCounts({ pending, done, notes: ((snap && snap.notes) || []).length })
          }).catch(() => { if (alive) setCounts(null) })
          return () => { alive = false }
        }, [open, call, ws.workspaceId])

        // Responsive width: normally PANEL_W, but never wider than the
        // conversation area. When the window is shrunk the column may become
        // narrower than 330px; clamping the width (not just x) keeps the panel
        // fully inside the column so nothing spills or overlaps it.
        const panelW = area
          ? Math.min(PANEL_W, Math.max(0, area.right - area.left - 2 * PANEL_GAP))
          : PANEL_W

        // Only render while the Conversation main panel is active (activePanelId null/undefined).
        const usePanelInfo = props && props.usePanelInfo
        const isConversation = typeof usePanelInfo === 'function'
          ? usePanelInfo((info) => info.activePanelId == null)
          : true

        // Clamp a top-left so the panel stays inside the conversation area with
        // PANEL_GAP on all four sides (uniform spacing).
        const clamp = React.useCallback((x, y) => {
          if (!area) return { x: Math.max(0, x), y: Math.max(0, y) }
          const minX = area.left + PANEL_GAP
          const maxX = Math.max(minX, area.right - panelW - PANEL_GAP)
          const maxY = Math.max(0, area.bottom - PANEL_MIN_H - PANEL_GAP)
          const minY = Math.min(area.top + PANEL_GAP, maxY)
          return {
            x: Math.min(Math.max(x, minX), maxX),
            y: Math.min(Math.max(y, minY), maxY),
          }
        }, [area, panelW])

        // Place once the area is known (and only once, so it does not chase layout).
        React.useEffect(() => {
          if (!area || pos !== null) return
          let saved = null
          try { const raw = localStorage.getItem('dsh-todolist-pos'); if (raw) saved = JSON.parse(raw) } catch { /* ignore */ }
          const init = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
            ? saved
            : { x: area.left + PANEL_GAP, y: area.top + PANEL_GAP }
          const c = clamp(init.x, init.y)
          setPos(c)
        }, [area, pos, clamp])

        // Keep the panel clamped if the area later shrinks (e.g. window resize),
        // without otherwise moving it.
        React.useEffect(() => {
          if (!area || pos === null) return
          const c = clamp(pos.x, pos.y)
          if (c.x !== pos.x || c.y !== pos.y) setPos(c)
        }, [area, pos, clamp])

        const onGripDown = React.useCallback((e) => {
          if (e.button !== 0) return
          e.preventDefault()
          e.stopPropagation()
          dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos ? pos.x : (area ? area.left : 0), origY: pos ? pos.y : (area ? area.top : 0) }
          setDragging(true)
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
        }, [pos, area])

        const onGripMove = React.useCallback((e) => {
          const d = dragRef.current
          if (!d) return
          const c = clamp(d.origX + (e.clientX - d.startX), d.origY + (e.clientY - d.startY))
          setPos(c)
        }, [clamp])

        const onGripUp = React.useCallback((e) => {
          if (!dragRef.current) return
          dragRef.current = null
          setDragging(false)
          try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
          setPos((p) => {
            if (p) { try { localStorage.setItem('dsh-todolist-pos', JSON.stringify(p)) } catch { /* ignore */ } }
            return p
          })
        }, [])

        if (!isConversation || traj) return null
        // Fallback area/pos so the panel still renders even if the area
        // measurement has not settled (e.g. right after switching conversation
        // views such as 对话 → 轨迹). Previously `!ready || !pos` could hide it.
        const effArea = area || (() => {
          const col = typeof document !== 'undefined' ? document.querySelector('[class*="centerCol"]') : null
          if (col) { const r = col.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return { left: r.left, top: r.top + 52, right: r.right, bottom: r.bottom } }
          return { left: 0, top: 80, right: (typeof window !== 'undefined' ? window.innerWidth : 1200), bottom: (typeof window !== 'undefined' ? window.innerHeight : 800) }
        })()
        const effPos = pos || { x: effArea.left + PANEL_GAP, y: effArea.top + PANEL_GAP }
        const effW = Math.min(PANEL_W, Math.max(0, effArea.right - effArea.left - 2 * PANEL_GAP)) || PANEL_W
        // Height cap: never taller than half the conversation area.
        const effMaxH = Math.max(160, Math.min(effArea.bottom - effPos.y - PANEL_GAP, (effArea.bottom - effArea.top) / 2))
        const stat = (color, n, label) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600 } },
          h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' } }),
          `${n} ${label}`,
        )
        const drag = { onPointerDown: onGripDown, onPointerMove: onGripMove, onPointerUp: onGripUp, onPointerCancel: onGripUp, 'data-dragging': dragging ? 1 : 0 }
        return h(DtlBoundary, null,
          h(
            'div',
            { style: { pointerEvents: 'auto' } },
            open
              ? h('div', { className: 'dtl-panel', role: 'complementary', 'aria-label': '待办清单与便签', style: { left: `${effPos.x}px`, top: `${effPos.y}px`, width: `${effW}px`, maxWidth: '100vw', maxHeight: `${effMaxH}px`, zIndex: 1000 } },
                  ws.workspaceId
                    ? h(App, { ctx, workspaceId: ws.workspaceId, workspaceTitle: ws.title, call, compact: true, drag, onCollapse: () => setOpen(false) })
                    : h('div', { className: 'dtl-root' }, h('style', { type: 'text/css' }, STYLE), h('div', { className: 'dtl-empty' }, '无可用工作区')),
                )
              : h(
                  'button',
                  { title: '展开待办清单', 'aria-label': '展开待办清单', onClick: () => setOpen(true), style: { position: 'fixed', left: `${effPos.x}px`, top: `${effPos.y}px`, zIndex: 1000, display: 'flex', alignItems: 'center', gap: 12, padding: '7px 12px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, cursor: 'pointer', boxShadow: '0 6px 18px rgba(0,0,0,.16)', whiteSpace: 'nowrap' } },
                  stat('#f97316', counts ? counts.pending : '–', '待办'),
                  stat('#22c55e', counts ? counts.done : '–', '完成'),
                  stat('#8b5cf6', counts ? counts.notes : '–', '便签'),
                ),
          ),
        )
      }
    }

    /* ── sidebar icon + main panel (aggregate 待办清单) ──── */
    function SidebarIcon({ size = 18 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        h('path', { d: 'M4 6h.01M4 12h.01M4 18h.01' }),
        h('path', { d: 'M8.5 6H20M8.5 12H20M8.5 18H20' }),
      )
    }

    function MainPanel(props) {
      return h(BoardMain, { ctx: ctxRef.ctx, call: ctxRef.call })
    }

    const ctxRef = { ctx: null, call: null }

    return {
      inject: ['slots', 'connection', 'layout'],
      apply(ctx) {
        ctxRef.ctx = ctx
        const call = makeRpc(ctx)
        ctxRef.call = call

        // Floating overlay (primary surface)
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-todolist-overlay', order: 10 }, FloatingPanel(ctxRef, call)))

        // Left rail aggregate entry + central main panel
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'dsh-todolist', order: 45, label: '待办清单' }, SidebarIcon))
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'dsh-todolist', inject: () => ({}) }, MainPanel))

        ctx.effect(() => () => { ctxRef.ctx = null; ctxRef.call = null }, 'dsh-todolist: client cleanup')
      },
    }
  },
})