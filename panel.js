'use strict';
const el = id => document.getElementById(id);
const set = (id, value) => { el(id).textContent = value; };
const int = new Intl.NumberFormat('zh-CN');
const ftime = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const hour = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const n = x => Number.isFinite(x) ? int.format(x) : '—';
const t = x => Number.isFinite(x) && x > 0 ? ftime.format(x*1000).replaceAll('/','-') : '—';
const hh = x => hour.format(x*1000);
const bytes = x => {
  if(!Number.isFinite(x)) return '—';
  for(const [scale,unit] of [[1e12,'TB'],[1e9,'GB'],[1e6,'MB'],[1e3,'KB']]) {
    if(x>=scale) return `${(x/scale).toFixed(2)} ${unit}`;
  }
  return `${n(Math.round(x))} B`;
};
const publicView = document.body.dataset.view === 'public';
const previewCount = b => b.complete.count+b.partial.count;
const previewBytes = b => b.complete.bytes+b.partial.bytes;
const subset = (o, keys) => keys.reduce((a,k) => a+(o?.[k]||0),0);
const maxHours = 24;
const presets = [...el('range-controls').querySelectorAll('button[data-hours]')];
const customHours = el('range-input');
const parseHours = value => /^(?:[1-9]|1[0-9]|2[0-4])$/.test(value) ? Number(value) : null;
let requestedHours = parseHours(new URL(location.href).searchParams.get('hours')) ?? 1;
let sample = null, source = '', chart = 'official', selected = 23, pending = false, timer = null;
const hasRanges = d => Array.isArray(d?.ranges) && d.ranges.length===maxHours &&
  Array.isArray(d.aligned_hours) && d.aligned_hours.length===maxHours;

function chooseHours(hours) {
  if(!sample || !Number.isInteger(hours) || hours<1 || hours>maxHours) return;
  requestedHours=hours;
  customHours.value=String(hours);
  const url=new URL(location.href);
  url.searchParams.set('hours',String(hours));
  history.replaceState(null,'',url);
  selected=maxHours-1;
  renderRange();
  plot();
}

function coverage(window, channel) {
  if(window.coverage) return window.coverage[channel]===true;
  if(publicView) return false;
  return (channel==='official'?['official']:['role','site']).every(name => {
    const o = sample.logs[name];
    return o?.readable && (!o.tail_cut || o.earliest<=window.start);
  });
}
function aggregateLegacyHours(rows) {
  // Old snapshots contain only whole hours. There are no UIDs in them, so
  // they can show gross hourly totals but cannot perform cross-hour dedup.
  const window={start:rows[0].start, end:rows.at(-1).end, coverage:{}};
  for(const channel of ['official','complete','partial']) {
    const keys=channel==='official'?['count','bytes','mesh']:['count','bytes'];
    window[channel]=Object.fromEntries(keys.map(k=>[k,rows.reduce((sum,row)=>sum+row[channel][k],0)]));
  }
  for(const channel of ['official','preview']) window.coverage[channel]=rows.every(h=>coverage(h,channel));
  return window;
}

function plot() {
  if (!sample) return;
  const aligned=hasRanges(sample);
  const rows=aligned?sample.aligned_hours:sample.hours; const box=el('plot'); const axis=el('axis');
  const chosen=requestedHours;
  set('chart-subtitle',`每柱 1 小时 · 浅蓝底标记所选的 ${chosen} 小时`);
  const official=chart==='official';
  const count = h => official?h.official.count:previewCount(h);
  const peak=Math.max(1,...rows.filter(h=>coverage(h,chart)).map(count));
  const bars=rows.map((h,i) => {
    const b=document.createElement('button'); b.type='button'; b.className='bar';
    b.setAttribute('aria-pressed',i===selected?'true':'false');
    if(i>=rows.length-chosen) b.classList.add('in-range');
    const add=(cls,v)=>{const e=document.createElement('i');e.className=cls;e.style.setProperty('--h',`${100*v/peak}%`);e.setAttribute('aria-hidden','true');b.append(e);};
    const ok=coverage(h,chart);
    if(!ok) add('missing',peak*.085);
    else if(official) add('arch',h.official.count);
    else {add('pass',h.complete.count); add('part',h.partial.count);}
    const detail=ok ? (official ? `官方 ${n(h.official.count)} 个 · ${bytes(h.official.bytes)}` : `抓取 ${n(previewCount(h))} 个 · 完整 ${n(h.complete.count)} · 部分 ${n(h.partial.count)}`) : '日志覆盖不全';
    const label=`${t(h.start)}–${hh(h.end)} ｜ ${detail}`;
    b.title=label;
    b.setAttribute('aria-label',label);
    b.addEventListener('click',()=>{
      selected=i; for (const q of box.children) q.setAttribute('aria-pressed',q===b?'true':'false');
      set('chart-detail',description(h));
    });
    return b;
  });
  function description(h) {
    const detail=!coverage(h,chart)?'日志覆盖不全，不能按零产出解读。':official
      ? `归档 ${n(h.official.count)} 个 · ${bytes(h.official.bytes)}/小时 · 其中可识别 Mesh ${n(h.official.mesh)} 个`
      : `抓取 ${n(previewCount(h))} 个 · 完整 ${n(h.complete.count)} · 部分 ${n(h.partial.count)} · ${bytes(previewBytes(h))}/小时`;
    const suffix=coverage(h,chart)&&h.unverified?' · 有待核验回执':'';
    return `${t(h.start)}–${hh(h.end)}  ${detail}${suffix}`;
  }
  box.replaceChildren(...bars);
  el('legend').replaceChildren(...(official ? [['arch','已落盘归档']] : [['pass','完整'],['part','部分']]).map(([cls,text])=>{
    const k=document.createElement('span'); const swatch=document.createElement('i'); swatch.className=cls;
    k.append(swatch,text); return k;
  }));
  axis.replaceChildren(...[0,4,8,12,16,20,23].filter(i=>rows[i]).map(i=>{const a=document.createElement('span');a.textContent=hh(rows[i].start);return a;}));
  if(rows[selected]) set('chart-detail',description(rows[selected]));
  el('official-chart').setAttribute('aria-pressed',String(official));
  el('preview-chart').setAttribute('aria-pressed',String(!official));
}

function renderRange() {
  const d=sample, has=hasRanges(d), hours=requestedHours;
  const w=has?d.ranges[hours-1]:aggregateLegacyHours(d.hours.slice(-hours));
  const rangeText=`近 ${hours} 小时`;
  for(const b of presets) {
    const h=Number(b.dataset.hours);
    b.setAttribute('aria-pressed',String(h===hours));
  }
  if(document.activeElement!==customHours) customHours.value=String(hours);
  set('range-window',`${t(w.start)} 至 ${t(w.end)}（北京时间）`);
  set('range-mode',has?'':'按已结束的整点小时加总');
  set('capture-count-rule',has
    ?'抓取总数 = 完整 + 部分。同一统计窗口内，同一模型如果既有部分产物又有完整产物，只归到完整。'
    :'抓取总数 = 完整 + 部分。当前快照按整点小时相加，跨小时出现的同一模型可能重复计入。');
  set('official-title',`官方归档 · ${rangeText}`);
  set('preview-title',`抓取 · ${rangeText}`);
  set('storage-title',`合计落盘 · ${rangeText}`);
  const officialBytes=w.official.bytes, capturedBytes=previewBytes(w);
  const average=hours>1?'平均 ':'';
  set('official-num',n(w.official.count));
  set('official-detail',`${average}${bytes(officialBytes/hours)}/小时 · 可识别 Mesh ${n(w.official.mesh)} 个`);
  set('preview-num',n(previewCount(w)));
  set('preview-detail',`完整 ${n(w.complete.count)} · 部分 ${n(w.partial.count)}`);
  set('preview-speed',`${average}${bytes(capturedBytes/hours)}/小时`);
  set('storage-num',bytes(officialBytes+capturedBytes));
  set('storage-detail',`官方 ${bytes(officialBytes)} · 抓取 ${bytes(capturedBytes)}`);
  const notes=[];
  if(!coverage(w,'official')||!coverage(w,'preview')) notes.push('所选时段有日志覆盖不足，当前数量和落盘大小仅为已核验值。');
  const missed=has?w.unverified:0;
  if(missed) notes.push(`所选时段有 ${n(missed)} 条回执未能核验落盘，未计入。`);
  el('range-note').hidden=!notes.length;
  set('range-note',notes.join(' '));
}

function render() {
  const d=sample, w=d.rolling, c=d.cumulative, kpi=d.pool||{}, stat=kpi.statuses||{};
  const now=Date.now()/1000, outdated= now-d.generated_at>4500;
  const j=d.job; const jobText={running:'运行中',inactive:'上次作业已结束',multiple:'多个作业，无法归因',unknown:'运行状态未知'};
  el('job').className='badge '+(outdated||j.state!=='running'?'warn':'ok');
  set('view-label',publicView?'公开面板 · 只读':'本地面板 · 只读');
  set('job',`${outdated?'上次记录 · ':''}${jobText[j.state]||'未知'}${!publicView&&j.job_id?` · #${j.job_id}`:''}`);
  set('updated',`采样：${t(d.generated_at)} 北京时间`);
  set('next',`下一整点：${t(d.next_hour)} · 可能延迟发布`);
  const notes=[];
  if(outdated) notes.push('快照已超过 75 分钟，以下是上次记录。');
  if(source==='cached') notes.push('本机暂时未连通集群，显示缓存。');
  if(c && (publicView?d.cumulative_lower_bound:Object.values(d.logs).some(s=>!s.run_covered))) notes.push('本次作业早段日志覆盖不全，累计是下限。');
  if(c&&subset(d.receipt_skips,['manifest','files','sample_limit'])) notes.push('累计不包含未能核验的回执。');
  el('warning').hidden=!notes.length;
  set('warning',notes.join(' '));
  el('content').hidden=false;
  renderRange();
  set('total-num',n(c?.mesh_unique));
  set('total-detail',c?`自 ${t(c.start)} · 累计官方归档 ${n(c.official.count)} / 抓取 ${n(previewCount(c))} 个`:'暂不能定位唯一生产作业');
  const showPool=publicView?Boolean(d.pool):Boolean(kpi.observed&&kpi.total!=null);
  const global429=publicView?kpi.global_429_active:Boolean(kpi.global_429_until);
  set('cooldown-num',showPool ? `${n(stat.local429||0)} / ${n(kpi.total)}` : '—');
  set('cooldown-detail',showPool ? `${kpi.fresh&&!outdated?'采样时':'上次记录'}：${global429?'全池 429 等待中':'未触发全池 429 等待'}` : '没有账号池快照');
  set('pool-observed',showPool ? `${publicView?'整点汇总':`采样于 ${t(kpi.observed)}`}${kpi.fresh&&!outdated?'':' · 非实时'}` : '暂无账号状态');
  set('local-429',kpi.next_local ? (kpi.last_local!==kpi.next_local?`${t(kpi.next_local)} ～ ${t(kpi.last_local)}`:t(kpi.next_local)) : showPool?'无':'—');
  set('provider-429',showPool?`${n(kpi.provider_accounts)} 个`:'—');
  set('global-429',global429?(publicView?'等待中':t(kpi.global_429_until)):kpi.global_other_until?'无；另有非 429 等待至 '+t(kpi.global_other_until):showPool?'无':'—');
  set('pool-status',showPool?`${n(stat.ready||0)} / ${n(stat.leased||0)} / ${n(stat.disabled||0)}${stat.spacing?` · 节流等待 ${n(stat.spacing)}`:''}`:'—');
  const http=publicView?d.http:d.diagnostics.http;
  const as=http.archive?.rate_429||0, ars=Object.values(http).reduce((a,v)=>a+v.responses,0), oth=Object.entries(http).filter(([key])=>key!=='archive').reduce((a,[,v])=>a+v.rate_429,0);
  set('recent-429',coverage(w,'official')?`${n(as+oth)} / ${n(ars)} 次响应 · API ${n(oth)} / CDN ${n(as)}`:'— 日志覆盖不全');
  if(!publicView) renderPrivate(d, d.queue, http, outdated);
  plot();
}

function renderPrivate(d, q, http, outdated) {
  const ww=q.official.workers||{}; const idle=subset(ww,['waiting_for_candidates']); const acc=subset(ww,['waiting_for_accounts','blocked_auth','cooldown']);
  set('official-work',q.official.fresh&&!outdated?`候选可领 ${n(q.official.ready)} · ${n(q.official.slots)} 槽中 ${n(idle)} 槽等候选、${n(acc)} 槽等账号；传输中 ${n(ww.downloading||0)} 槽`:'当前作业的槽位信息不可用');
  const a=d.diagnostics.archive_issues;
  set('official-issues',`网络 / 超时 ${n(subset(a,['network','tls','timeout']))} 次；归档路径校验 ${n(subset(a,['zip_unsafe_member','zip_duplicate_member']))} 次。`);
  const api=http.model_download?.successful_header_seconds;
  set('official-latency',api?`官方下载入口响应（不含传输）：中位 ${api.p50} 秒 · P95 ${api.p95} 秒。`:'');
  const ps=[q.role_preview,q.site_preview].filter(s=>s.fresh&&!outdated); const wait=ps.map(s=>Math.max(s.transport_pause_until||0,s.retry_after||0)).filter(x=>x>d.generated_at);
  set('preview-work',ps.length?`处理中 ${n(ps.reduce((a,s)=>a+(s.active||0),0))} / ${n(q.role_preview.slots ?? q.site_preview.slots)} 槽 · 待处理 ${n(ps.reduce((a,s)=>a+(s.queued||0),0))} 条${wait.length?` · 有退避，最迟 ${t(Math.max(...wait))}`:''}`:'当前作业的预览状态不可用');
  const pr=d.diagnostics.preview;
  const network=subset(pr,['failed:timeout','failed:tls','failed:network','retry:timeout','retry:tls','retry:network']);
  set('preview-issues',`网络 / TLS / 超时 ${n(network)} 次失败或重试；触发传输退避 ${n(pr.transport_wait_started||0)} 次。`);
  set('preview-quality',`Partial 事件：材质待复核 ${n(pr['partial:material_review']||0)} 次，底色纹理未全绑定 ${n(subset(pr,['partial:mixed_base_color','partial:no_bound_base_color_texture']))} 次。`);
}

async function load() {
  if(pending) return;
  pending=true; clearTimeout(timer); el('reload').disabled=true;
  let success=false;
  try {
    const url=new URL('./snapshot.json',location.href);
    // Revalidation alone may still return a previous deploy at the CDN.
    if(publicView) url.searchParams.set('v',String(Math.floor(Date.now()/30000)));
    const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(!r.ok) throw new Error('not available');
    const o=await r.json();
    if(o.schema!==1||publicView!==(o.public===true)||!Array.isArray(o.hours)||o.hours.length!==maxHours||!o.rolling) throw new Error('invalid snapshot');
    sample=o; source=r.headers.get('X-Panel-Source'); render(); success=true;
  } catch (_) {
    el('warning').hidden=false;
    set('warning',sample?'暂时读不到新快照，以下保留上次读到的数据。':'尚未读到快照。请稍后再试。');
  } finally {
    pending=false; el('reload').disabled=false;
    const s=Date.now()/1000, due=success&&sample?s<sample.next_hour+20?(sample.next_hour+20-s):60:60;
    timer=setTimeout(load,Math.max(30,Math.min(due,3600))*1000);
  }
}
for(const name of ['official','preview']) el(name+'-chart').addEventListener('click',()=>{chart=name;plot();});
for(const b of presets) b.addEventListener('click',()=>chooseHours(parseHours(b.dataset.hours)));
el('range-form').addEventListener('submit',event=>{
  event.preventDefault();
  chooseHours(customHours.valueAsNumber);
});
el('reload').addEventListener('click',load);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(!sample||Date.now()/1000>sample.next_hour+20)) load();});
load();
