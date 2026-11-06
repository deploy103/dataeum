// TypeScript source. CSV 해석과 검증은 C++ API에서 수행하고 이 파일은 UI만 담당합니다.
const $ = (s: string): any => document.querySelector(s);
declare const XLSX: any;
const state = { headers: [], rows: [], profiles: [], fileName: '', charts: [] };

const sampleCSV = `날짜,채널,캠페인,노출수,클릭수,광고비,전환수
2026-06-01,검색,여름 프로모션,12500,640,890000,54
2026-06-02,검색,여름 프로모션,13200,701,940000,61
2026-06-03,소셜,브랜드 인지도,9800,510,720000,38
2026-06-04,디스플레이,리타겟팅,15400,430,650000,47
2026-06-05,검색,신규 고객,14100,780,1080000,72
2026-06-06,소셜,여름 프로모션,18600,920,1250000,89
2026-06-07,디스플레이,브랜드 인지도,11200,340,570000,31
2026-06-08,검색,리타겟팅,16900,850,1180000,78
2026-06-09,소셜,신규 고객,20700,1080,1480000,96
2026-06-10,검색,여름 프로모션,17600,910,1320000,84
2026-06-11,디스플레이,리타겟팅,13800,390,610000,41
2026-06-12,소셜,브랜드 인지도,22100,1160,1560000,103`;

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);
  const output = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (c === '"') { if (quoted && next === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === delimiter && !quoted) { row.push(field.trim()); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && next === '\n') i++; row.push(field.trim()); if (row.some(v => v !== '')) output.push(row); row = []; field = ''; }
    else field += c;
  }
  row.push(field.trim()); if (row.some(v => v !== '')) output.push(row);
  if (output.length < 2) throw new Error('분석할 데이터 행이 부족합니다.');
  const width = Math.max(...output.map(r => r.length));
  const rawHeaders = output[0].map((h, i) => h || `column_${i + 1}`);
  const seen = {}; const headers = rawHeaders.map(h => { seen[h] = (seen[h] || 0) + 1; return seen[h] > 1 ? `${h}_${seen[h]}` : h; });
  while (headers.length < width) headers.push(`column_${headers.length + 1}`);
  return { headers, rows: output.slice(1).map(r => headers.map((_, i) => r[i] ?? '')), delimiter };
}

function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 8), options = [',', '\t', ';', '|'];
  return options.map(d => ({ d, score: lines.reduce((n, l) => n + countOutsideQuotes(l, d), 0) })).sort((a,b) => b.score-a.score)[0].d;
}
function countOutsideQuotes(line, d) { let q=false,n=0; for(const c of line){if(c==='"')q=!q;else if(c===d&&!q)n++;} return n; }
const missingTokens = new Set(['', 'null', 'n/a', 'na', 'undefined']);
function isMissing(v){ return missingTokens.has(String(v).trim().toLowerCase()); }
function numericValue(v) { const x=String(v).replace(/[₩$€,%\s,]/g,''); return x !== '' && Number.isFinite(Number(x)) ? Number(x) * (String(v).includes('%') ? .01 : 1) : null; }
function isDate(v){ return /^\d{4}[-/.]\d{1,2}([-/ .]\d{1,2})?/.test(v) && !isNaN(Date.parse(v.replace(/\./g,'-'))); }

function profileData(headers, rows) {
  return headers.map((name, idx) => {
    const values=rows.map(r=>r[idx]), valid=values.filter(v=>!isMissing(v)), nums=valid.map(numericValue).filter(v=>v!==null), dates=valid.filter(isDate), unique=new Set(valid);
    let type='범주'; if(valid.length && dates.length/valid.length>=.85) type='날짜'; else if(valid.length && nums.length/valid.length>=.9) type=(unique.size<=Math.min(12,valid.length*.25)?'순서/코드':'숫자'); else if(unique.size===2) type='불리언'; else if(unique.size/Math.max(valid.length,1)>.9) type='식별자';
    const sorted=[...nums].sort((a,b)=>a-b), q=p=>sorted[Math.floor((sorted.length-1)*p)]||0, iqr=q(.75)-q(.25), outliers=nums.filter(n=>n<q(.25)-1.5*iqr||n>q(.75)+1.5*iqr).length;
    return {name,index:idx,type,values,valid,nums,unique:unique.size,missing:values.length-valid.length,outliers,min:sorted[0],max:sorted.at(-1),avg:nums.length?nums.reduce((a,b)=>a+b,0)/nums.length:null};
  });
}

async function analyze(name: string, text: string) {
  try {
    if (new Blob([text]).size > 100 * 1024 * 1024) throw new Error('100MB 이하의 파일만 분석할 수 있습니다.');
    showToast('C++ 분석 엔진이 데이터를 확인하고 있어요.');
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {'Content-Type':'text/csv; charset=utf-8','X-Filename':encodeURIComponent(name)},
      body: text
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '분석 서버가 요청을 처리하지 못했습니다.');
    state.headers=result.headers; state.rows=result.rows; state.fileName=decodeURIComponent(result.fileName || name);
    state.profiles=result.profiles.map(p=>{
      const values=state.rows.map(r=>r[p.index]), valid=values.filter(v=>!isMissing(v));
      return {...p,values,valid,nums:valid.map(numericValue).filter(v=>v!==null)};
    });
    state.charts=buildChartOptions(); render();
    if(result.sampled) showToast(`차트는 앞 ${state.rows.length.toLocaleString()}행을 표본으로 표시합니다.`);
  } catch(e) { showToast(e.message || 'CSV를 읽지 못했습니다. 서버가 실행 중인지 확인하세요.'); }
}

function buildChartOptions(){
  const nums=state.profiles.filter(p=>p.type==='숫자'), dates=state.profiles.filter(p=>p.type==='날짜'), cats=state.profiles.filter(p=>['범주','불리언','순서/코드'].includes(p.type));
  const temporal=[...dates,...cats.filter(p=>/year|연도|년도|date|날짜|month|월/i.test(p.name)&&p.unique<=60)];
  const dimensions=cats.filter(p=>!temporal.includes(p)&&p.unique>1&&p.unique<=50);
  const out=[];
  temporal.slice(0,2).forEach(x=>out.push({type:'trend',x,label:`${x.name}별 레코드 추세`}));
  dimensions.slice(0,6).forEach(x=>out.push({type:'count',x,label:`${x.name}별 발생 건수`}));
  const important=nums.slice().sort((a,b)=>metricScore(b.name)-metricScore(a.name)).slice(0,3);
  dimensions.slice(0,3).forEach(x=>important.slice(0,2).forEach(y=>{
    out.push({type:'bar',x,y,agg:'sum',label:`${x.name}별 ${y.name} 합계`});
    out.push({type:'bar',x,y,agg:'avg',label:`${x.name}별 ${y.name} 평균`});
  }));
  important.forEach(x=>out.push({type:'hist',x,label:`${x.name} 분포`}));
  for(let i=0;i<Math.min(nums.length,4);i++) for(let j=i+1;j<Math.min(nums.length,4);j++) out.push({type:'scatter',x:nums[i],y:nums[j],label:`${nums[i].name} × ${nums[j].name}`});
  return out.slice(0,24);
}

function metricScore(name){return /loss|revenue|sales|amount|cost|피해|금액|매출|users|사용자|time|시간/i.test(name)?3:1;}
function grouped(profile, metric=null, agg='count'): any[]{
  const map: Record<string,{sum:number,count:number}>={};
  state.rows.forEach(r=>{const k=r[profile.index]||'(비어 있음)';if(!map[k])map[k]={sum:0,count:0};if(!metric){map[k].count++;return;}const v=numericValue(r[metric.index]);if(v!==null){map[k].sum+=v;map[k].count++;}});
  return Object.entries(map).map(([k,v])=>[k,agg==='avg'?(v.count?v.sum/v.count:0):agg==='sum'?v.sum:v.count]);
}
function correlation(a,b){const pairs:any[]=state.rows.map(r=>[numericValue(r[a.index]),numericValue(r[b.index])]).filter(v=>v[0]!==null&&v[1]!==null);if(pairs.length<3)return 0;const ax=pairs.reduce((s,v)=>s+v[0],0)/pairs.length,ay=pairs.reduce((s,v)=>s+v[1],0)/pairs.length;let top=0,l=0,r=0;pairs.forEach(v=>{const x=v[0]-ax,y=v[1]-ay;top+=x*y;l+=x*x;r+=y*y});return top/Math.sqrt(l*r)||0;}
function buildInsights(){
  const cats=state.profiles.filter(p=>['범주','불리언','순서/코드'].includes(p.type)&&p.unique>1&&p.unique<=50),nums=state.profiles.filter(p=>p.type==='숫자'),items=[];
  cats.slice(0,3).forEach(p=>{const data=grouped(p).sort((a,b)=>b[1]-a[1]),top=data[0],second=data[1],share=top?top[1]/state.rows.length*100:0;items.push(['상위 범주',`${p.name}: ${top?.[0]||'—'} ${format(top?.[1])}건`,`${share.toFixed(1)}%를 차지하며 2위 ${second?.[0]||'—'}와 ${format((top?.[1]||0)-(second?.[1]||0))}건 차이입니다.`]);});
  let best=null;for(let i=0;i<nums.length;i++)for(let j=i+1;j<nums.length;j++){const r=correlation(nums[i],nums[j]);if(!best||Math.abs(r)>Math.abs(best.r))best={a:nums[i],b:nums[j],r};}
  if(best)items.push(['지표 관계',`${best.a.name} ↔ ${best.b.name}`,`상관계수 ${best.r.toFixed(2)}로 ${Math.abs(best.r)>=.5?'비교적 뚜렷한':Math.abs(best.r)>=.2?'약한':'뚜렷하지 않은'} ${best.r>=0?'양의':'음의'} 관계입니다. 인과관계를 뜻하지는 않습니다.`]);
  nums.slice().sort((a,b)=>b.outliers-a.outliers).slice(0,1).forEach(p=>items.push(['수치 분포',`${p.name} 평균 ${format(p.avg)}`,`범위 ${format(p.min)}–${format(p.max)}, IQR 기준 이상값 후보 ${p.outliers}개입니다.`]));
  return items.slice(0,6);
}

function format(n){ if(n==null)return '—'; return Intl.NumberFormat('ko-KR',{notation:Math.abs(n)>=1e6?'compact':'standard',maximumFractionDigits:1}).format(n); }
function render(){
  $('#landing').hidden=true; $('.how-it-works').hidden=true; $('#workspace').hidden=false; window.scrollTo({top:0});
  $('#datasetTitle').textContent=state.fileName.replace(/\.(csv|xlsx|json)$/i,''); $('#datasetMeta').textContent=`${state.rows.length.toLocaleString()}행 · ${state.headers.length}열 · 서버 분석`;
  const total=state.rows.length*state.headers.length, missing=state.profiles.reduce((a,p)=>a+p.missing,0), duplicate=state.rows.length-new Set(state.rows.map(r=>JSON.stringify(r))).size, issues=state.profiles.filter(p=>p.missing||p.outliers).length;
  $('#statusText').textContent=`${issues ? `${issues}개 열에서 확인할 항목을 찾았어요.`:'특별한 품질 문제를 찾지 못했어요.'}`;
  const kpis=[['데이터 행',format(state.rows.length),'분석 가능한 레코드'],['데이터 열',format(state.headers.length),`${state.profiles.filter(p=>p.type==='숫자').length}개 숫자형`],['전체 결측률',`${total?(missing/total*100).toFixed(1):0}%`,`${missing.toLocaleString()}개 빈 셀`],['중복 행',format(duplicate),duplicate?'확인이 필요해요':'중복 없음']];
  $('#kpiGrid').innerHTML=kpis.map(x=>`<article class="kpi"><div class="kpi-label">${x[0]}</div><div class="kpi-value">${x[1]}</div><div class="kpi-note">${x[2]}</div></article>`).join('');
  const penalty=Math.min(45,Math.round((missing/Math.max(total,1))*100)+issues*3+duplicate*2), score=Math.max(55,100-penalty); $('#qualityScore').style.setProperty('--score',score+'%'); $('#qualityScore').innerHTML=`<span>${score}점</span>`;
  const outliers=state.profiles.reduce((a,p)=>a+p.outliers,0); $('#qualityList').innerHTML=[['완성도',missing?`${missing}개 결측값`:'빈 셀 없음',missing,'◌'],['일관성',duplicate?`${duplicate}개 중복 행`:'중복 행 없음',duplicate,'≡'],['이상값',outliers?`${outliers}개 후보`:'뚜렷한 이상값 없음',outliers,'◇'],['구조',`${state.headers.length}개 열 정상 인식`,0,'⌗']].map(x=>`<div class="quality-item ${x[2]?'warn':''}"><span class="quality-icon">${x[3]}</span><div><b>${x[0]}</b><p>${x[1]}</p></div><span>${x[2]?'확인':'좋음'}</span></div>`).join('');
  $('#columnCount').textContent=`총 ${state.headers.length}개 열`; $('#schemaBody').innerHTML=state.profiles.map(p=>`<tr><td><b>${esc(p.name)}</b></td><td><span class="type-badge">${p.type}</span></td><td>${p.unique.toLocaleString()}</td><td>${p.missing?`${(p.missing/state.rows.length*100).toFixed(1)}%`:'—'}</td><td>${esc(p.valid.slice(0,2).join(', ')||'—')}</td></tr>`).join('');
  $('#insightList').innerHTML=buildInsights().map(x=>`<article class="insight-card"><span>${esc(x[0])}</span><b>${esc(x[1])}</b><p>${esc(x[2])}</p></article>`).join('');
  $('#chartSelect').innerHTML=state.charts.map((c,i)=>`<option value="${i}">${esc(c.label)}</option>`).join(''); renderChart(0);
}

function renderChart(index){
  const c=state.charts[index]; if(!c){$('#chart').innerHTML='<p>시각화할 수 있는 열이 없습니다.</p>';return;} $('#chartTitle').textContent=c.label; $('#chartReason').textContent=c.type==='trend'?'시간 흐름 집계':c.type==='bar'?'범주별 '+(c.agg==='avg'?'평균':'합계'):c.type==='scatter'?'상관관계 탐색':'분포 확인';
  $('#groupControl').style.display='none'; const W=760,H=310,m={l:52,r:22,t:20,b:52}, w=W-m.l-m.r,h=H-m.t-m.b; let body='',summary='';
  const axis=`<line x1="${m.l}" y1="${m.t+h}" x2="${W-m.r}" y2="${m.t+h}" stroke="#cfd8d2"/><line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${m.t+h}" stroke="#cfd8d2"/>`;
  if(c.type==='bar'||c.type==='count'){
    const data=grouped(c.x,c.type==='count'?null:c.y,c.agg).sort((a,b)=>b[1]-a[1]).slice(0,10), max=Math.max(...data.map(d=>d[1]),1), bw=w/Math.max(data.length,1)*.65;
    body=data.map((d,i)=>{const x=m.l+i*w/data.length+(w/data.length-bw)/2,bh=d[1]/max*h,y=m.t+h-bh;return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="5" fill="#52aa88"><title>${esc(d[0])}: ${format(d[1])}</title></rect><text x="${x+bw/2}" y="${m.t+h+18}" text-anchor="middle">${esc(d[0].slice(0,8))}</text><text x="${x+bw/2}" y="${y-7}" text-anchor="middle">${format(d[1])}</text>`}).join(''); const gap=data[1]?((data[0][1]-data[1][1])/Math.max(data[1][1],1)*100):0;summary=`${data[0]?.[0]||'—'}이(가) ${format(data[0]?.[1])}로 가장 높고, 2위보다 ${gap.toFixed(1)}% 높습니다. 상위 ${data.length}개를 표시했습니다.`;
  } else if(c.type==='trend'){
    const data=grouped(c.x).sort((a,b)=>String(a[0]).localeCompare(String(b[0]),undefined,{numeric:true})), ys=data.map(d=>d[1]),ymin=Math.min(...ys),ymax=Math.max(...ys),sx=i=>m.l+i/Math.max(data.length-1,1)*w,sy=y=>m.t+h-(y-ymin)/Math.max(ymax-ymin,1)*h,points=data.map((d,i)=>`${sx(i)},${sy(d[1])}`).join(' ');body=`<polyline points="${points}" fill="none" stroke="#238063" stroke-width="3" stroke-linejoin="round"/>`+data.map((d,i)=>`<circle cx="${sx(i)}" cy="${sy(d[1])}" r="4" fill="#fff" stroke="#238063" stroke-width="2"><title>${esc(d[0])}: ${format(d[1])}건</title></circle><text x="${sx(i)}" y="${m.t+h+18}" text-anchor="middle">${esc(d[0])}</text>`).join('');const first=data[0]?.[1],last=data.at(-1)?.[1],peak=data.slice().sort((a,b)=>b[1]-a[1])[0];summary=`${peak?.[0]}에 ${format(peak?.[1])}건으로 가장 많았습니다. 처음 대비 마지막은 ${first?`${((last-first)/first*100).toFixed(1)}% ${last>=first?'증가':'감소'}`:'비교 불가'}해 단순 증가 여부를 함께 확인할 수 있습니다.`;
  } else if(c.type==='hist'){
    const vals=c.x.nums,bins=8,min=Math.min(...vals),max=Math.max(...vals),step=(max-min)/bins||1,count=Array(bins).fill(0);vals.forEach(v=>count[Math.min(bins-1,Math.floor((v-min)/step))]++);const peak=Math.max(...count,1),bw=w/bins*.72;body=count.map((n,i)=>{const x=m.l+i*w/bins+(w/bins-bw)/2,bh=n/peak*h,y=m.t+h-bh;return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="4" fill="#70b99d"><title>${format(min+i*step)}–${format(min+(i+1)*step)}: ${n}개</title></rect><text x="${x+bw/2}" y="${m.t+h+18}" text-anchor="middle">${format(min+i*step)}</text>`}).join('');summary=`평균은 ${format(c.x.avg)}, 범위는 ${format(c.x.min)}–${format(c.x.max)}입니다. IQR 기준 이상값 후보는 ${c.x.outliers}개예요.`;
  } else {
    const data=state.rows.map(r=>[numericValue(r[c.x.index]),numericValue(r[c.y.index])]).filter(d=>d[0]!=null&&d[1]!=null),xs=data.map(d=>d[0]),ys=data.map(d=>d[1]),xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys),sx=x=>m.l+(x-xmin)/Math.max(xmax-xmin,1)*w,sy=y=>m.t+h-(y-ymin)/Math.max(ymax-ymin,1)*h;body=data.map(d=>`<circle cx="${sx(d[0])}" cy="${sy(d[1])}" r="4" fill="#238063" fill-opacity=".55"><title>${format(d[0])}, ${format(d[1])}</title></circle>`).join('');const r=correlation(c.x,c.y);summary=`${data.length}개 관측값의 피어슨 상관계수는 ${r.toFixed(2)}입니다. ${Math.abs(r)>=.5?'함께 변하는 경향이 비교적 뚜렷합니다.':Math.abs(r)>=.2?'약한 관계가 보입니다.':'선형 관계는 뚜렷하지 않습니다.'} 상관관계가 인과관계를 의미하지는 않습니다.`;
  }
  $('#chart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${axis}${body}</svg>`; $('#chart').setAttribute('aria-label',c.label+'. '+summary); $('#chartSummary').textContent=summary;
}

function preview(){ const shown=state.rows.slice(0,100), head=`<table><thead><tr>${state.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`, rows=shown.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('');$('#previewTable').innerHTML=head+rows+'</tbody></table>';$('#dataDialog').showModal(); }
function exportReport(){ window.print(); showToast('인쇄 창에서 PDF로 저장할 수 있어요.'); }
function esc(v){ const d=document.createElement('div');d.textContent=String(v);return d.innerHTML; }
let toastTimer: ReturnType<typeof setTimeout>;
function showToast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2800)}

$('#dropzone').addEventListener('click',()=>$('#fileInput').click()); $('#dropzone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#fileInput').click()}});
$('#fileInput').addEventListener('change',e=>loadFile(e.target.files[0]));
['dragenter','dragover'].forEach(x=>$('#dropzone').addEventListener(x,e=>{e.preventDefault();$('#dropzone').classList.add('drag')})); ['dragleave','drop'].forEach(x=>$('#dropzone').addEventListener(x,e=>{e.preventDefault();$('#dropzone').classList.remove('drag')})); $('#dropzone').addEventListener('drop',e=>loadFile(e.dataTransfer.files[0]));
function csvCell(value){const s=value==null?'':value instanceof Date?value.toISOString():typeof value==='object'?JSON.stringify(value):String(value);return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function tableToCSV(table){return table.map(row=>row.map(csvCell).join(',')).join('\n');}
function validateTable(table, source){
  if(!Array.isArray(table)||table.length<2)throw new Error(`${source}에 헤더와 데이터 행이 필요합니다.`);
  if(table.length>500001)throw new Error('데이터 행은 50만 개까지 분석할 수 있습니다.');
  let width=0;
  for(let i=0;i<Math.min(table.length,2000);i++){
    if(Array.isArray(table[i]))width=Math.max(width,table[i].length);
  }
  if(width<2||width>500)throw new Error('2~500개 열로 구성된 표만 분석할 수 있습니다.');
  const header=(table[0]||[]).slice(0,width).map(v=>String(v??'').trim()),filled=header.filter(Boolean);
  if(filled.length<2||filled.length/width<.7)throw new Error('첫 행에서 명확한 열 이름을 찾지 못했습니다. 표 형태의 파일인지 확인하세요.');
  if(new Set(filled).size/filled.length<.7)throw new Error('중복된 열 이름이 너무 많아 표 구조를 신뢰할 수 없습니다.');
  for(let i=2000;i<table.length;i++){
    const row=table[i];
    if(Array.isArray(row)&&row.length>width&&row.some(v=>v!==''&&v!=null)){
      throw new Error(`${i+1}행의 열 수가 앞부분의 ${width}개 열보다 많습니다. 열 구성을 확인하세요.`);
    }
  }
  const dataRows=table.slice(1).filter(r=>Array.isArray(r)&&r.some(v=>v!==''&&v!=null));
  if(!dataRows.length)throw new Error('분석할 데이터 행이 없습니다.');
  const populated=dataRows.slice(0,1000).filter(r=>r.filter(v=>v!==''&&v!=null).length>=Math.max(1,Math.floor(filled.length*.3))).length;
  if(populated/Math.min(dataRows.length,1000)<.7)throw new Error('셀 배치가 불규칙해 데이터 표로 분석하지 않았습니다.');
  return [header,...dataRows.map(r=>Array.from({length:width},(_,i)=>r[i]??''))];
}
function jsonTable(text){
  let value;try{value=JSON.parse(text)}catch{throw new Error('올바른 JSON 문법이 아닙니다.');}
  if(!Array.isArray(value)&&value&&typeof value==='object'){const arrays=Object.values(value).filter(Array.isArray).sort((a:any,b:any)=>b.length-a.length);value=arrays[0]||[value];}
  if(!Array.isArray(value)||!value.length)throw new Error('JSON에서 분석할 배열이나 객체를 찾지 못했습니다.');
  if(value.every(v=>v&&typeof v==='object'&&!Array.isArray(v))){const headers=[];value.forEach(obj=>Object.keys(obj).forEach(k=>{if(!headers.includes(k))headers.push(k)}));return [headers,...value.map(obj=>headers.map(k=>obj[k]))];}
  if(value.every(Array.isArray)){return value;}
  return [['value'],...value.map(v=>[v])];
}
async function loadFile(file){
  if(!file)return;
  if(file.size>100*1024*1024){showToast('100MB 이하 파일만 분석할 수 있습니다.');return;}
  const ext=(file.name.match(/\.([^.]+)$/)?.[1]||'').toLowerCase();
  try{
    if(ext==='csv'){analyze(file.name,await file.text());return;}
    if(ext==='json'){const table=validateTable(jsonTable(await file.text()),'JSON');analyze(file.name,tableToCSV(table));return;}
    if(ext==='xlsx'){
      const book=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true,dense:true});
      const visible=book.SheetNames.filter((n,i)=>book.Workbook?.Sheets?.[i]?.Hidden!==1);
      if(!visible.length)throw new Error('표시된 워크시트가 없습니다.');
      const sheet=book.Sheets[visible[0]];
      if((sheet['!merges']||[]).length)throw new Error('병합 셀이 포함된 문서형 Excel은 분석하지 않습니다. 병합을 해제한 표를 사용하세요.');
      const table=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false,blankrows:false});
      analyze(file.name,tableToCSV(validateTable(table,'Excel')));return;
    }
    throw new Error('CSV, XLSX, JSON 파일만 분석할 수 있습니다. XLS·XLSM은 지원하지 않습니다.');
  }catch(e){showToast(e.message||'파일 구조를 읽지 못했습니다.');}
}
document.querySelectorAll('[data-action="sample"]').forEach(b=>b.addEventListener('click',()=>analyze('마케팅_캠페인_샘플.csv',sampleCSV))); $('#chartSelect').addEventListener('change',e=>renderChart(+e.target.value)); $('#tableButton').addEventListener('click',preview);$('#closeDialog').addEventListener('click',()=>$('#dataDialog').close());$('#exportButton').addEventListener('click',exportReport);$('#backButton').addEventListener('click',()=>location.reload());$('#themeButton').addEventListener('click',()=>document.body.classList.toggle('dark'));
