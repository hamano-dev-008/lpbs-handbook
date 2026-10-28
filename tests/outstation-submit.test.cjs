const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const html = fs.readFileSync(process.env.PADIAPP_TEST_HTML || require('node:path').join(__dirname,'..','index.html'),'utf8');
function source(a,b){ const start=html.indexOf(a), end=html.indexOf(b,start); assert(start>=0 && end>start); return html.slice(start,end); }
function fixture(){
  const nodes=new Map(), writes=[], errors=[], reads=[];
  function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,classList:{contains:()=>false},querySelector:()=>null});return nodes.get(id);}
  const c=vm.createContext({console:{error:(...e)=>errors.push(e)},setTimeout:fn=>fn(),
    document:{getElementById:node},sessionStorage:{getItem:()=>null},accessToken:'test',currentUser:{email:'staff@example.test'},
    kehadiranRecords:[],kehadiranLoaded:false,kehadiranLoadFailed:false,kehadiranLoadError:null,
    KEHADIRAN_SHEET_ID:'test',KEHADIRAN_SHEET_RANGE:'Kehadiran!A2:H',
    loadKhHolidayApprovals:async()=>{},loadPergerakanFromSheet:async()=>true,
    khHolidayApprovalError:'',khHolidayApprovalsLoaded:true,isKhHolidayEditor:()=>false,
    renderKehadiranTable:()=>{},renderMyKehadiranRecord:()=>{},refreshUtama:()=>{},khEditorPage:'menu',
    normalizeTimeString:v=>v||'',calcHours:()=>null,
    apiFetch:async(url,opts)=>{reads.push({url,opts});return {ok:true,json:async()=>({values:[]})};},
    handleAuthExpired:()=>{},handleAttendanceAuthError:(status)=>{node('khSelfNote').textContent='auth '+status;},
    khSelfWriting:false,isSelfStatusFormValid:()=>true,khSelfOption:'Outstation',getSelfDays:()=>1,
    getSelfWorkingDates:()=>['2026-10-28'],getSelfCheckinName:()=> 'Test Staff',khSelfPickerOpen:true,
    resetSelfStatusForm:()=>{},renderSelfCheckinCard:()=>{},applySelfCheckinLock:()=>{},KH_SELF_UNVERIFIED_MSG:'unverified',
    appendKehadiranRows:async rows=>{writes.push(rows);c.apiFetch=async()=>({ok:true,json:async()=>({values:rows})});return {ok:true};}
  });
  node('kh-self-tajuk').value='Lawatan';node('kh-self-lokasi').value='Sabah';
  vm.runInContext(source('async function readKehadiranSnapshot(', '// ============================================================'),c);
  vm.runInContext(source('async function selfSubmitStatus(){','async function selfDaftarKeluar(){'),c);
  return {c,node,writes,errors,reads};
}
test('Outstation saves even when an unrelated attendance display throws',async()=>{
  const f=fixture();f.c.renderKehadiranTable=()=>{throw Error('display failure')};
  await f.c.selfSubmitStatus();
  assert.equal(f.writes.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.writes[0])),[['2026-10-28','Test Staff','','','Outstation','','Sabah','Lawatan']]);
  assert.match(f.node('khSelfNote').textContent,/Direkodkan/);assert.equal(f.c.kehadiranLoadFailed,false);
  assert.equal(f.c.khSelfWriting,false);assert.equal(f.errors.length,2);
});
test('transient read failures retry once using fresh uncached data',async()=>{
  for(const status of [429,503,'network']){
    const f=fixture();let count=0;
    f.c.apiFetch=async(url,opts)=>{assert.equal(opts.cache,'no-store');count++;if(count===1){if(status==='network')throw Error('offline');return {ok:false,status,json:async()=>({})};}return {ok:true,json:async()=>({values:[]})};};
    assert.equal(await f.c.loadKehadiranFromSheet(),true);assert.equal(count,2);
  }
});
test('failed reads never append cached records and retain Outstation form values',async()=>{
  for(const status of [403,503,'network']){
    const f=fixture();let count=0;
    f.c.apiFetch=async()=>{count++;if(status==='network')throw Error('offline');return {ok:false,status,json:async()=>({})};};
    await f.c.selfSubmitStatus();assert.equal(f.writes.length,0);assert.equal(count,status===403?1:2);
    assert.equal(f.node('kh-self-tajuk').value,'Lawatan');assert.equal(f.node('kh-self-lokasi').value,'Sabah');
    assert.equal(f.c.khSelfPickerOpen,true);assert.equal(f.c.khSelfWriting,false);
    assert.match(f.node('khSelfNote').textContent,status===403?/auth 403/:status===503?/Google sibuk/:/Sambungan ke Google/);
  }
});
test('existing staff date is skipped before appending',async()=>{
  const f=fixture();f.c.apiFetch=async()=>({ok:true,json:async()=>({values:[['2026-10-28','Test Staff','','','Outstation']]})});
  await f.c.selfSubmitStatus();assert.equal(f.writes.length,0);assert.match(f.node('khSelfNote').textContent,/sudah ada rekod/);
});
test('working dates are computed after holiday refresh; unavailable holidays block saving',async()=>{
  const f=fixture();let refreshed=false;f.c.loadKhHolidayApprovals=async()=>{refreshed=true};
  f.c.getSelfWorkingDates=()=>{assert(refreshed);return ['2026-10-29']};await f.c.selfSubmitStatus();assert.equal(f.writes[0][0][0],'2026-10-29');
  const bad=fixture();bad.c.khHolidayApprovalError='offline';await bad.c.selfSubmitStatus();assert.equal(bad.writes.length,0);assert.match(bad.node('khSelfNote').textContent,/Cuti umum/);
});
test('account change during refresh prevents writing for the previous user',async()=>{
  const f=fixture();f.c.loadKhHolidayApprovals=async()=>{f.c.currentUser={email:'other@example.test'}};
  await f.c.selfSubmitStatus();assert.equal(f.writes.length,0);assert.match(f.node('khSelfNote').textContent,/Akaun telah berubah/);
});
test('a refreshed holiday calendar cannot silently change the dates staff reviewed',async()=>{
  const f=fixture();f.node('khSelfReview').dataset={dates:JSON.stringify(['2026-10-28'])};
  f.c.getSelfWorkingDates=()=>['2026-10-29'];await f.c.selfSubmitStatus();
  assert.equal(f.writes.length,0);assert.match(f.node('khSelfNote').textContent,/Tarikh berubah/);
  assert.equal(f.node('kh-self-tajuk').value,'Lawatan');assert.equal(f.c.khSelfPickerOpen,true);
});
