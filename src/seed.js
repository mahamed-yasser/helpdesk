'use strict';
const sla = require('./sla');
module.exports = function seed(db, now) {
  const agents = [['Lina Haddad', 'lina@northwind.example'], ['Omar Fathy', 'omar@northwind.example'], ['Priya Nair', 'priya@northwind.example'], ['Tom Becker', 'tom@northwind.example']];
  agents.forEach((a) => db.prepare('INSERT INTO agents(name,email) VALUES(?,?)').run(...a));
  const canned = [
    ['Acknowledge', 'Hi {{name}}, thanks for getting in touch. I am looking into this now and will update you within one business day. - {{agent}}'],
    ['Need more details', 'Hi {{name}}, to help us reproduce this, could you send the exact steps you took and a screenshot of any error? - {{agent}}'],
    ['Resolved', 'Hi {{name}}, this is now fixed on our side. Please try again and tell us if anything still looks wrong. - {{agent}}'],
  ];
  canned.forEach((c) => db.prepare('INSERT INTO canned(title,body) VALUES(?,?)').run(...c));
  const H = 3600e3, at = (h) => new Date(now.getTime() - h * H).toISOString();
  // subject, name, email, category, priority, hoursAgo, status, assignee(1-4|0), firstResponseAfterHours|null, resolvedAfterHours|null, pausedForBizMin
  const T = [
    ['Cannot log in after password reset', 'Maya Collins', 'maya@brightlabs.example', 'Account', 'high', 30, 'open', 1, 1.5, null, 0],
    ['Invoice PDF shows wrong VAT number', 'Daniel Reyes', 'daniel@reyesco.example', 'Billing', 'normal', 52, 'open', 2, 20, null, 0],
    ['Checkout page returns 500 for some carts', 'Sofia Marin', 'sofia@marinhome.example', 'Bug', 'urgent', 3, 'open', 3, null, null, 0],
    ['How do I export last year\'s orders?', 'Ken Watanabe', 'ken@wtnb.example', 'How-to', 'low', 70, 'open', 0, null, null, 0],
    ['Webhook retries not firing', 'Aisha Rahman', 'aisha@payloop.example', 'Bug', 'high', 9, 'open', 1, 2, null, 0],
    ['Add a second admin to our workspace', 'Greta Olsen', 'greta@olsen.example', 'Account', 'normal', 20, 'pending', 2, 1, null, 120],
    ['Dashboard charts blank on Safari', 'Hugo Martin', 'hugo@martinstudio.example', 'Bug', 'normal', 26, 'pending', 3, 3, null, 240],
    ['Refund for duplicate charge', 'Nadia Kamel', 'nadia@kamel.example', 'Billing', 'high', 48, 'resolved', 1, 1, 6, 0],
    ['Change plan from monthly to annual', 'Leo Fischer', 'leo@fischer.example', 'Billing', 'normal', 60, 'resolved', 2, 4, 22, 0],
    ['CSV import drops accented names', 'Elena Petrova', 'elena@petrova.example', 'Bug', 'high', 80, 'resolved', 3, 2, 40, 0],
    ['Request: dark mode', 'Chris Adeyemi', 'chris@adeyemi.example', 'Feature', 'low', 110, 'closed', 4, 6, 30, 0],
    ['Two-factor codes arrive late', 'Yuki Tanaka', 'yuki@tanaka.example', 'Account', 'urgent', 100, 'resolved', 1, 1, 5, 0],
    ['Where is my receipt?', 'Rosa Alvarez', 'rosa@alvarez.example', 'Billing', 'low', 5, 'open', 0, null, null, 0],
    ['API key rotated but old key still works', 'Ivan Petrov', 'ivan@petrov.example', 'Security', 'urgent', 6, 'open', 4, 1, null, 0],
  ];
  T.forEach(([subject, name, email, cat, prio, hAgo, status, asg, frt, res, paused], i) => {
    const created = at(hAgo), number = 'HD-' + (1001 + i);
    const resolvedAt = res != null ? new Date(new Date(created).getTime() + res * H).toISOString() : null;
    const firstAt = frt != null ? new Date(new Date(created).getTime() + frt * H).toISOString() : null;
    const pausedAt = status === 'pending' ? at(2) : null;
    const due = sla.dueFor(created, prio, paused);
    const id = db.prepare(`INSERT INTO tickets(number,subject,requester_name,requester_email,category,priority,status,assignee_id,created_at,updated_at,sla_due,paused_at,paused_minutes,first_response_at,resolved_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(number, subject, name, email, cat, prio, status, asg || null, created, firstAt || created, due, pausedAt, paused, firstAt, resolvedAt).lastInsertRowid;
    db.prepare("INSERT INTO comments(ticket_id,author,kind,body,created_at) VALUES(?,?, 'customer',?,?)").run(id, name,
      `Hi, ${subject.toLowerCase().includes('?') ? subject : 'I need help with this: ' + subject.toLowerCase()}. It started yesterday and is blocking my team.`, created);
    if (firstAt) db.prepare("INSERT INTO comments(ticket_id,author,kind,body,created_at) VALUES(?,?, 'public',?,?)").run(id, agents[asg - 1][0], `Hi ${name.split(' ')[0]}, thanks for the report. I am on it and will update you shortly.`, firstAt);
    if (asg && status !== 'closed') db.prepare("INSERT INTO comments(ticket_id,author,kind,body,created_at) VALUES(?,?, 'internal',?,?)").run(id, agents[asg - 1][0], 'Checked logs, nothing unusual in the last 24h. Waiting on details.', firstAt || created);
  });
};
