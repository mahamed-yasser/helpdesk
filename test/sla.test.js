'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const sla = require('../src/sla');
const D = (s) => new Date(s);

test('addBusinessMinutes stays inside Mon-Fri 09-17 UTC', () => {
  assert.equal(sla.addBusinessMinutes(D('2026-11-24T10:00:00Z'), 120).toISOString(), '2026-11-24T12:00:00.000Z');
  // Tuesday 16:00 + 2h crosses close of day -> Wednesday 10:00
  assert.equal(sla.addBusinessMinutes(D('2026-11-24T16:00:00Z'), 120).toISOString(), '2026-11-25T10:00:00.000Z');
  // Friday 15:00 + 4h -> Monday 11:00 (weekend skipped)
  assert.equal(sla.addBusinessMinutes(D('2026-11-27T15:00:00Z'), 240).toISOString(), '2026-11-30T11:00:00.000Z');
  // Saturday start counts from Monday 09:00
  assert.equal(sla.addBusinessMinutes(D('2026-11-28T12:00:00Z'), 60).toISOString(), '2026-11-30T10:00:00.000Z');
  // exactly fills the day
  assert.equal(sla.addBusinessMinutes(D('2026-11-24T09:00:00Z'), 480).toISOString(), '2026-11-24T17:00:00.000Z');
});
test('businessMinutesBetween', () => {
  assert.equal(sla.businessMinutesBetween(D('2026-11-24T10:00:00Z'), D('2026-11-24T12:30:00Z')), 150);
  assert.equal(sla.businessMinutesBetween(D('2026-11-27T16:00:00Z'), D('2026-11-30T10:00:00Z')), 120); // Fri 1h + Mon 1h
  assert.equal(sla.businessMinutesBetween(D('2026-11-28T01:00:00Z'), D('2026-11-29T23:00:00Z')), 0);
  assert.equal(sla.businessMinutesBetween(D('2026-11-25T10:00:00Z'), D('2026-11-24T10:00:00Z')), 0);
  assert.equal(sla.businessMinutesBetween(D('2026-11-24T00:00:00Z'), D('2026-11-26T23:59:00Z')), 3 * 480);
});
test('slaState', () => {
  const t = { status: 'open', priority: 'normal', sla_due: '2026-11-25T17:00:00.000Z' };
  assert.equal(sla.slaState(t, D('2026-11-24T10:00:00Z')), 'ok');
  assert.equal(sla.slaState(t, D('2026-11-25T14:00:00Z')), 'at_risk'); // 3h left of 16h (<25%)
  assert.equal(sla.slaState(t, D('2026-11-25T17:01:00Z')), 'breached');
  assert.equal(sla.slaState({ ...t, status: 'pending' }, D('2026-12-25T10:00:00Z')), 'paused');
  assert.equal(sla.slaState({ ...t, status: 'resolved', resolved_at: '2026-11-25T09:00:00.000Z' }, D('2027-01-01T00:00:00Z')), 'met');
  assert.equal(sla.slaState({ ...t, status: 'resolved', resolved_at: '2026-11-26T09:00:00.000Z' }, D('2027-01-01T00:00:00Z')), 'breached');
});
