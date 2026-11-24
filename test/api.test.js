'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { start } = require('./testkit'); const { build } = require('../src/app');
let now = new Date('2026-11-24T10:00:00Z');
const clock = () => now;
const NEW = { subject: 'Printer is on fire', requester_name: 'Zed Test', requester_email: 'zed@test.example', priority: 'high', body: 'Smoke.' };

test('auth is required and wrong passwords are rejected', async () => {
  const s = await start((o) => build({ ...o, clock }));
  assert.equal((await s.anon('GET', '/api/tickets')).status, 401);
  assert.equal((await s.anon('POST', '/api/login', { username: 'admin', password: 'nope' })).status, 401);
  assert.equal((await s.call('GET', '/api/tickets')).status, 200);
  await s.call('POST', '/api/logout'); assert.equal((await s.call('GET', '/api/tickets')).status, 401);
  await s.close();
});
test('ticket lifecycle: SLA due, pause on pending adds business time, resolve, reopen, close', async () => {
  now = new Date('2026-11-24T10:00:00Z');
  const s = await start((o) => build({ ...o, clock }));
  const c = await s.call('POST', '/api/tickets', NEW); assert.equal(c.status, 200);
  const t = c.data.ticket; assert.match(t.number, /^HD-1\d{3}$/);
  assert.equal(t.sla_due, '2026-11-25T10:00:00.000Z'); // high = 8h: 10:00 +7h =17:00, +1h next day 10:00
  // first public reply sets first response
  now = new Date('2026-11-24T11:00:00Z');
  await s.call('POST', `/api/tickets/${t.id}/comments`, { kind: 'internal', body: 'note' });
  assert.equal((await s.call('GET', `/api/tickets/${t.id}`)).data.ticket.first_response_at, null);
  await s.call('POST', `/api/tickets/${t.id}/comments`, { kind: 'public', body: 'hello' });
  assert.ok((await s.call('GET', `/api/tickets/${t.id}`)).data.ticket.first_response_at);
  // pause 11:00 -> 13:00 (2 business hours) moves due by 2h
  await s.call('PATCH', `/api/tickets/${t.id}`, { status: 'pending' });
  assert.equal((await s.call('GET', `/api/tickets/${t.id}`)).data.ticket.sla_state, 'paused');
  now = new Date('2026-11-24T13:00:00Z');
  const back = await s.call('PATCH', `/api/tickets/${t.id}`, { status: 'open' });
  assert.equal(back.data.ticket.paused_minutes, 120); assert.equal(back.data.ticket.sla_due, '2026-11-25T12:00:00.000Z');
  // illegal transition
  assert.equal((await s.call('PATCH', `/api/tickets/${t.id}`, { status: 'closed' })).status, 400);
  const res = await s.call('PATCH', `/api/tickets/${t.id}`, { status: 'resolved' }); assert.equal(res.data.ticket.sla_state, 'met');
  const re = await s.call('PATCH', `/api/tickets/${t.id}`, { status: 'open' }); assert.equal(re.data.ticket.resolved_at, null);
  await s.call('PATCH', `/api/tickets/${t.id}`, { status: 'resolved' }); await s.call('PATCH', `/api/tickets/${t.id}`, { status: 'closed' });
  assert.equal((await s.call('POST', `/api/tickets/${t.id}/comments`, { body: 'late' })).status, 400);
  await s.close();
});
test('priority change recomputes the due time; assignment validates agents', async () => {
  now = new Date('2026-11-24T10:00:00Z');
  const s = await start((o) => build({ ...o, clock }));
  const t = (await s.call('POST', '/api/tickets', { ...NEW, priority: 'low' })).data.ticket;
  const up = await s.call('PATCH', `/api/tickets/${t.id}`, { priority: 'urgent' });
  assert.equal(up.data.ticket.sla_due, '2026-11-24T14:00:00.000Z');
  assert.equal((await s.call('PATCH', `/api/tickets/${t.id}`, { assignee_id: 9999 })).status, 400);
  const a = (await s.call('GET', '/api/agents')).data.agents[0];
  assert.equal((await s.call('PATCH', `/api/tickets/${t.id}`, { assignee_id: a.id })).data.ticket.assignee_name, a.name);
  await s.call('PATCH', `/api/agents/${a.id}`, { active: false });
  assert.equal((await s.call('PATCH', `/api/tickets/${t.id}`, { assignee_id: a.id })).status, 400);
  await s.close();
});
test('validation, search filter and dashboard counts', async () => {
  now = new Date('2026-11-24T14:00:00Z');
  const s = await start((o) => build({ ...o, clock }));
  assert.equal((await s.call('POST', '/api/tickets', { ...NEW, requester_email: 'bad' })).status, 400);
  assert.equal((await s.call('POST', '/api/tickets', { ...NEW, priority: 'meh' })).status, 400);
  assert.equal((await s.call('POST', '/api/tickets', { ...NEW, subject: '' })).status, 400);
  assert.equal((await s.call('GET', '/api/tickets?status=weird')).status, 400);
  const q = await s.call('GET', '/api/tickets?q=' + encodeURIComponent("100%' OR 1=1 --")); assert.equal(q.data.tickets.length, 0);
  const all = (await s.call('GET', '/api/tickets?status=')).data.tickets;
  const active = (await s.call('GET', '/api/tickets?status=active')).data.tickets;
  assert.ok(active.length < all.length && active.every((t) => ['open', 'pending'].includes(t.status)));
  const d = (await s.call('GET', '/api/dashboard')).data;
  assert.equal(d.open, active.length);
  assert.equal(d.breached, active.filter((t) => t.sla_state === 'breached').length);
  assert.ok(d.breached >= 1 && d.sla_met_pct_7d !== null);
  const csv = await s.call('GET', '/api/tickets.csv', null, true); assert.match(csv.text, /^Number,Subject/);
  await s.close();
});
test('data survives a restart (file database)', async () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hd-')), 'x.db');
  let s = await start((o) => build({ ...o, dbFile, clock }));
  const id = (await s.call('POST', '/api/tickets', NEW)).data.ticket.id; await s.close();
  s = await start((o) => build({ ...o, dbFile, clock }));
  assert.equal((await s.call('GET', '/api/tickets/' + id)).data.ticket.subject, NEW.subject);
  await s.close();
});
test('static files cannot escape the public folder', async () => {
  const s = await start((o) => build({ ...o, clock }));
  assert.equal((await s.call('GET', '/..%2f..%2fpackage.json', null, true)).status, 404);
  assert.equal((await s.call('GET', '/', null, true)).status, 200);
  await s.close();
});
