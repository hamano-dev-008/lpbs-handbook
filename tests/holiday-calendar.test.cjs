const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

process.env.TZ = 'Asia/Kuala_Lumpur';
const html = fs.readFileSync(process.env.PADIAPP_TEST_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
function source(from, to){
  const start = html.indexOf(from);
  assert(start >= 0, from);
  const end = html.indexOf(to, start);
  assert(end > start, to);
  return html.slice(start, end);
}

function fixture(editor = true){
  const nodes = new Map();
  const calls = [], rows = [], pages = [];
  let tabExists = false;
  class Clock extends Date {
    constructor(...args){ super(...(args.length ? args : ['2026-10-27T10:00:00+08:00'])); }
  }
  const c = vm.createContext({
    Date: Clock, Map, Set, URLSearchParams, console,
    currentUser: { email: editor ? 'editor@example.test' : 'staff@example.test' },
    accessToken: 'mock-token', KEHADIRAN_SHEET_ID: 'mock-sheet',
    isAllowedKehadiranEditor: email => email === 'editor@example.test',
    getKehadiranMode: () => editor ? 'pentadbir' : 'peribadi',
    fmtKey: d => [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'),
    fmtBulanMalay: s => s, fmtTarikhMalay: s => s,
    fmtTarikhPendek: d => String(d.getDate()),
    escapeHtml: s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
    getSelfCheckinName: () => 'Staf', isKhLewat: () => false,
    kehadiranRecords: [], kehadiranLoaded: false,
    refreshUtama: () => {}, handleAuthExpired: () => {},
    setInterval: () => {},
    document: { hidden: false, addEventListener: () => {}, getElementById: id => {
      if(!nodes.has(id)) nodes.set(id, { style: {}, innerHTML: '', textContent: '', value: '' });
      return nodes.get(id);
    } },
    apiFetch: async (url, options = {}) => {
      calls.push({ url, options });
      const body = options.body ? JSON.parse(options.body) : null;
      let data;
      if(url.includes('/calendar/v3/')) data = pages.shift() || { items: [] };
      else if(url.includes('?fields=sheets.properties.title')) data = { sheets: tabExists ? [{ properties: { title: 'CutiUmum' } }] : [] };
      else if(url.endsWith(':batchUpdate')){ tabExists = true; data = {}; }
      else if(url.includes(':append?')){ rows.push(...body.values); data = { updates: { updatedRows: 1 } }; }
      else if(options.method === 'PUT') data = {};
      else data = { values: rows };
      return { ok: true, status: 200, json: async () => data };
    }
  });
  vm.runInContext(source('let khMyMonth = null;', 'function stepKhMyMonth('), c);
  vm.runInContext(source('function getKhWorkdaysToCheck(', 'function buildMissingHqRecords('), c);
  vm.runInContext(source('function renderMyAttendanceCalendar(', 'function downloadMyKehadiranPDF('), c);
  const run = code => vm.runInContext(code, c);
  return { c, run, calls, rows, pages, nodes };
}

test('production inline scripts parse', () => {
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(!m[1].includes('src=') && !m[1].includes('module')) new vm.Script(m[2]);
  }
});

test('Google all-day events use exclusive ends, clip to month, deduplicate and ignore cancellations', () => {
  const f = fixture();
  f.c.events = [
    { id: 'span', summary: 'Holiday', start: { date: '2026-09-30' }, end: { date: '2026-10-03' } },
    { id: 'span', summary: 'Holiday', start: { date: '2026-09-30' }, end: { date: '2026-10-03' } },
    { id: 'cancel', status: 'cancelled', start: { date: '2026-10-04' }, end: { date: '2026-10-05' } },
    { id: 'timed', start: { dateTime: '2026-10-05T10:00:00+08:00' } }
  ];
  assert.equal(f.run('normalizeKhHolidayEvents(events,"2026-10").map(i=>i.date).join(",")'), '2026-10-01,2026-10-02');
  assert.equal(f.run('validKhHolidayDate("2026-02-30","2026-02")'), false);
});

test('feed follows pagination and uses Malaysian midnight boundaries', async () => {
  const f = fixture();
  await f.run('loadKhHolidayApprovals()');
  f.pages.push({ items: [{ id: 'a', summary: 'A', start: { date: '2026-10-01' }, end: { date: '2026-10-02' } }], nextPageToken: 'next' }, { items: [{ id: 'b', summary: 'B', start: { date: '2026-10-02' }, end: { date: '2026-10-03' } }] });
  await f.run('loadKhHolidayFeed("2026-10")');
  assert.equal(f.run('khHolidayFeeds.get("2026-10").items.length'), 2);
  const urls = f.calls.filter(c => c.url.includes('/calendar/v3/')).map(c => new URL(c.url));
  assert.equal(urls[0].searchParams.get('timeMin'), '2026-10-01T00:00:00+08:00');
  assert.equal(urls[0].searchParams.get('timeMax'), '2026-11-01T00:00:00+08:00');
  assert.equal(urls[1].searchParams.get('pageToken'), 'next');
});

test('editor must choose each holiday; shared save creates tab and retains yes/no decisions', async () => {
  const f = fixture();
  await f.run('loadKhHolidayApprovals()');
  await f.run('loadKhHolidayFeed("2026-10")');
  f.run('khHolidayFeeds.get("2026-10").items = [{id:"a",date:"2026-10-01",title:"A",manual:false,observed:null},{id:"b",date:"2026-10-02",title:"B",manual:false,observed:false}]');
  await f.run('saveKhHolidayMonth()');
  assert.equal(f.rows.length, 0);
  assert.match(f.run('khHolidayNotice'), /Pilih Ya atau Tidak/);
  f.run('setKhHolidayChoice(0,"yes")');
  assert.equal(f.run('getKhObservedHoliday("2026-10-01")'), '');
  await f.run('saveKhHolidayMonth()');
  assert.equal(f.rows.length, 1);
  assert.equal(f.run('getKhObservedHoliday("2026-10-01")'), 'A');
  assert.equal(f.run('getKhObservedHoliday("2026-10-02")'), '');
  assert.equal(f.run('khHolidayNeedsReview("2026-10")'), false);
  assert(f.calls.some(c => c.options.method === 'POST' && c.url.endsWith(':batchUpdate')));
  const staff = fixture(false);
  staff.rows.push(...f.rows);
  // Reuse the saved server responses, as if a second signed-in device loads the shared tab.
  staff.c.apiFetch = async url => ({ ok:true, status:200, json:async () => url.includes('?fields=') ? {sheets:[{properties:{title:'CutiUmum'}}]} : {values:f.rows} });
  await staff.run('loadKhHolidayApprovals()');
  assert.equal(staff.run('getKhObservedHoliday("2026-10-01")'), 'A');
});

test('staff cannot fetch editor feed or write decisions; empty months can be explicitly confirmed', async () => {
  const staff = fixture(false);
  await staff.run('loadKhHolidayFeed("2026-10")');
  await staff.run('saveKhHolidayMonth()');
  assert.equal(staff.calls.length, 0);
  const f = fixture();
  await f.run('loadKhHolidayApprovals()');
  await f.run('loadKhHolidayFeed("2026-10")');
  assert.equal(f.run('khHolidayNeedsReview("2026-10")'), true);
  await f.run('saveKhHolidayMonth()');
  assert.equal(f.run('khHolidayNeedsReview("2026-10")'), false);
  assert.equal(f.rows.length, 1);
});

test('observed holidays remove missing records and PDF workdays, while real clock-out issues stay visible', () => {
  const f = fixture();
  f.run('khHolidayApprovalsLoaded=true; khHolidayApprovals.set("2026-10",{items:[{date:"2026-10-01",title:"A",observed:true},{date:"2026-10-02",title:"B",observed:false}]}); kehadiranRecords=[{nama:"Staf",tarikh:"2026-09-30",status:"Hadir",masuk:"08:00",keluar:"17:00",jam:9},{nama:"Staf",tarikh:"2026-10-05",status:"Hadir",masuk:"08:00",keluar:"",jam:null},{nama:"Staf",tarikh:"2026-10-06",status:"Cuti",jam:null}]');
  assert.equal(f.run('getMyAttendanceMonth(2026,9).attn.some(i=>i.key==="2026-10-01")'), false);
  assert.equal(f.run('getMyAttendanceMonth(2026,9).attn.some(i=>i.key==="2026-10-02")'), true);
  assert.equal(f.run('getMyAttendanceMonth(2026,9).attn.find(i=>i.key==="2026-10-05").why'), 'Tiada clock-out');
  assert.equal(f.run('getMyAttendanceMonth(2026,9).attn.some(i=>i.key==="2026-10-06")'), false);
  assert.equal(f.run('getKhWorkdaysToCheck("2026-10-01","2026-10-04").join(",")'), '2026-10-02');
  f.run('khHolidayApprovalError="Offline"');
  assert.equal(f.run('getMyAttendanceMonth(2026,9).attn.some(i=>i.why==="Tiada rekod")'), false);
});

test('feed failures cannot confirm an empty month; new or renamed holidays require renewed review', async () => {
  const f = fixture();
  await f.run('loadKhHolidayApprovals()');
  f.c.apiFetch = async () => ({ok:false,status:503});
  await f.run('loadKhHolidayFeed("2026-10")');
  await f.run('saveKhHolidayMonth()');
  assert.equal(f.rows.length, 0);
  assert.equal(f.run('khHolidayFeeds.get("2026-10").ready'), false);
  f.run('khHolidayApprovals.set("2026-10",{items:[],fingerprint:"[]"});khHolidayFeeds.set("2026-10",{ready:true,items:[{id:"new",date:"2026-10-03",title:"New"}]})');
  assert.equal(f.run('khHolidayNeedsReview("2026-10")'), true);
});

test('monthly reminder persists until confirmation and returns when month changes', async () => {
  const f = fixture();
  await f.run('loadKhHolidayApprovals()');
  f.run('renderKhHolidayReminder()');
  assert.equal(f.nodes.get('khHolidayReminder').style.display, '');
  await f.run('loadKhHolidayFeed("2026-10");');
  await f.run('saveKhHolidayMonth()');
  f.run('renderKhHolidayReminder()');
  assert.equal(f.nodes.get('khHolidayReminder').style.display, 'none');
  f.c.khMyCurrentMonth = () => '2026-11';
  await f.run('checkKhHolidayMonth()');
  assert.equal(f.nodes.get('khHolidayReminder').style.display, '');
  assert.equal(f.run('khHolidayReminderMonth'), '2026-11');
});

test('calendar renders green holidays, escapes titles, and keeps future dates free of crosses', () => {
  const f = fixture();
  f.run('khHolidayApprovalsLoaded=true;khHolidayApprovals.set("2026-10",{items:[{date:"2026-10-01",title:"<Holiday>",observed:true}]})');
  const out = f.run('renderMyAttendanceCalendar(2026,10,{byDate:new Map()},new Map([["2026-10-01","Tiada rekod"],["2026-10-02","Tiada rekod"],["2026-10-28","Tiada rekod"]]),"2026-10-27")');
  assert.match(out, /class="kh-my-cell holiday"/);
  assert.match(out, /&lt;Holiday>/);
  assert.match(out, /Tiada rekod \(1 hari\)/);
  assert.equal((out.match(/class="kh-my-cell/g) || []).length, 31);
});

test('manual Sabah holidays survive save and feed refresh; turning observance off restores workdays', async () => {
  const f = fixture();
  await f.run('loadKhHolidayApprovals()');
  await f.run('loadKhHolidayFeed("2026-10")');
  f.c.document.getElementById('khHolidayDate').value = '2026-10-07';
  f.c.document.getElementById('khHolidayName').value = 'Cuti gantian Sabah';
  f.run('addKhManualHoliday()');
  await f.run('saveKhHolidayMonth()');
  assert.equal(f.run('getKhObservedHoliday("2026-10-07")'), 'Cuti gantian Sabah');
  await f.run('loadKhHolidayFeed("2026-10",true)');
  assert.equal(f.run('khHolidayFeeds.get("2026-10").items[0].manual'), true);
  f.run('setKhHolidayChoice(0,"no")');
  await f.run('saveKhHolidayMonth()');
  assert.equal(f.run('getKhObservedHoliday("2026-10-07")'), '');
  assert.equal(f.rows.length, 2);
});

test('failed or malformed shared data shows an error instead of treating a month as empty', async () => {
  const f = fixture();
  f.c.apiFetch = async () => ({ok:false,status:403});
  await f.run('loadKhHolidayApprovals()');
  assert.equal(f.run('khHolidayApprovalsLoaded'), false);
  assert.match(f.run('khHolidayApprovalError'), /403/);
  f.c.apiFetch = async url => ({ok:true,status:200,json:async () => url.includes('?fields=') ? {sheets:[{properties:{title:'CutiUmum'}}]} : {values:[['2026-10','invalid JSON']]} });
  await f.run('loadKhHolidayApprovals()');
  assert.equal(f.run('khHolidayApprovalsLoaded'), false);
  assert(f.run('khHolidayApprovalError').length > 0);
});

test('logout during a save stops before appending a decision under another session', async () => {
  const f = fixture();
  await f.run('loadKhHolidayApprovals()');
  await f.run('loadKhHolidayFeed("2026-10")');
  const fetch = f.c.apiFetch;
  f.c.apiFetch = async (url, opts) => {
    const result = await fetch(url,opts);
    if(opts && opts.method === 'PUT') f.c.currentUser = null;
    return result;
  };
  await f.run('saveKhHolidayMonth()');
  assert.equal(f.rows.length, 0);
});
