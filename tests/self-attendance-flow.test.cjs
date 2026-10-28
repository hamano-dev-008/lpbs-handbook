const { test }=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(process.env.PADIAPP_TEST_HTML||require('node:path').join(__dirname,'..','index.html'),'utf8');
function fixture(){
 const nodes=new Map();function node(id){if(!nodes.has(id))nodes.set(id,{dataset:{},value:'',innerHTML:'',textContent:'',hidden:false});return nodes.get(id);}
 class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-30T09:00:00+08:00']));}}
 const c=vm.createContext({Date:Clock,document:{getElementById:node},KH_SELF_MAX_DAYS:90,khSelfPickerOpen:true,khSelfOption:'Outstation',khSelfCutiMc:null,kehadiranLoaded:true,
  escapeHtml:s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
  fmtTarikhMalay:key=>key,fmtKey:d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),
  getKhObservedHoliday:key=>key==='2026-11-02'?'Cuti Sabah':'',getMyPergerakan:()=>[],getActivePergerakan:events=>events[0]||null
 });
 const start=html.indexOf('function getSelfDays(){'),end=html.indexOf('function updateSelfStatusDetails(){',start);assert(start>0&&end>start);vm.runInContext(html.slice(start,end),c);
 node('kh-self-days').value='3';node('kh-self-tajuk').value='Lawatan';node('kh-self-lokasi').value='Sabah';return {c,node};
}
process.env.TZ='Asia/Kuala_Lumpur';
test('review shows the actual working-date range across weekends and confirmed holidays',()=>{
 const f=fixture();f.c.renderSelfStatusReview();const out=f.node('khSelfReview');assert.equal(out.hidden,false);assert.match(out.innerHTML,/2026-10-30 hingga 2026-11-04/);assert.match(out.innerHTML,/3 hari bekerja/);assert.match(out.innerHTML,/Outstation/);
 assert.deepEqual(JSON.parse(JSON.stringify(f.c.getSelfWorkingDates(3))),['2026-10-30','2026-11-03','2026-11-04']);
});
test('fractional days and missing required fields cannot produce a valid save review',()=>{
 const f=fixture();f.node('kh-self-days').value='1.5';f.c.renderSelfStatusReview();assert.equal(f.c.isSelfStatusFormValid(),false);assert.equal(f.node('khSelfReview').hidden,true);assert.match(f.node('khSelfFormHint').textContent,/hari penuh/);
 f.node('kh-self-days').value='1';f.node('kh-self-lokasi').value=' ';f.c.renderSelfStatusReview();assert.equal(f.c.isSelfStatusFormValid(),false);assert.match(f.node('khSelfFormHint').textContent,/tajuk dan lokasi/);
 f.c.khSelfOption='cutimc';f.c.renderSelfStatusReview();assert.match(f.node('khSelfFormHint').textContent,/Pilih Cuti atau MC/);f.c.khSelfCutiMc='MC';f.c.renderSelfStatusReview();assert.equal(f.node('khSelfReview').hidden,false);
});
test('review escapes staff-entered details and hides trip details for leave',()=>{
 const f=fixture();f.node('kh-self-tajuk').value='<img src=x onerror=alert(1)>';f.node('kh-self-remark').value='A & B';f.c.renderSelfStatusReview();const out=f.node('khSelfReview').innerHTML;assert(!out.includes('<img'));assert(out.includes('&lt;img'));assert(out.includes('A &amp; B'));
 f.c.khSelfOption='cutimc';f.c.khSelfCutiMc='Cuti';f.c.renderSelfStatusReview();assert(!f.node('khSelfReview').innerHTML.includes('&lt;img'));
 f.c.khSelfPickerOpen=false;f.c.renderSelfStatusReview();assert.equal(f.node('khSelfReview').hidden,true);
});
test('staff status distinguishes not started, working, movement, full-day status and completed attendance',()=>{
 const f=fixture();const status=()=>f.node('khSelfStatus').innerHTML;
 f.c.renderSelfAttendanceStatus(null);assert.match(status(),/Belum daftar masuk/);
 f.c.renderSelfAttendanceStatus({status:'Hadir',masuk:'08:00'});assert.match(status(),/Sedang bertugas/);
 f.c.getMyPergerakan=()=>[{jenis:'OUTSTATION'}];f.c.renderSelfAttendanceStatus({status:'Hadir',masuk:'08:00'});assert.match(status(),/Keluar bertugas/);
 f.c.renderSelfAttendanceStatus({status:'Outstation'});assert.match(status(),/Status hari ini telah direkodkan/);
 f.c.renderSelfAttendanceStatus({status:'Hadir',masuk:'08:00',keluar:'17:00'});assert.match(status(),/Selesai/);
});
