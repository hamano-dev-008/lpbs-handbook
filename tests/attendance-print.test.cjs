const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
process.env.TZ='Asia/Kuala_Lumpur';
const html=fs.readFileSync(process.env.PADIAPP_TEST_HTML||path.join(__dirname,'../index.html'),'utf8');
function source(from,to){const a=html.indexOf(from),b=html.indexOf(to,a);assert(a>=0&&b>a);return html.slice(a,b);}
function fixture(){
 const nodes=new Map(),tables=[],texts=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',checked:false,disabled:false,selectedOptions:[],classList:{remove(){},add(){}}});return nodes.get(id);};
 class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-29T17:30:00+08:00']));}}
 class PDF{
  constructor(){this.internal={pageSize:{getHeight:()=>595}};}
  setFont(){}setFontSize(){}setTextColor(){}addPage(){}
  text(value){texts.push(value);}
  autoTable(options){tables.push(options);this.lastAutoTable={finalY:options.startY+80};}
  save(){}
 }
 const c=vm.createContext({Date:Clock,Map,Set,Number,console,window:{jspdf:{jsPDF:PDF}},document:{getElementById:node,querySelectorAll:()=>[]},
  STAFF_DIRECTORY:new Map([['a',{nama:'Ali',kategori:'HQ Kota Kinabalu'}],['b',{nama:'Bala',kategori:'Daerah'}],['c',{nama:'Citra',kategori:'HQ'}],['d',{nama:'Ali',kategori:'HQ'}]]),
  kehadiranRecords:[],kehadiranLoaded:true,khHolidayApprovalsLoaded:true,khHolidayApprovalError:'',
  getKhObservedHoliday:key=>key==='2026-10-26'?'Cuti Sabah':'',
  fmtKey:d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),
  fmtKehadiranRemark:r=>r.remark||'',MONTH_NAMES:['Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogos','Sep','Okt','Nov','Dis']
 });
 vm.runInContext(source('function calcHours(', '// Sheets API boleh'),c);
 vm.runInContext(source("let khPdfMode = 'harian';", '// ============================================================\n// REKOD KEHADIRAN SAYA'),c);
 return {c,node,tables,texts,run:s=>vm.runInContext(s,c)};
}
function record(overrides={}){return {tarikh:'2026-10-28',nama:'Ali',masuk:'08:00',keluar:'17:00',status:'Hadir',remark:'',...overrides};}
test('nine-hour boundary uses actual minutes and separates incomplete shifts',()=>{
 const f=fixture();
 for(const [overrides,expected] of [[{},''],[{masuk:'08:01'},'short'],[{keluar:''},'open'],[{masuk:''},'missing'],[{masuk:'',keluar:'',missing:true},'missing'],[{masuk:'22:00',keluar:'07:00'},'']]){
  f.c.record=record(overrides);assert.equal(f.run('getKhPdfIssue(record)'),expected);
 }
});
test('approved statuses, weekends, holidays and future days are never flagged',()=>{
 const f=fixture();
 for(const overrides of [...['Cuti','MC','Outstation','Kursus'].map(status=>({status,masuk:'',keluar:''})),{tarikh:'2026-10-25',masuk:'',keluar:'',missing:true},{tarikh:'2026-10-26',masuk:'08:00',keluar:'12:00'},{tarikh:'2026-10-30',masuk:'',keluar:'',missing:true}]){
  f.c.record=record(overrides);assert.equal(f.run('getKhPdfIssue(record)'),'');
 }
});
test('missing records follow all-staff/HQ filters, preserve exclusions and deduplicate directory names',()=>{
 const f=fixture();f.c.records=[record({nama:'Ali',status:'Cuti',masuk:'',keluar:''})];
 assert.equal(f.run('buildMissingHqRecords(["2026-10-28"],records,new Set(),false).map(r=>r.nama).join(",")'),'Bala,Citra');
 assert.equal(f.run('buildMissingHqRecords(["2026-10-28"],records,new Set(),true).map(r=>r.nama).join(",")'),'Citra');
 assert.equal(f.run('buildMissingHqRecords(["2026-10-28"],[],new Set(["citra"]),false).map(r=>r.nama).join(",")'),'Ali,Bala');
});
test('daily and monthly exports include staff with no record and respect report selection',()=>{
 const f=fixture();let captured;
 f.c.generateKehadiranPDF=(label,records,monthly)=>{captured={label,records,monthly};};
 f.node('khPdfDate').value='2026-10-28';f.run('confirmKhPdfModal()');assert.equal(captured.records.length,3);
 f.node('khPdfHqOnly').checked=true;f.run('confirmKhPdfModal()');assert.equal(captured.records.length,2);
 f.node('khExcludeStaff').selectedOptions=[{value:'Citra'}];f.run('confirmKhPdfModal()');assert.equal(captured.records.length,1);
 f.run('khPdfMode="bulanan"');f.node('khPdfMonth').value='2026-10';f.run('confirmKhPdfModal()');
 assert.equal(captured.monthly,true);assert(captured.records.every(r=>r.nama==='Ali'&&r.tarikh<='2026-10-29'));
 assert(!captured.records.some(r=>['2026-10-24','2026-10-25','2026-10-26'].includes(r.tarikh)));
});
test('unavailable holiday data prevents generating misleading missing-staff rows',()=>{
 const f=fixture();f.c.khHolidayApprovalsLoaded=false;let generated=false;f.c.generateKehadiranPDF=()=>{generated=true;};
 f.node('khPdfDate').value='2026-10-28';f.run('confirmKhPdfModal()');assert.equal(generated,false);assert.match(f.node('khPdfModalNote').textContent,/belum tersedia/);
});
test('PDF puts issue groups after normal records without duplicate rows or altered input order',()=>{
 const f=fixture();f.c.records=[record({nama:'Short',keluar:'16:00'}),record({nama:'Missing',missing:true,masuk:'',keluar:''}),record({nama:'Regular'}),record({nama:'Open',keluar:''}),record({nama:'Leave',status:'Cuti',masuk:'',keluar:''})];
 const before=JSON.stringify(f.c.records);f.run('generateKehadiranPDF("2026-10",records,true)');
 assert.equal(JSON.stringify(f.c.records),before);
 assert.deepEqual(f.tables.map(t=>Array.from(t.body,r=>r[2])),[['Leave','Regular'],['Missing'],['Short'],['Open']]);
 assert.deepEqual(f.tables.flatMap(t=>t.body.map(r=>r[0])),[1,2,3,4,5]);
 assert.equal(f.tables[1].body[0][5],'-');assert.equal(f.tables[2].body[0][5],'8 jam');assert.equal(f.tables[3].body[0][5],'-');
 assert(f.texts.indexOf('Perlu semakan - Belum Clock Out (1)')<f.texts.indexOf('Disemak dan Disahkan oleh:'));
});
