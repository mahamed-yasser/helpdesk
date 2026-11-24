'use strict';
const path = require('node:path');
const { createApp, csv } = require('./core');
const sla = require('./sla');

const PRIORITIES = Object.keys(sla.POLICY_MIN), STATUSES = Object.keys(sla.TRANSITIONS);
const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY, number TEXT UNIQUE NOT NULL, subject TEXT NOT NULL, requester_name TEXT NOT NULL, requester_email TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General', priority TEXT NOT NULL CHECK(priority IN ('urgent','high','normal','low')),
  status TEXT NOT NULL CHECK(status IN ('open','pending','resolved','closed')), assignee_id INTEGER REFERENCES agents(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sla_due TEXT NOT NULL, paused_at TEXT, paused_minutes INTEGER NOT NULL DEFAULT 0,
  first_response_at TEXT, resolved_at TEXT);
CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE, author TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('public','internal','customer')), body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS canned(id INTEGER PRIMARY KEY, title TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_t_status ON tickets(status); CREATE INDEX IF NOT EXISTS ix_c_ticket ON comments(ticket_id);`;

function build({ dbFile, clock = () => new Date(), publicDir = path.join(__dirname, '..', 'public') } = {}) {
  return createApp({ dbFile, publicDir, schema: SCHEMA, appName: 'HelpDesk', seed: (db) => require('./seed')(db, clock()),
    routes(add, { db, tx, v, bad, HttpError }) {
      const iso = () => clock().toISOString();
      const decorate = (t) => ({ ...t, sla_state: sla.slaState(t, clock()) });
      const listSql = `SELECT t.*, a.name AS assignee_name FROM tickets t LEFT JOIN agents a ON a.id=t.assignee_id`;
      const getTicket = (id) => { const t = db.prepare(listSql + ' WHERE t.id=?').get(id); if (!t) throw new HttpError(404, 'Ticket not found'); return t; };

      add('GET', '/api/tickets', ({ query }) => {
        const w = [], p = [];
        if (query.status === 'active') w.push("t.status IN ('open','pending')");
        else if (query.status) { v.oneOf(query.status, STATUSES, 'status'); w.push('t.status=?'); p.push(query.status); }
        if (query.priority) { v.oneOf(query.priority, PRIORITIES, 'priority'); w.push('t.priority=?'); p.push(query.priority); }
        if (query.assignee === 'none') w.push('t.assignee_id IS NULL'); else if (query.assignee) { w.push('t.assignee_id=?'); p.push(Number(query.assignee) || 0); }
        if (query.q) { w.push('(t.subject LIKE ? OR t.number LIKE ? OR t.requester_name LIKE ? OR t.requester_email LIKE ?)'); const q = '%' + query.q.replace(/[%_]/g, '') + '%'; p.push(q, q, q, q); }
        const rows = db.prepare(listSql + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY t.created_at DESC').all(...p).map(decorate);
        const rank = { breached: 0, at_risk: 1, ok: 2, paused: 3, met: 4 };
        if (query.sort === 'sla') rows.sort((a, b) => rank[a.sla_state] - rank[b.sla_state] || a.sla_due.localeCompare(b.sla_due));
        return { tickets: rows };
      });
      add('POST', '/api/tickets', ({ body }) => tx(() => {
        const priority = v.oneOf(body.priority || 'normal', PRIORITIES, 'priority');
        const email = v.str(body.requester_email, 'Email', { max: 120 });
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email looks invalid');
        const now = iso(), n = (db.prepare('SELECT COALESCE(MAX(id),0)+1 AS n FROM tickets').get().n);
        const number = 'HD-' + (1000 + n);
        const id = db.prepare(`INSERT INTO tickets(number,subject,requester_name,requester_email,category,priority,status,created_at,updated_at,sla_due) VALUES(?,?,?,?,?,?,'open',?,?,?)`)
          .run(number, v.str(body.subject, 'Subject'), v.str(body.requester_name, 'Name'), email, v.str(body.category, 'Category', { required: false }) || 'General', priority, now, now, sla.dueFor(now, priority)).lastInsertRowid;
        db.prepare("INSERT INTO comments(ticket_id,author,kind,body,created_at) VALUES(?,?, 'customer',?,?)").run(id, body.requester_name.trim(), v.str(body.body, 'Message', { max: 4000 }), now);
        return { ticket: decorate(getTicket(id)) };
      }));
      add('GET', '/api/tickets/:id', ({ params }) => {
        const t = getTicket(Number(params.id));
        return { ticket: decorate(t), comments: db.prepare('SELECT * FROM comments WHERE ticket_id=? ORDER BY id').all(t.id) };
      });
      add('PATCH', '/api/tickets/:id', ({ params, body }) => tx(() => {
        const t = getTicket(Number(params.id)), now = clock(); const set = {};
        if (body.status !== undefined && body.status !== t.status) {
          v.oneOf(body.status, STATUSES, 'status');
          if (!sla.TRANSITIONS[t.status].includes(body.status)) throw bad(`A ${t.status} ticket cannot move to ${body.status}`);
          set.status = body.status;
          if (t.status === 'pending') { // leaving pending: add paused business minutes to the allowance
            const add = sla.businessMinutesBetween(t.paused_at, now); set.paused_minutes = t.paused_minutes + add; set.paused_at = null;
          }
          if (body.status === 'pending') set.paused_at = now.toISOString();
          if (body.status === 'resolved') set.resolved_at = now.toISOString();
          if (t.status === 'resolved' && body.status === 'open') set.resolved_at = null;
        }
        if (body.priority !== undefined && body.priority !== t.priority) set.priority = v.oneOf(body.priority, PRIORITIES, 'priority');
        if (body.assignee_id !== undefined) {
          if (body.assignee_id === null || body.assignee_id === '') set.assignee_id = null;
          else { const a = db.prepare('SELECT * FROM agents WHERE id=? AND active=1').get(Number(body.assignee_id)); if (!a) throw bad('Unknown or inactive agent'); set.assignee_id = a.id; }
        }
        if (set.priority || set.paused_minutes !== undefined) set.sla_due = sla.dueFor(t.created_at, set.priority || t.priority, set.paused_minutes ?? t.paused_minutes);
        if (!Object.keys(set).length) return { ticket: decorate(t) };
        set.updated_at = now.toISOString();
        db.prepare('UPDATE tickets SET ' + Object.keys(set).map((k) => k + '=?').join(',') + ' WHERE id=?').run(...Object.values(set), t.id);
        return { ticket: decorate(getTicket(t.id)) };
      }));
      add('POST', '/api/tickets/:id/comments', ({ params, body, user }) => tx(() => {
        const t = getTicket(Number(params.id)); const kind = v.oneOf(body.kind || 'public', ['public', 'internal'], 'kind');
        if (t.status === 'closed') throw bad('Closed tickets cannot be changed. Open a new ticket instead.');
        const now = iso();
        db.prepare('INSERT INTO comments(ticket_id,author,kind,body,created_at) VALUES(?,?,?,?,?)').run(t.id, user.name, kind, v.str(body.body, 'Message', { max: 4000 }), now);
        if (kind === 'public' && !t.first_response_at) db.prepare('UPDATE tickets SET first_response_at=? WHERE id=?').run(now, t.id);
        db.prepare('UPDATE tickets SET updated_at=? WHERE id=?').run(now, t.id);
        return { ok: true };
      }));
      add('GET', '/api/agents', () => ({ agents: db.prepare('SELECT a.*, (SELECT COUNT(*) FROM tickets t WHERE t.assignee_id=a.id AND t.status IN (\'open\',\'pending\')) AS open_count FROM agents a ORDER BY a.name').all() }));
      add('POST', '/api/agents', ({ body }) => { db.prepare('INSERT INTO agents(name,email) VALUES(?,?)').run(v.str(body.name, 'Name'), v.str(body.email, 'Email').toLowerCase()); return { ok: true }; });
      add('PATCH', '/api/agents/:id', ({ params, body }) => { db.prepare('UPDATE agents SET active=? WHERE id=?').run(body.active ? 1 : 0, Number(params.id)); return { ok: true }; });
      add('GET', '/api/canned', () => ({ canned: db.prepare('SELECT * FROM canned ORDER BY title').all() }));
      add('POST', '/api/canned', ({ body }) => { db.prepare('INSERT INTO canned(title,body) VALUES(?,?)').run(v.str(body.title, 'Title'), v.str(body.body, 'Text', { max: 2000 })); return { ok: true }; });
      add('DELETE', '/api/canned/:id', ({ params }) => { db.prepare('DELETE FROM canned WHERE id=?').run(Number(params.id)); return { ok: true }; });

      add('GET', '/api/dashboard', () => {
        const all = db.prepare(listSql).all().map(decorate);
        const active = all.filter((t) => t.status === 'open' || t.status === 'pending');
        const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, active.filter((t) => t.priority === p).length]));
        const weekAgo = new Date(clock().getTime() - 7 * 864e5).toISOString();
        const resolved = all.filter((t) => t.resolved_at && t.resolved_at >= weekAgo);
        const frt = all.filter((t) => t.first_response_at && t.created_at >= weekAgo).map((t) => sla.businessMinutesBetween(t.created_at, t.first_response_at));
        const closedWeek = resolved.length;
        const met = resolved.filter((t) => t.sla_state === 'met').length;
        return {
          open: active.length, unassigned: active.filter((t) => !t.assignee_id).length, breached: active.filter((t) => t.sla_state === 'breached').length,
          at_risk: active.filter((t) => t.sla_state === 'at_risk').length, byPriority, resolved_7d: closedWeek,
          sla_met_pct_7d: closedWeek ? Math.round((met / closedWeek) * 100) : null,
          avg_first_response_min: frt.length ? Math.round(frt.reduce((a, b) => a + b, 0) / frt.length) : null,
          workload: db.prepare("SELECT a.name, COUNT(t.id) AS n FROM agents a LEFT JOIN tickets t ON t.assignee_id=a.id AND t.status IN ('open','pending') WHERE a.active=1 GROUP BY a.id ORDER BY n DESC, a.name").all(),
          attention: active.filter((t) => t.sla_state === 'breached' || t.sla_state === 'at_risk').sort((a, b) => a.sla_due.localeCompare(b.sla_due)).slice(0, 6),
        };
      });
      add('GET', '/api/tickets.csv', () => csv([['Number', 'Subject', 'Requester', 'Priority', 'Status', 'Assignee', 'Created', 'SLA due', 'SLA state'],
        ...db.prepare(listSql + ' ORDER BY t.created_at DESC').all().map(decorate).map((t) => [t.number, t.subject, t.requester_email, t.priority, t.status, t.assignee_name || '', t.created_at, t.sla_due, t.sla_state])]));
    } });
}
module.exports = { build };
