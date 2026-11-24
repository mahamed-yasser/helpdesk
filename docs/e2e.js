'use strict';
const e2e = require('./e2ekit'); const { build } = require('../src/app');
const clock = () => new Date('2026-11-24T14:00:00Z');
e2e((o) => build({ ...o, clock }), async ({ page, shot, ok, restart, login, modal, tick, url }) => {
  await login(); await page.clickText('button', 'Sign out'); await page.waitFor('document.querySelector("input[name=password]")'); await tick(200); ok(!(await page.eval('!!document.querySelector("input[name=name]")')), 'after first-run setup the page asks for sign-in, not setup');
  await page.fill('username', 'owner'); await page.fill('password', 'definitely-wrong-1'); await page.eval('document.querySelector(".login").requestSubmit()');
  await page.waitFor('document.querySelector(".form-error").textContent.includes("Wrong")'); ok(true, 'wrong password is rejected with a message');
  await login(); ok((await page.text()).includes('Needs attention'), 'signed in and dashboard shown');
  await tick(400); await shot('01-dashboard');
  await page.click('a[data-id=tickets]'); await page.waitFor('document.querySelectorAll("tbody tr").length>5'); await shot('02-tickets');
  // create a ticket through the UI
  await page.clickText('button', 'New ticket'); await page.waitFor('document.querySelector(".modal")');
  await modal('requester_name', 'Sam Okafor'); await modal('requester_email', 'sam@okafor.example'); await modal('subject', 'Cannot download my annual report');
  await modal('priority', 'urgent'); await modal('body', 'The download button spins forever since this morning.'); await page.click('#modal-submit');
  await page.waitFor('!document.querySelector(".modal")'); await page.waitFor('document.body.innerText.includes("Cannot download my annual report")'); ok(true, 'new ticket appears in the list');
  await page.clickText('tbody tr', 'Cannot download my annual report'); await page.waitFor('location.hash.startsWith("#/tickets/")&&document.querySelector("textarea")');
  // canned reply -> public reply
  await page.eval(`(()=>{const s=document.querySelector('select[aria-label="Canned reply"]');s.value=[...s.options].find(o=>o.textContent==='Acknowledge').value;s.dispatchEvent(new Event('change'))})()`);
  ok((await page.eval('document.querySelector("textarea").value')).includes('Hi Sam,'), 'canned reply fills the requester\'s first name');
  await page.clickText('button', 'Send'); await page.waitFor('document.body.innerText.includes("Reply sent")'); ok(true, 'public reply recorded');
  await page.clickText('button', 'Wait on customer'); await page.waitFor('document.body.innerText.includes("clock paused")'); ok(true, 'pending status pauses the SLA clock');
  await shot('03-ticket-detail');
  await restart(); await page.eval('location.reload()'); await page.waitFor('document.body.innerText.includes("clock paused")');
  ok(true, 'ticket, reply and status are still there after restart (session survives too)');
  await page.clickText('button', 'Resolve'); await page.waitFor('document.body.innerText.includes("Met")'); ok(true, 'resolving inside the target shows SLA Met');
  // illegal-transition guard through the API with the page cookie
  const code = await page.eval(`fetch(location.pathname.replace(/$/,'')+'api/tickets/'+location.hash.split('/')[2],{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'pending'})}).then(r=>r.status)`);
  ok(code === 400, 'API refuses resolved -> pending');
  // mobile
  await page.viewport(390, 844, true); await page.eval('location.hash="#/dashboard"'); await tick(600); await shot('04-mobile-dashboard');
  await page.eval('location.hash="#/tickets"'); await page.waitFor('document.querySelectorAll("tbody tr").length>5'); await shot('05-mobile-tickets');
  await page.viewport(1280, 800, false);
}, { docs: __dirname });
