'use strict';
// Business-hours SLA maths. Business hours are Mon-Fri 09:00-17:00 UTC (one fixed schedule; no holidays).
const WS = 9 * 60, WE = 17 * 60;
const POLICY_MIN = { urgent: 4 * 60, high: 8 * 60, normal: 16 * 60, low: 40 * 60 };
const mins = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();
const isBiz = (d) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
function nextBizStart(date) {
  const t = new Date(date);
  for (;;) {
    const m = mins(t);
    if (isBiz(t)) { if (m < WS) { t.setUTCHours(9, 0, 0, 0); return t; } if (m < WE) return t; }
    t.setUTCDate(t.getUTCDate() + 1); t.setUTCHours(9, 0, 0, 0);
  }
}
function addBusinessMinutes(start, minutes) {
  let t = nextBizStart(start), left = minutes;
  for (;;) {
    const room = WE - mins(t);
    if (left <= room) return new Date(t.getTime() + left * 60000);
    left -= room; t = new Date(t); t.setUTCDate(t.getUTCDate() + 1); t.setUTCHours(9, 0, 0, 0); t = nextBizStart(t);
  }
}
function businessMinutesBetween(a, b) {
  a = new Date(a); b = new Date(b);
  if (b <= a) return 0;
  let total = 0; const day = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
  while (day <= b) {
    if (isBiz(day)) {
      const s = Math.max(a.getTime(), day.getTime() + WS * 60000), e = Math.min(b.getTime(), day.getTime() + WE * 60000);
      if (e > s) total += (e - s) / 60000;
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return Math.round(total);
}
function dueFor(createdAt, priority, pausedMinutes = 0) {
  return addBusinessMinutes(new Date(createdAt), POLICY_MIN[priority] + pausedMinutes).toISOString();
}
// state: met | breached | paused | at_risk | ok
function slaState(t, now) {
  if (t.status === 'resolved' || t.status === 'closed') return t.resolved_at && t.resolved_at <= t.sla_due ? 'met' : 'breached';
  if (t.status === 'pending') return 'paused';
  if (now.toISOString() > t.sla_due) return 'breached';
  const left = businessMinutesBetween(now, t.sla_due);
  return left <= POLICY_MIN[t.priority] * 0.25 ? 'at_risk' : 'ok';
}
const TRANSITIONS = { open: ['pending', 'resolved'], pending: ['open', 'resolved'], resolved: ['open', 'closed'], closed: [] };
module.exports = { POLICY_MIN, nextBizStart, addBusinessMinutes, businessMinutesBetween, dueFor, slaState, TRANSITIONS };
