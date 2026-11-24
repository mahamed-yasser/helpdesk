'use strict';
const { h, api, toast, fmtDate, badge, formModal, table, kpi, toolbar, btn, download, mountApp } = UI;
const PRIO = { urgent: 'bad', high: 'warn', normal: 'info', low: '' };
const SLA = { ok: ['On track', 'ok'], at_risk: ['At risk', 'warn'], breached: ['Breached', 'bad'], paused: ['Paused', ''], met: ['Met', 'ok'] };
const slaBadge = (s) => badge(SLA[s][0], SLA[s][1]);
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
const mm = (m) => m == null ? 'n/a' : m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm';

async function dashboard(el) {
  const d = await api('GET', '/api/dashboard');
  el.append(h('div', { class: 'grid g4' },
    kpi('Open tickets', d.open, d.unassigned + ' unassigned'), kpi('SLA breached', d.breached, 'need action now', d.breached ? 'bad' : 'ok'),
    kpi('At risk', d.at_risk, 'inside last 25% of target', d.at_risk ? 'warn' : 'ok'), kpi('SLA met, 7 days', d.sla_met_pct_7d == null ? 'n/a' : d.sla_met_pct_7d + '%', d.resolved_7d + ' resolved'),
    kpi('Avg first response', mm(d.avg_first_response_min), 'business time, last 7 days')));
  el.append(h('div', { class: 'grid g2', style: 'margin-top:14px' },
    h('div', { class: 'card' }, h('h2', {}, 'Needs attention'),
      d.attention.length ? h('ul', { class: 'list' }, d.attention.map((t) => h('li', {}, h('a', { href: '#/tickets/' + t.id }, t.number + ' ' + t.subject), slaBadge(t.sla_state)))) : h('p', { class: 'muted' }, 'Nothing is breached or at risk.')),
    h('div', { class: 'card' }, h('h2', {}, 'Open by priority'),
      h('ul', { class: 'list' }, Object.entries(d.byPriority).map(([p, n]) => h('li', {}, badge(p, PRIO[p]), h('b', {}, n)))),
      h('h2', { style: 'margin-top:14px' }, 'Workload'),
      h('ul', { class: 'list' }, d.workload.map((w) => h('li', {}, w.name, h('b', {}, w.n)))))));
}

async function tickets(el, args) {
  if (args[0]) return detail(el, args[0]);
  const f = { status: 'active', q: '', priority: '', sort: 'sla' };
  const out = h('div'); const agents = (await api('GET', '/api/agents')).agents;
  async function load() {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    const { tickets: rows } = await api('GET', '/api/tickets?' + qs);
    out.replaceChildren(table([
      { label: 'Ticket', render: (t) => h('div', {}, h('b', {}, t.number), h('div', { class: 'muted small' }, t.subject)) },
      { label: 'Requester', render: (t) => t.requester_name }, { label: 'Priority', render: (t) => badge(t.priority, PRIO[t.priority]) },
      { label: 'Status', render: (t) => badge(t.status) }, { label: 'SLA', render: (t) => slaBadge(t.sla_state) },
      { label: 'Due', render: (t) => t.status === 'resolved' || t.status === 'closed' ? '' : when(t.sla_due) }, { label: 'Assignee', render: (t) => t.assignee_name || h('span', { class: 'muted' }, 'Unassigned') },
    ], rows, { empty: 'No tickets match these filters.', onRow: (t) => { location.hash = '#/tickets/' + t.id; } }));
  }
  const sel = (key, opts) => { const s = h('select', { 'aria-label': key, onchange: () => { f[key] = s.value; load(); } }, opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l))); return s; };
  el.append(toolbar(
    h('input', { type: 'search', placeholder: 'Search subject, number, requester', 'aria-label': 'Search', oninput: (e) => { f.q = e.target.value; clearTimeout(f.t); f.t = setTimeout(load, 250); } }),
    sel('status', [['active', 'Active'], ['', 'All'], ['open', 'Open'], ['pending', 'Pending'], ['resolved', 'Resolved'], ['closed', 'Closed']]),
    sel('priority', [['', 'Any priority'], ['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal'], ['low', 'Low']]),
    h('span', { class: 'grow' }),
    btn('Export CSV', async () => { const r = await fetch('/api/tickets.csv'); download('tickets.csv', await r.text()); }),
    btn('New ticket', async () => {
      const r = await formModal({ title: 'New ticket', fields: [
        { name: 'requester_name', label: 'Requester name', required: true }, { name: 'requester_email', label: 'Requester email', type: 'email', required: true },
        { name: 'subject', label: 'Subject', required: true, wide: true }, { name: 'category', label: 'Category', placeholder: 'General' },
        { name: 'priority', label: 'Priority', type: 'select', options: [['normal', 'Normal'], ['urgent', 'Urgent'], ['high', 'High'], ['low', 'Low']] },
        { name: 'body', label: 'Message', type: 'textarea', required: true, wide: true }], submit: 'Create ticket',
        onSubmit: (v) => api('POST', '/api/tickets', v) });
      if (r) { toast('Ticket created'); load(); }
    }, 'primary')), out);
  await load();
}

async function detail(el, id) {
  const [{ ticket: t, comments }, { agents }, { canned }] = await Promise.all([api('GET', '/api/tickets/' + id), api('GET', '/api/agents'), api('GET', '/api/canned')]);
  const reload = () => location.hash === '#/tickets/' + id && window.dispatchEvent(new HashChangeEvent('hashchange'));
  const patch = async (b) => { try { await api('PATCH', '/api/tickets/' + id, b); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const NEXT = { open: [['pending', 'Wait on customer'], ['resolved', 'Resolve']], pending: [['open', 'Customer replied'], ['resolved', 'Resolve']], resolved: [['open', 'Reopen'], ['closed', 'Close']], closed: [] };
  const sel = (opts, val, fn, label) => h('select', { 'aria-label': label, onchange: (e) => fn(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val ?? '') }, l)));
  const reply = h('textarea', { rows: 4, placeholder: 'Write a reply to the customer, or an internal note', 'aria-label': 'Reply' });
  const kind = h('select', { 'aria-label': 'Reply type' }, h('option', { value: 'public' }, 'Public reply'), h('option', { value: 'internal' }, 'Internal note'));
  const cannedSel = h('select', { 'aria-label': 'Canned reply', onchange: (e) => {
    const c = canned.find((x) => String(x.id) === e.target.value); if (!c) return;
    reply.value = c.body.replace(/{{name}}/g, t.requester_name.split(' ')[0]).replace(/{{agent}}/g, (document.querySelector('.who span') || {}).textContent || 'Support'); e.target.value = '';
  } }, h('option', { value: '' }, 'Insert canned reply…'), canned.map((c) => h('option', { value: c.id }, c.title)));
  el.append(h('p', {}, h('a', { href: '#/tickets' }, '← All tickets')),
    h('div', { class: 'card' },
      h('div', { class: 'row spread' }, h('div', {}, h('h2', {}, t.number + ': ' + t.subject), h('div', { class: 'muted' }, t.requester_name + ' · ' + t.requester_email + ' · ' + t.category)),
        h('div', { class: 'row' }, badge(t.status), slaBadge(t.sla_state))),
      h('div', { class: 'toolbar', style: 'margin-top:12px' },
        sel([['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal'], ['low', 'Low']], t.priority, (v) => patch({ priority: v }), 'Priority'),
        sel([['', 'Unassigned'], ...agents.filter((a) => a.active).map((a) => [a.id, a.name])], t.assignee_id, (v) => patch({ assignee_id: v === '' ? null : Number(v) }), 'Assignee'),
        NEXT[t.status].map(([s, l]) => btn(l, () => patch({ status: s }), s === 'resolved' ? 'primary' : '')),
        h('span', { class: 'muted small' }, 'SLA target ' + when(t.sla_due) + (t.status === 'pending' ? ' (clock paused)' : '')))),
    h('div', { class: 'card' }, comments.map((c) => h('div', { class: 'msg ' + c.kind, style: 'padding:10px 0;border-bottom:1px solid var(--line)' },
      h('div', { class: 'row' }, h('b', {}, c.author), c.kind === 'internal' ? badge('Internal note', 'warn') : c.kind === 'customer' ? badge('Customer') : badge('Reply sent', 'ok'), h('span', { class: 'muted small' }, when(c.created_at))),
      h('p', { style: 'margin:4px 0 0;white-space:pre-wrap' }, c.body)))),
    t.status === 'closed' ? h('p', { class: 'muted' }, 'This ticket is closed.') : h('div', { class: 'card' }, h('div', { class: 'toolbar' }, kind, cannedSel), reply,
      h('div', { class: 'toolbar', style: 'margin-top:8px' }, btn('Send', async () => {
        try { await api('POST', `/api/tickets/${id}/comments`, { kind: kind.value, body: reply.value }); toast(kind.value === 'public' ? 'Reply recorded' : 'Note added'); reload(); } catch (e) { toast(e.message, 'bad'); }
      }, 'primary'), h('span', { class: 'muted small' }, 'Replies are recorded here. This demo does not send email.'))));
}

async function canned(el) {
  const draw = async () => {
    const { canned: rows } = await api('GET', '/api/canned');
    el.replaceChildren(toolbar(h('span', { class: 'muted grow' }, 'Placeholders: {{name}} is the requester\'s first name, {{agent}} is you.'), btn('New canned reply', async () => {
      if (await formModal({ title: 'New canned reply', fields: [{ name: 'title', label: 'Title', required: true, wide: true }, { name: 'body', label: 'Text', type: 'textarea', required: true, wide: true }], onSubmit: (v) => api('POST', '/api/canned', v) })) draw();
    }, 'primary')), table([{ label: 'Title', key: 'title' }, { label: 'Text', key: 'body' }, { label: '', render: (c) => btn('Delete', async () => { await api('DELETE', '/api/canned/' + c.id); draw(); }, 'sm danger') }], rows));
  };
  await draw();
}
async function agentsView(el) {
  const draw = async () => {
    const { agents } = await api('GET', '/api/agents');
    el.replaceChildren(toolbar(h('span', { class: 'grow' }), btn('Add agent', async () => {
      if (await formModal({ title: 'Add agent', fields: [{ name: 'name', label: 'Name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true }], onSubmit: (v) => api('POST', '/api/agents', v) })) draw();
    }, 'primary')), table([{ label: 'Name', key: 'name' }, { label: 'Email', key: 'email' }, { label: 'Active tickets', key: 'open_count', class: 'r' },
      { label: 'Status', render: (a) => badge(a.active ? 'Active' : 'Inactive', a.active ? 'ok' : '') },
      { label: '', render: (a) => btn(a.active ? 'Deactivate' : 'Activate', async () => { await api('PATCH', '/api/agents/' + a.id, { active: !a.active }); draw(); }, 'sm') }], agents));
  };
  await draw();
}
mountApp({ title: 'HelpDesk', tagline: 'Support tickets with business-hours SLAs', accent: '#0f766e', views: [
  { id: 'dashboard', label: 'Dashboard', render: dashboard }, { id: 'tickets', label: 'Tickets', render: tickets },
  { id: 'canned', label: 'Canned replies', render: canned }, { id: 'agents', label: 'Agents', render: agentsView }] });
