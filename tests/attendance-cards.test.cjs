const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
process.env.TZ = 'Asia/Kuala_Lumpur';
const html = fs.readFileSync(process.env.PADIAPP_TEST_HTML || path.join(__dirname,'..','index.html'),'utf8');
function source(from,to){
  const start=html.indexOf(from), end=html.indexOf(to,start+from.length);
  assert(start>=0 && end>start,from);
  return html.slice(start,end);
}
function fixture(editor=true){
  const nodes=new Map(), calls=[], alerts=[];
  function node(id){
    if(!nodes.has(id)){
      const classes=new Set();
      nodes.set(id,{value:'',innerHTML:'',textContent:'',disabled:false,
        classList:{add:s=>classes.add(s),remove:s=>classes.delete(s),contains:s=>classes.has(s),toggle:()=>{}},
        focus(){this.focused=true;},scrollIntoView(){},addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];}});
    }
    return nodes.get(id);
  }
  class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-27T10:00:00+08:00']));}}
  const c=vm.createContext({Date:Clock,Map,Set,console,
    document:{getElementById:node,querySelectorAll:()=>[]},
    currentUser:{email:editor?'editor@example.test':'staff@example.test'},
    isKhHolidayEditor:()=>editor,isAllowedKehadiranEditor:()=>editor,
    STAFF_DIRECTORY:new Map([['staff@example.test',{nama:'Siti',jawatan:'Pegawai Pertanian'}]]),
    kehadiranRecords:[],kehadiranLoaded:true,khHolidayApprovalsLoaded:true,khHolidayApprovalError:'',
    getKhObservedHoliday:()=>'',getStaffDisplayName:email=>email,
    khEditorSearch:'',khEditorRecordView:'semua',khFilterFrom:'2026-10-27',khFilterTo:'2026-10-27',
    bulkEditDate:null,bulkEditDirtyRows:new Set(),editingKehadiranRow:null,khRecordEditSaving:false,
    KEHADIRAN_STATUS_OPTIONS:['Hadir','Cuti','MC','Outstation','Kursus'],
    fmtKey:d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),
    fmtTarikhMalay:d=>d,fmtHours:h=>h+'j',MONTH_NAMES:Array.from({length:12},(_,i)=>String(i+1)),
    escapeHtml:s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    getPergerakanForRecord:r=>r.events||[],renderPergerakanTimeline:()=>'<ul><li>10:00 Keluar · 12:30 Kembali</li></ul>',
    populateKehadiranStaffFilter:()=>{},openKhEditorForm:()=>calls.push('add-form'),
    setKhEditorRecordView:()=>{},saveAllBulkEdit:()=>{},cancelBulkEdit:()=>{},
    accessToken:'mock-token',KEHADIRAN_SHEET_ID:'mock-sheet',sessionStorage:{getItem:()=>null},
    apiFetch:async (url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({})};},
    loadKehadiranFromSheet:async()=>true,alert:m=>alerts.push(m)
  });
  vm.runInContext(source('function khPresetRange(', '// Semak staf yang belum'),c);
  vm.runInContext(source('function semakStafTidakHadir(){','function jumpToEditKehadiranRow('),c);
  vm.runInContext(source('function khAttendanceStaffInfo(', 'function toggleBulkEditPanel('),c);
  vm.runInContext(source('function normalizeTime(', 'function markBulkEditRowDirty('),c);
  return {c,nodes,node,calls,alerts,run:code=>vm.runInContext(code,c)};
}
const record={rowIndex:2,nama:'Siti',tarikh:'2026-10-27',masuk:'08:00',keluar:'17:00',jam:9,status:'Hadir',remark:'Mesyuarat luar',lokasi:'Kota Kinabalu',tajuk:'Lawatan'};

test('cards include attendance, staff details, notes and expandable movements without a table',()=>{
  const f=fixture();f.c.rec={...record,events:[{}]};
  const out=f.run('renderKhAttendanceCard(rec)');
  for(const text of ['kh-attendance-card','Pegawai Pertanian','08:00','17:00','9j','Mesyuarat luar','Kota Kinabalu','Lawatan','Lihat pergerakan (1)','startEditKehadiranRow(2)']) assert(out.includes(text),text);
  assert(!out.includes('<table'));
});

test('missing and incomplete cards show appropriate states and escape staff-supplied content',()=>{
  const f=fixture();f.c.rec={...record,nama:'<Siti "A">',remark:'<img src=x onerror=alert(1)>',tarikh:'2026-10-26',keluar:'',jam:null};
  let out=f.run('renderKhAttendanceCard(rec)');
  assert.match(out,/Tiada clock-out/);assert.match(out,/needs-attention/);assert(!out.includes('<img'));
  assert.match(out,/&lt;Siti &quot;A&quot;&gt;/);
  f.c.rec={...record,missing:true};out=f.run('renderKhAttendanceCard(rec)');
  assert.match(out,/Tiada rekod/);assert.match(out,/fillKhMissingRecord/);
  const staff=fixture(false);staff.c.rec=record;
  assert(!staff.run('renderKhAttendanceCard(rec)').includes('startEditKehadiranRow'));
});

test('record cards filter by name and date, and group multiple days without table markup',()=>{
  const f=fixture();f.c.kehadiranRecords=[record,{...record,rowIndex:3,nama:'Ali'},{...record,rowIndex:4,tarikh:'2026-10-26'}];
  f.c.khEditorSearch='sItI';f.run('renderKehadiranTable()');
  let out=f.node('khTableWrap').innerHTML;
  assert(out.includes('khAttendanceCard2'));assert(!out.includes('khAttendanceCard3'));assert(!out.includes('khAttendanceCard4'));
  f.c.khEditorSearch='';f.c.khFilterFrom='2026-10-26';f.run('renderKehadiranTable()');
  out=f.node('khTableWrap').innerHTML;assert.equal((out.match(/class="kh-attendance-grid"/g)||[]).length,2);assert(!out.includes('<table'));
});

test('day navigation crosses month boundaries using local dates and shares the selected date',()=>{
  const f=fixture();f.node('khEditorDate').value='2026-10-01';
  f.run('stepKhEditorDay(-1)');
  assert.equal(f.c.khFilterFrom,'2026-09-30');assert.equal(f.node('khSemakTarikh').value,'2026-09-30');
  assert.equal(f.node('khLupaTarikh').value,'2026-09-30');assert.equal(f.node('kh-tarikh').value,'2026-09-30');
  f.run('selectKhEditorDay("2026-02-30")');assert.equal(f.c.khFilterFrom,'2026-09-30');
});

test('both checks render cards; missing records exclude weekends, future dates and confirmed holidays',()=>{
  const f=fixture();f.node('khSemakTarikh').value='2026-10-26';f.run('semakStafTidakHadir()');
  assert.match(f.node('khSemakResults').innerHTML,/kh-attendance-card/);
  f.node('khSemakTarikh').value='2026-10-25';f.run('semakStafTidakHadir()');assert(!f.node('khSemakResults').innerHTML.includes('kh-attendance-card'));
  f.node('khSemakTarikh').value='2026-10-28';f.run('semakStafTidakHadir()');assert(!f.node('khSemakResults').innerHTML.includes('kh-attendance-card'));
  f.node('khSemakTarikh').value='2026-10-26';f.c.getKhObservedHoliday=()=> 'Cuti Sabah';f.run('semakStafTidakHadir()');assert(!f.node('khSemakResults').innerHTML.includes('kh-attendance-card'));
  f.c.kehadiranRecords=[{...record,keluar:'',jam:null}];f.node('khLupaTarikh').value=record.tarikh;f.run('semakStafLupaClockOut()');assert.match(f.node('khLupaResults').innerHTML,/kh-attendance-card/);
});

test('editing opens a separate form; saving preserves Sheets column order and prevents duplicate submissions',async()=>{
  const f=fixture();f.c.kehadiranRecords=[record];f.run('startEditKehadiranRow(2)');
  assert(f.node('khRecordEditOverlay').classList.contains('open'));
  assert.match(f.node('khRecordEditBody').innerHTML,/khEdit-keluar-2/);
  for(const [field,value] of Object.entries({tarikh:record.tarikh,nama:record.nama,masuk:'08:00',keluar:'17:30',status:'Hadir',remark:'Updated'})) f.node('khEdit-'+field+'-2').value=value;
  await f.run('saveEditKehadiranRow(2)');
  const write=f.calls.find(c=>c.opts);assert.deepEqual(JSON.parse(write.opts.body).values,[[record.tarikh,'Siti','08:00','17:30','Hadir','Updated']]);
  assert(!f.node('khRecordEditOverlay').classList.contains('open'));assert.equal(f.c.editingKehadiranRow,null);
  await f.run('saveEditKehadiranRow(2)');assert.equal(f.calls.filter(c=>c.opts).length,1);
});

test('failed saves keep the edit form open for retry and cancellation retains original data',async()=>{
  const f=fixture();f.c.kehadiranRecords=[record];f.run('startEditKehadiranRow(2)');
  for(const [field,value] of Object.entries({tarikh:record.tarikh,nama:record.nama,masuk:record.masuk,keluar:record.keluar,status:'Hadir',remark:''}))f.node('khEdit-'+field+'-2').value=value;
  f.c.apiFetch=async()=>({ok:false,status:403,json:async()=>({error:{message:'Forbidden'}})});
  await f.run('saveEditKehadiranRow(2)');assert(f.node('khRecordEditOverlay').classList.contains('open'));assert.equal(f.c.khRecordEditSaving,false);assert.match(f.alerts[0],/Forbidden/);
  f.run('cancelEditKehadiranRow()');assert.equal(f.c.editingKehadiranRow,null);assert.equal(record.keluar,'17:00');
});

test('bulk editing also renders cards while retaining its field IDs and save actions',()=>{
  const f=fixture();f.c.kehadiranRecords=[record];f.c.bulkEditDate=record.tarikh;
  f.run('renderBulkEditTable()');const out=f.node('khTableWrap').innerHTML;
  assert(!out.includes('<table'));assert.match(out,/kh-attendance-card/);
  assert.match(out,/khBulkSaveAllBtn/);assert.equal(f.node('khBulk-masuk-2').value,'08:00');assert.equal(f.node('khBulk-status-2').value,'Hadir');
});
