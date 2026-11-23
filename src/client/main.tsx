import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { formatMoney, labels, maxUpload, stages, type Run, type RunSummary } from '../shared.ts'
import './style.css'

type IconName = 'mark' | 'upload' | 'file' | 'history' | 'samples' | 'check' | 'warning' | 'chevron' | 'download' | 'lock' | 'plus'
const paths: Record<IconName, ReactNode> = {
  mark: <><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h4M10 12h5m-5 4h5"/></>,
  upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></>,
  file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6m-6 4h6"/></>,
  history: <><path d="M3 11a9 9 0 1 1 2 7M3 5v6h6m3-4v5l3 2"/></>,
  samples: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8m-8 4h8m-8 4h4"/></>,
  check: <path d="m5 12 5 5 9-10"/>,
  warning: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></>,
  chevron: <path d="m9 6 6 6-6 6"/>,
  download: <><path d="M12 4v12m-5-5 5 5 5-5M5 19h14"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
}

function Icon({ name, size = 19 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

const samples = [
  ['01-office-supplies.pdf', 'Office supplies', 'Ready for approval'],
  ['02-rescanned-copy.pdf', 'Rescanned duplicate', 'Blocked after Office supplies'],
  ['03-packaging-first-shipment.pdf', 'Packaging shipment 1', 'Ready for approval'],
  ['04-packaging-second-shipment.pdf', 'Packaging shipment 2', 'Blocked after shipment 1'],
  ['05-missing-po.pdf', 'Missing PO reference', 'Needs review'],
  ['06-scan-total-mismatch.pdf', 'Scanned total mismatch', 'Needs review'],
]

function accessFromLink() {
  const fragment = new URLSearchParams(location.hash.slice(1))
  const incoming = fragment.get('access')
  if (incoming) {
    sessionStorage.setItem('invoice-access', incoming)
    history.replaceState(null, '', location.pathname + location.search)
  }
  return incoming
}

const suppliedCode = accessFromLink() ?? sessionStorage.getItem('invoice-access') ?? ''
const workspaceId = () => localStorage.getItem('invoice-workspace') || newWorkspace()
function newWorkspace() {
  const id = crypto.randomUUID()
  localStorage.setItem('invoice-workspace', id)
  return id
}

const running = (run: RunSummary | null) => run?.status === 'queued' || run?.status === 'processing'
const stamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const clock = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })

function Badge({ run }: { run: RunSummary }) {
  const status = run.outcome ?? run.status
  return <span className={`badge ${status}`}><span aria-hidden="true" />{labels[status]}</span>
}

const nav = [
  ['review', 'Invoice review', 'upload'],
  ['history', 'Run history', 'history'],
  ['samples', 'Sample invoices', 'samples'],
] as const

function Sidebar({ active, choose, available }: { active: string; choose: (tab: string) => void; available: boolean }) {
  return <aside className="sidebar">
    <div className="brand"><span className="brand-icon"><Icon name="mark" size={26} /></span><div><strong>Invoice Review</strong><small>ACCOUNTS PAYABLE</small></div></div>
    <nav aria-label="Workspace">
      {nav.map(([id, label, icon]) => <button type="button" key={id} aria-current={active === id ? 'page' : undefined}
        className={active === id ? 'active' : ''} onClick={() => choose(id)} disabled={!available}><Icon name={icon} />{label}</button>)}
    </nav>
    <div className="sidebar-footer"><span>PS-1 Case Study</span><small>Invoice processing</small></div>
  </aside>
}

function Progress({ run, uploading }: { run: Run | null; uploading: boolean }) {
  return <section className="card progress" aria-labelledby="workflow-heading">
    <div className="card-heading"><div><h2 id="workflow-heading">Workflow</h2><p>{run?.filename ?? 'Stage activity will appear when a run starts.'}</p></div>
      {run && <Badge run={run} />}</div>
    <ol className="steps" aria-live="polite">
      {stages.map(([id, label, detail]) => {
        const event = run?.events.find(item => item.stage === id)
        const state = event?.end ? 'done' : event && run?.status === 'failed' ? 'failure'
          : event || (id === 'intake' && uploading) ? 'working' : 'pending'
        const status = state === 'done' ? 'Done' : state === 'working' ? 'In progress' : state === 'failure' ? 'Failed' : 'Waiting'
        return <li key={id} className={state}>
          <span className="stage-indicator" aria-label={status}>{state === 'done' ? <Icon name="check" size={15} /> : state === 'failure' ? <Icon name="warning" size={17} /> : <span />}</span>
          <div><strong>{label}</strong><small>{detail}</small></div>
          <time>{event ? clock(event.end ?? event.start) : ''}</time>
        </li>
      })}
    </ol>
    {run?.error && <p className="error" role="alert">{run.error}</p>}
  </section>
}

function Evidence({ run, showRun, download }: { run: Run; showRun: (id: string) => void; download: () => void }) {
  const invoice = run.invoice
  const currency = invoice?.currency ?? ''
  return <section className="card evidence" aria-labelledby="decision-heading">
    <div className="card-heading">
      <div><h2 id="decision-heading">Run output</h2><p>{run.invoiceNumber ?? run.filename} · {stamp(run.createdAt)}</p></div>
      <div className="actions"><Badge run={run} /><button className="quiet" onClick={download}><Icon name="download" size={17} />Original PDF</button></div>
    </div>
    {run.outcome && <div className={`decision ${run.outcome}`}>
      <Icon name={run.outcome === 'ready' ? 'check' : 'warning'} />
      <div><strong>{labels[run.outcome]}</strong><p>{run.outcome === 'ready'
        ? 'The invoice passed the checks. Its gross amount is reserved for human approval.'
        : run.outcome === 'review' ? 'An AP reviewer should resolve the flagged evidence before this invoice moves forward.'
          : 'A hard policy rule stopped this invoice. The checks below show what triggered it.'}</p></div>
    </div>}
    {invoice && <>
      <dl className="invoice-fields">
        {[
          ['Supplier', invoice.vendor], ['Invoice number', invoice.invoiceNumber], ['Invoice date', invoice.invoiceDate],
          ['PO reference', invoice.po], ['Subtotal', formatMoney(invoice.subtotal, currency)],
          ['Tax', formatMoney(invoice.tax, currency)], ['Adjustments', formatMoney(invoice.adjustment, currency)], ['Invoice total', formatMoney(invoice.total, currency)],
        ].map(([title, value]) => <div key={title}><dt>{title}</dt><dd>{value ?? '—'}</dd></div>)}
      </dl>
      {run.checks.length > 0 && <div className="checks"><h3>Decision evidence</h3>
        {[...run.checks].sort((a, b) => severity[b.level] - severity[a.level]).map(check =>
          <article className={`check ${check.level}`} key={check.title}>
            <Icon name={check.level === 'pass' ? 'check' : 'warning'} size={18} />
            <div><strong>{check.title}</strong><p>{check.detail}</p>
              {check.priorRun && <button className="text-button" onClick={() => showRun(check.priorRun!)}>View original run</button>}</div>
          </article>)}</div>}
      {run.orders.length > 0 && <div className="output-table"><h3>Purchase order evidence</h3><div className="table-scroll"><table>
        <thead><tr><th>PO / description</th><th>Gross limit</th><th>Previously committed</th><th>Reserved by past runs</th><th>Available before this run</th></tr></thead>
        <tbody>{run.orders.map(order => <tr key={order.id}><td><strong>{order.id}</strong><small>{order.description} · {order.status}</small></td>
          {[order.limit, order.committed, order.reserved, order.available].map((value, index) => <td key={index}>{formatMoney(value / 100, order.currency)}</td>)}</tr>)}</tbody>
      </table></div></div>}
      <details className="output-table"><summary>Extracted line items ({invoice.items.length})</summary>
        {invoice.items.length ? <div className="table-scroll"><table>
          <thead><tr><th>Description</th><th>Quantity</th><th>Unit price</th><th>Printed amount</th></tr></thead>
          <tbody>{invoice.items.map((item, index) => <tr key={index}><td>{item.description ?? '—'}</td><td>{item.quantity ?? '—'}</td>
            <td>{formatMoney(item.unitPrice, currency, 8)}</td><td>{formatMoney(item.amount, currency)}</td></tr>)}</tbody>
        </table></div> : <p>No line items were extracted.</p>}
      </details>
    </>}
    {run.model && <p className="metadata">Extraction model {run.model}</p>}
  </section>
}
const severity = { block: 3, review: 2, info: 1, pass: 0 }

function RunHistory({ runs, showRun }: { runs: RunSummary[]; showRun: (id: string) => void }) {
  const [filter, setFilter] = useState('all')
  const displayed = runs.filter(run => filter === 'all' || (run.outcome ?? run.status) === filter)
  return <section className="card history" aria-labelledby="history-heading">
    <div className="card-heading"><div><h2 id="history-heading">Past runs</h2><p>{runs.length} {runs.length === 1 ? 'run' : 'runs'} in this workspace</p></div>
      <label className="filter"><span>Status</span><select value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">All statuses</option>{(['ready', 'review', 'blocked', 'failed', 'processing', 'queued'] as const)
          .map(status => <option key={status} value={status}>{labels[status]}</option>)}</select></label></div>
    <div className="table-scroll"><table>
      <thead><tr><th>Invoice</th><th>Submitted</th><th>Total</th><th>Status</th><th><span className="sr-only">Details</span></th></tr></thead>
      <tbody>{displayed.map(run => <tr key={run.id}>
        <td><strong>{run.invoiceNumber || run.filename}</strong><small>{run.vendor || (run.invoiceNumber ? run.filename : 'PDF submission')}</small></td>
        <td>{stamp(run.createdAt)}</td><td>{formatMoney(run.total, run.currency ?? '')}</td><td><Badge run={run} /></td>
        <td><button className="row-button" aria-label={`View ${run.invoiceNumber ?? run.filename}`} onClick={() => showRun(run.id)}><Icon name="chevron" size={20} /></button></td>
      </tr>)}</tbody>
    </table></div>
    {displayed.length === 0 && <div className="empty"><Icon name="history" size={24} /><strong>{runs.length ? 'No runs match this filter' : 'No invoices processed yet'}</strong>
      <p>{runs.length ? 'Choose another status to see more runs.' : 'Upload an invoice or use a sample to start your first run.'}</p></div>}
  </section>
}

function App() {
  const [code, setCode] = useState(suppliedCode)
  const [codeInput, setCodeInput] = useState('')
  const [space, setSpace] = useState(workspaceId)
  const [previousSpace, setPreviousSpace] = useState(() => localStorage.getItem('invoice-previous-workspace'))
  const [run, setRun] = useState<Run | null>(null)
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [tab, setTab] = useState('review')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [sampleLoading, setSampleLoading] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [locked, setLocked] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [confirmSpace, setConfirmSpace] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const selection = useRef(0)
  const currentRun = useRef(run)
  currentRun.current = run

  useEffect(() => {
    function openReviewerLink() {
      const incoming = accessFromLink()
      if (incoming) {
        setError('')
        setCode(incoming)
      }
    }
    window.addEventListener('hashchange', openReviewerLink)
    return () => window.removeEventListener('hashchange', openReviewerLink)
  }, [])

  function api(path: string, options: RequestInit = {}, codeOverride = code) {
    const headers = new Headers(options.headers)
    headers.set('X-Workspace', space)
    if (codeOverride) headers.set('Authorization', `Bearer ${codeOverride}`)
    return fetch(`/api${path}`, { ...options, headers }).then(async response => {
      if (!response.ok) {
        if (response.status === 401) setLocked(true)
        const value = await response.json().catch(() => null)
        throw new Error(value?.error || 'The server could not complete the request. Please retry.')
      }
      return response
    })
  }

  async function refresh() {
    const response = await api('/runs')
    setRuns(await response.json())
  }

  useEffect(() => {
    let cancelled = false
    const refreshStart = async () => {
      try {
        const response = await api('/health')
        const status = await response.json()
        if (cancelled) return
        setConnected(status.extractionConfigured)
        setLocked(false)
        const history = await (await api('/runs')).json()
        if (!cancelled) setRuns(history)
      } catch (failure) {
        if (!cancelled) setError((failure as Error).message)
      }
    }
    void refreshStart()
    return () => { cancelled = true }
  }, [space, code])

  const active = running(run) || runs.some(running)
  const runId = run?.id
  useEffect(() => {
    if (!active || locked) return
    let stopped = false
    let timer: number
    const poll = async () => {
      try {
        const next = runId && running(currentRun.current) ? await api(`/runs/${runId}`) : null
        if (stopped) return
        if (next) {
          const updated: Run = await next.json()
          if (!stopped) setRun(current => current?.id === updated.id ? updated : current)
        }
        const result = await (await api('/runs')).json()
        if (!stopped) setRuns(result)
      } catch (failure) {
        if (!stopped) setError((failure as Error).message)
      } finally {
        if (!stopped) timer = window.setTimeout(poll, 600)
      }
    }
    timer = window.setTimeout(poll, 300)
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [active, runId, space, code, locked])

  async function unlock(event: FormEvent) {
    event.preventDefault()
    setError('')
    const value = codeInput.trim()
    if (!value) return
    try {
      const response = await api('/health', {}, value)
      setConnected((await response.json()).extractionConfigured)
      sessionStorage.setItem('invoice-access', value)
      setCode(value)
      setLocked(false)
    } catch (failure) {
      setError((failure as Error).message)
    }
  }

  function selectFile(next: File | null) {
    setError('')
    if (!next) return
    const invalid = !next.name.toLowerCase().endsWith('.pdf') || next.size === 0
      ? 'Choose a non-empty PDF document.' : next.size > maxUpload ? 'Choose a PDF up to 8 MiB.' : ''
    setUploadError(invalid)
    if (invalid) {
      setFile(null)
      return
    }
    setFile(next)
  }

  async function loadSample(name: string) {
    setError('')
    setSampleLoading(name)
    try {
      const response = await fetch(`/samples/${name}`)
      if (!response.ok) throw new Error('The sample PDF could not be loaded.')
      selectFile(new File([await response.blob()], name, { type: 'application/pdf' }))
      changeTab('review')
    } catch (failure) {
      setError((failure as Error).message)
    } finally { setSampleLoading('') }
  }

  function changeTab(next: string) {
    setTab(next)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file || loading) return
    setLoading(true)
    setError('')
    setUploadError('')
    const request = ++selection.current
    setRun(null)
    try {
      const response = await api('/runs', { method: 'POST', headers: {
        'Content-Type': 'application/pdf', 'X-Filename': encodeURIComponent(file.name),
      }, body: file })
      const accepted = await response.json()
      if (request === selection.current) setRun(accepted)
      setFile(null)
      await refresh()
    } catch (failure) {
      setUploadError((failure as Error).message)
    } finally { setLoading(false) }
  }

  async function showRun(id: string) {
    const request = ++selection.current
    setError('')
    try {
      const response = await api(`/runs/${id}`)
      const details = await response.json()
      if (request !== selection.current) return
      setRun(details)
      changeTab('review')
    } catch (failure) {
      if (request === selection.current) setError((failure as Error).message)
    }
  }

  async function download() {
    if (!run) return
    try {
      const response = await api(`/runs/${run.id}/pdf`)
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = run.filename
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (failure) {
      setError((failure as Error).message)
    }
  }

  function switchWorkspace(next: string) {
    selection.current++
    localStorage.setItem('invoice-previous-workspace', space)
    localStorage.setItem('invoice-workspace', next)
    setPreviousSpace(space)
    setSpace(next)
    setRun(null)
    setRuns([])
    setFile(null)
    setError('')
    setUploadError('')
    setConfirmSpace(false)
    changeTab('review')
  }

  return <div className="layout">
    <Sidebar active={tab} choose={changeTab} available={!locked} />
    <main>
      <header className="topbar"><span>Accounts payable <Icon name="chevron" size={14} /> Review desk</span>
        {!locked && <button className="quiet new-space" disabled={loading || Boolean(sampleLoading)} onClick={() => setConfirmSpace(value => !value)} aria-expanded={confirmSpace}><Icon name="plus" size={16} />New workspace</button>}</header>
      <div className="content">
        {confirmSpace && !locked && <div className="workspace-prompt" role="region" aria-label="New workspace">
          <p>Start with empty run history and the original PO balances. Existing runs stay in their current workspace.</p>
          <div className="actions"><button className="quiet" onClick={() => setConfirmSpace(false)}>Cancel</button>
            {previousSpace && <button className="quiet" disabled={loading || Boolean(sampleLoading)} onClick={() => switchWorkspace(previousSpace)}>Return to previous workspace</button>}
            <button className="primary" disabled={loading || Boolean(sampleLoading)} onClick={() => switchWorkspace(crypto.randomUUID())}>Start new workspace</button></div>
        </div>}
        {locked ? <section className="card locked">
          <span className="feature-icon"><Icon name="lock" size={24} /></span>
          <h1>Open the review desk</h1><p>Use the access code included in your reviewer link.</p>
          <form onSubmit={unlock}><label htmlFor="access-code">Access code</label>
            <input id="access-code" type="password" autoComplete="off" value={codeInput} onChange={event => setCodeInput(event.target.value)} required />
            <button className="primary" type="submit">Open workspace</button></form>
        </section> : <>
          <div className="page-heading">
            <h1>{tab === 'review' ? 'Invoice review' : tab === 'history' ? 'Run history' : 'Sample invoices'}</h1>
            <p>{tab === 'review' ? 'Upload an invoice PDF and follow it from extraction to decision.'
              : tab === 'history' ? 'Browse invoice submissions and reopen their decision evidence.'
                : 'Use these synthetic PDFs to try the workflow and its policy checks.'}</p>
          </div>
          {connected === false && <p className="error" role="alert">Gemini extraction is unavailable until the server API key is configured.</p>}
          {tab === 'review' && <>
            <div className="review-grid">
              <section className="card upload" aria-labelledby="upload-heading">
                <div className="card-heading"><div><h2 id="upload-heading">New invoice</h2><p>Digital and scanned PDFs are supported.</p></div></div>
                <form onSubmit={submit}>
                  <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} aria-label="Invoice PDF" accept=".pdf,application/pdf"
                    onChange={event => { selectFile(event.target.files?.[0] ?? null); event.target.value = '' }} />
                  <button type="button" className={`dropzone ${dragging ? 'dragging' : ''}`} onClick={() => fileInput.current?.click()}
                    onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
                    onDrop={event => { event.preventDefault(); setDragging(false); if (!loading) selectFile(event.dataTransfer.files[0] ?? null) }} disabled={loading}>
                    <span className="feature-icon"><Icon name={file ? 'file' : 'upload'} size={24} /></span>
                    <strong>{file?.name || 'Choose or drop a PDF'}</strong><small>{file ? `${Math.max(1, Math.round(file.size / 1024))} KB · Click to change` : 'PDF up to 8 MiB'}</small>
                  </button>
                  <div className="upload-actions"><button className="primary" type="submit" disabled={!file || loading || connected === false}>
                    <Icon name="upload" size={17} />{loading ? 'Uploading…' : 'Process invoice'}</button>
                    <button className="text-button" type="button" onClick={() => changeTab('samples')} disabled={loading}>Try a sample</button></div>
                  {uploadError && <p className="error upload-error" role="alert">{uploadError}</p>}
                </form>
              </section>
              <Progress run={run} uploading={loading} />
            </div>
            {run && (run.invoice || run.status === 'failed') && <Evidence run={run} showRun={showRun} download={download} />}
            <RunHistory runs={runs} showRun={showRun} />
          </>}
          {tab === 'history' && <RunHistory runs={runs} showRun={showRun} />}
          {tab === 'samples' && <section className="card sample-card"><h2>Demo inputs</h2><div className="sample-list">
            {samples.map(([name, title, expected]) => <article key={name}>
              <span className="feature-icon"><Icon name="file" /></span><div><strong>{title}</strong><small>{expected}</small></div>
              <div className="actions"><a className="quiet" href={`/samples/${name}`} download aria-label={`Download ${title}`}><Icon name="download" size={17} /></a>
                <button className="quiet" disabled={Boolean(sampleLoading) || loading} onClick={() => void loadSample(name)}>{sampleLoading === name ? 'Loading…' : 'Use sample'}</button></div>
            </article>)}
          </div></section>}
        </>}
        {error && <p className="error global-error" role="alert">{error}</p>}
      </div>
    </main>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
