/* ---------- Sisyphus: everything starts empty and fills from Google and from what the person sets up ----------
   Tasks come from Google Tasks, events from Google Calendar. Routine, habits, goals, hours per category,
   stars and streak live in the person's private Drive file (see google.js). */
const V = {
  trabajo:['Trabajo','var(--trabajo)'], universidad:['Universidad','var(--universidad)'], proyectos:['Proyectos personales','var(--proyectos)'],
  ejercicio:['Ejercicio','var(--ejercicio)'], lectura:['Lectura','var(--lectura)'], ocio:['Ocio','var(--ocio)']
};
const DAYS_FULL = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'], DAYS_1 = ['L','M','X','J','V','S','D'];
const DAY_START = 7*60;   // the Day view grid starts at 07:00

let tasks = [], inbox = [];
let routine = [];      // [{id, a:'09:00', b:'12:00', n:'Trabajo profundo', k:'trabajo', days:[0..6]}]
let HABITS = [];       // [{id, ic, n, v, types:[...]}]
let habitLog = {};     // today's sessions per habit: [{type, time}]
let habitHist = {};    // 'YYYY-MM-DD' -> {habitId: sessions}
let goals = [];        // [{id, ic, n, v, due, steps:[{s, ok}]}]
let budget = {};       // category -> weekly hours goal
let places = [];       // saved places (Día fuera)
let activity = [];     // days with something done, for the streak
let counters = {done:0, habits:0, focus:0, reviews:0, lastReview:''};
let mailDone = [];     // Gmail messages already turned into tasks or dismissed
let stars = 0, view = 'inicio', calDay = TODAY, reviewStep = 0, taskFilter = 'all', draft = null;
const S = {quotes:true, sound:false, tz2:'', profile:''};

// Phrase of the day (list in quotes.js): a new one each local day, all 150 before any repeats, in a fixed shuffled order
const quoteOrder = (() => {
  let seed = 150; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const o = phrases.map((_, i) => i);
  for(let i = o.length - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
  return o;
})();
let quoteIdx = quoteOrder[Math.floor((Date.now() - new Date().getTimezoneOffset()*6e4) / 864e5) % phrases.length];
function nextQuote(){ quoteIdx = (quoteIdx+1) % phrases.length; render(); }

/* ---------- Simple line icons (SVG, independent of fonts) ---------- */
const ICON_CHECK  = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>`;
const ICON_CHECK2 = `<svg viewBox="0 0 28 24" width="22" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12.5l4.2 4.2L16 7.5"/><path d="M12 15.7l1 1L22.5 7.5"/></svg>`;
const ICON_PLUS   = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;

/* ---------- Helpers ---------- */
const $ = id => document.getElementById(id);
const toM = s => {const [h,m]=s.split(':').map(Number);return h*60+m;};
const endM = s => toM(s) || 1440;          // a block ending at 00:00 ends at midnight
const fmt = m => `${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const nowHM = () => new Date().toTimeString().slice(0,5);
const nowMin = () => { const n = new Date(); return n.getHours()*60 + n.getMinutes(); };
const escA = s => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
const catOptions = sel => Object.entries(V).map(([k,x])=>`<option value="${k}" ${k===sel?'selected':''}>${x[0]}</option>`).join('');
const emptyCard = (msg, btn='') => `<div class="glass card empty"><p>${msg}</p>${btn}</div>`;
function toast(msg){sfx('soft');const t=$('toast');t.textContent=msg;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),2400);}

/* Routine: blocks per weekday, and which days each category has time */
const blocksOf = d => routine.filter(b=>b.days.includes(d)).sort((x,y)=>toM(x.a)-toM(y.a));
const dayBlocks = d => blocksOf(d).map(b=>[b.a,b.b,b.n,b.k]);
const catDays = v => { const ds = [...new Set(routine.filter(b=>b.k===v).flatMap(b=>b.days))].sort(); return ds.length ? ds : [0,1,2,3,4]; };
const blockHours = b => (endM(b.b) - toM(b.a)) / 60;
const SIZE_H = {S:.5, M:1.5, L:3};
function plannedByCat(){ const h = {}; routine.forEach(b=>{ h[b.k] = (h[b.k]||0) + blockHours(b)*b.days.length; }); return h; }
function bookedHours(i){
  const ev = (G.events[ymd(dateOfIdx(i))]||[]).filter(e=>!e.all).reduce((s,e)=>s + Math.max(0,(e.e-e.s)/36e5), 0);
  const tk = tasks.filter(x=>x.day===i && !x.done).reduce((s,x)=>s + (SIZE_H[x.s]||1), 0);
  return Math.round((ev+tk)*2)/2;
}
// Next free routine block for a category, used by the basic classifier when Claude is not available
function nextSlot(v){
  const nm = nowMin();
  for(let i=0;i<7;i++){ const d=(TODAY+i)%7, b=blocksOf(d).find(x=>x.k===v && (i>0 || toM(x.a)>nm));
    if(b) return `${i===0?'Hoy':DAYS_FULL[d]} · ${b.a} ${b.n}`; }
  return `${DAYS_FULL[(TODAY+1)%7]} · 09:00`;
}

/* Second time zone for the Day view (optional) */
const ZONES = [['','Ninguna'],['America/Bogota','Bogotá · Lima'],['America/Mexico_City','Ciudad de México'],['America/New_York','Nueva York · Miami'],
  ['America/Los_Angeles','Los Ángeles'],['America/Argentina/Buenos_Aires','Buenos Aires'],['Europe/Madrid','Madrid'],['Europe/London','Londres'],['UTC','UTC']];
const zone2 = () => S.tz2 || G.accounts.map(x=>x.tz).find(t=>t && t!==mainTz()) || '';
function tzShift(tz){   // minutes to add to local time to get the time in tz
  try{ const n = new Date(), p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(n).map(x=>[x.type,x.value]));
    return Math.round((Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute) - Date.UTC(n.getFullYear(),n.getMonth(),n.getDate(),n.getHours(),n.getMinutes()))/6e4); }catch(e){ return 0; }
}

/* ---------- Stars, levels and streak ---------- */
const LEVELS = ['Aprendiz','Constante','Enfocado','Estratega','Director','Maestro','Leyenda'], LEVEL_STEP = 250;
const level = () => Math.floor(stars/LEVEL_STEP) + 1;
const levelName = l => LEVELS[Math.min(l-1, LEVELS.length-1)];
const toNext = () => LEVEL_STEP - stars % LEVEL_STEP;
function markActive(){ const d = ymd(new Date()); if(!activity.includes(d)){ activity.push(d); activity = activity.slice(-400); } }
function streak(){ const d = gDay(new Date()); if(!activity.includes(ymd(d))) d.setDate(d.getDate()-1);
  let n = 0; while(activity.includes(ymd(d))){ n++; d.setDate(d.getDate()-1); } return n; }
function bestStreak(){ let best = 0, run = 0, prev = null;
  [...activity].sort().forEach(s=>{ const d = new Date(s+'T00:00'); run = prev && (d-prev)/864e5 === 1 ? run+1 : 1; best = Math.max(best, run); prev = d; });
  return best; }

/* ---------- Habits: several sessions per day (e.g. swimming + weights = 2 gym sessions) ---------- */
const weekSessions = id => DAYS_FULL.reduce((s,_,i)=>s + ((habitHist[ymd(dateOfIdx(i))]||{})[id]||0), 0);
function saveHabitDay(id){ const d = ymd(new Date()); (habitHist[d] ||= {})[id] = (habitLog[id]||[]).length; }
function habitsCard(order){
  if(!HABITS.length) return `<div style="order:${order}" class="glass card habits"><span class="eyebrow">Hábitos de hoy</span>
    <p class="date" style="margin:10px 0">Aún no tienes hábitos. Agrégalos y registra varias sesiones al día.</p><button class="btn" onclick="habitSheet()">+ Agregar hábito</button></div>`;
  return `<div style="order:${order}" class="glass card habits"><div class="row" style="justify-content:space-between"><span class="eyebrow">Hábitos de hoy</span><span class="eyebrow">sesiones</span></div>
    ${HABITS.map(h=>{ const log = habitLog[h.id]||[], c = log.length;
      return `<div class="hab" style="--c:${V[h.v][1]}"><span class="hi">${escA(h.ic)}</span>
        <div class="grow"><div>${escA(h.n)} <span class="muted" style="font-size:12px">· ${weekSessions(h.id)} esta semana</span></div>
          <div class="hs">${log.map((x,i)=>`<button class="chip-s" onclick="unlogHabit('${h.id}',${i})" aria-label="Quitar sesión">${escA(x.type)} · ${x.time} ×</button>`).join('') || '<span class="muted" style="font-size:12px">Sin sesiones hoy</span>'}</div></div>
        <button class="hcheck ${c?'on':''}" onclick="logHabit('${h.id}')" aria-label="Registrar sesión">${c===0 ? ICON_PLUS : c===1 ? ICON_CHECK : c===2 ? ICON_CHECK2 : ICON_CHECK2+`<span class="hx">${c}</span>`}</button></div>`; }).join('')}</div>`;
}
function logHabit(id){
  const h = HABITS.find(x=>x.id===id), c = (habitLog[id]||[]).length;
  if(!h.types?.length) return pickHabit(id, 'Sesión');
  openSheet(`<span class="eyebrow">${c ? `Sesión ${c+1} de hoy` : 'Primera sesión de hoy'}</span><h3>${escA(h.ic)} ${escA(h.n)}</h3>
    <div class="date" style="margin:-6px 0 12px">¿Qué hiciste?</div>
    <div class="menu">${h.types.map((t,i)=>`<button onclick="pickHabit('${id}',HABITS.find(x=>x.id==='${id}').types[${i}])">${escA(t)}</button>`).join('')}<button onclick="pickHabit('${id}','Otra')">Otra</button></div>
    <button class="btn" style="width:100%;margin-top:12px" onclick="closeSheet()">Cancelar</button>`);
}
function pickHabit(id,type){
  const h = HABITS.find(x=>x.id===id); (habitLog[id] ||= []).push({type, time:nowHM()}); saveHabitDay(id);
  counters.habits++; markActive(); closeSheet();
  const c = habitLog[id].length; reward(10, c>1 ? `${h.n}: ${c} sesiones hoy 🔥` : `${h.n}: sesión registrada`); render();
}
function unlogHabit(id,i){ habitLog[id].splice(i,1); saveHabitDay(id); counters.habits = Math.max(0, counters.habits-1); toast('Sesión quitada'); render(); }

/* ---------- Sounds: synthesized with Web Audio, no files to download ---------- */
let actx;
const N = {C5:523.25,E5:659.25,G5:783.99,A5:880,C6:1046.5,E6:1318.5,G6:1568};
const SOUNDS = {
  tick:   [[N.G6,0,.04,'triangle',.05]],
  pop:    [[N.E5,0,.08,'sine',.12],[N.A5,.05,.12,'sine',.1]],
  soft:   [[N.C6,0,.18,'sine',.08]],
  star:   [[N.E5,0,.12],[N.G5,.07,.12],[N.C6,.14,.35,'triangle',.16]],
  streak: [[N.C5,0,.14],[N.E5,.1,.14],[N.G5,.2,.14],[N.C6,.3,.2],[N.E6,.42,.2],[N.G6,.54,.6,'triangle',.18]],
  big:    [[N.G5,0,.15],[N.C6,.12,.15],[N.E6,.24,.15],[N.G6,.36,.7,'triangle',.2],[N.C5,.36,.7,'sine',.12]],
  start:  [[N.C5,0,.15],[N.G5,.12,.3]],
  pause:  [[N.G5,0,.15],[N.C5,.12,.3]],
  undo:   [[N.E5,0,.1,'sine',.1],[N.C5,.08,.16,'sine',.08]]
};
function sfx(kind){
  if(!S.sound) return;
  try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();if(actx.state==='suspended')actx.resume();}catch(e){return;}
  const t0=actx.currentTime;
  (SOUNDS[kind]||[]).forEach(([f,d,dur,type='sine',vol=.18])=>{
    const o=actx.createOscillator(),g=actx.createGain(),t=t0+d;o.type=type;o.frequency.value=f;
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g).connect(actx.destination);o.start(t);o.stop(t+dur+.05);
  });
}
function openSheet(html){sfx('pop');$('sheetBody').innerHTML=html;$('sheet').classList.add('on');$('scrim').classList.add('on');}
function closeSheet(){$('sheet').classList.remove('on');$('scrim').classList.remove('on');}
const sheetHTML = html => $('sheet').classList.contains('on') ? ($('sheetBody').innerHTML = html) : openSheet(html);

/* ---------- Navigation ---------- */
const SECTIONS = [
  ['',[['inicio','🏠','Inicio'],['enfoque','◉','Enfoque']]],
  ['Agenda',[['calendario','📅','Día'],['semana','🗓️','Semana'],['fuera','🌍','Día fuera']]],
  ['Planear',[['bandeja','📥','Bandeja'],['correo','✉️','Correos'],['objetivos','🧭','Objetivos'],['revision','✅','Revisión']]],
  ['Progreso',[['insights','📊','Insights'],['logros','🏆','Logros']]]
];
const TABS = {hoy:['inicio'],agenda:['calendario','semana','fuera'],enfoque:['enfoque'],planear:['bandeja','correo','objetivos','revision'],progreso:['insights','logros']};
const LABEL = Object.fromEntries(SECTIONS.flatMap(s=>s[1]).map(([v,,n])=>[v,n]));
const tabOf = v => Object.keys(TABS).find(k=>TABS[k].includes(v));
function go(v){sfx('tick');view=v;closeSheet();render();scrollTo(0,0);}
function renderSide(){
  $('side').innerHTML = `<div class="brand"><img class="logo" src="icon-rock.svg?v=4" alt="">Sisyphus</div>` +
    SECTIONS.map(([g,items])=>(g?`<h6>${g}</h6>`:'<div style="height:12px"></div>')+items.map(([v,i,n])=>`<a class="${view===v?'on':''}" onclick="go('${v}')"><span>${i}&nbsp; ${n}</span>${v==='bandeja'&&inbox.length?`<span class="n">${inbox.length}</span>`:''}${v==='correo'&&mailPending().length?`<span class="n">${mailPending().length}</span>`:''}</a>`).join('')).join('') +
    `<div class="foot">${gOn()?`<div class="glass level" style="padding:12px;border-radius:18px;margin-bottom:8px;gap:10px"><div class="lv" style="width:40px;height:40px;font-size:18px;border-radius:12px">${level()}</div><div><b style="font-size:13px">${levelName(level())}</b><div class="date" style="font-size:11px">${stars} ⭐ · ${streak()} 🔥</div></div></div>`:''}
    <a class="${view==='ajustes'?'on':''}" onclick="go('ajustes')"><span>⚙️&nbsp; Ajustes</span></a></div>`;
}
function taskRow(x,i){return `<div class="glass task ${x.done?'done':''}" style="--c:${V[x.v][1]}"><span class="bar"></span>
  <div class="body" onclick="taskSheet(${i})" style="cursor:pointer"><div class="t">${escA(x.t)}</div><div class="m">${x.p?'<span class="prio">● Prioritaria</span>':''}<span>${V[x.v][0]}</span><span>${escA(x.when)}</span><span>${x.s}</span>${x.mail?`<a class="lnk" href="${escA(x.mail)}" target="_blank" rel="noopener">✉️ correo</a>`:''}</div></div>
  <button class="check" onclick="toggle(${i})" aria-label="Completar">${ICON_CHECK}</button></div>`;}
// Tapping a task opens its details: mark it done or delete it (from Google Tasks and, if it has one, its calendar event)
function taskSheet(i){
  const x = tasks[i]; if(!x) return;
  openSheet(`<span class="eyebrow">${V[x.v][0]} · ${escA(x.when)}${x.p ? ' · <span class="prio">Prioritaria</span>' : ''}</span><h3>${escA(x.t)}</h3>
    ${x.eid ? '<div class="date" style="margin:-6px 0 10px">📅 Tiene un evento en tu calendario</div>' : ''}${x.mail ? `<p><a class="lnk" href="${escA(x.mail)}" target="_blank" rel="noopener">✉️ Abrir el correo original</a></p>` : ''}
    <div class="row" style="margin-top:14px;flex-wrap:wrap"><button class="btn p grow" onclick="closeSheet();toggle(${i})">${x.done ? '↺ Marcar pendiente' : '✓ Marcar hecha'}</button>
      <button class="btn danger" onclick="deleteTask(${i})">🗑 Eliminar</button><button class="btn" onclick="closeSheet()">Cerrar</button></div>`);
}
function deleteTask(i){
  const x = tasks[i]; if(!x || !confirm(x.eid ? '¿Eliminar la tarea y su evento del calendario?' : '¿Eliminar la tarea?')) return;
  tasks.splice(i, 1); closeSheet(); render(); gTaskDeleted(x);
}

/* ---------- Views ---------- */
const views = {};

// Shown until a Google account is connected: nothing personal, nothing made up
views.bienvenida = () => `<h1>Sisyphus</h1><div class="date">Tus tareas y bloques de tiempo, organizados con Claude</div>
  <div class="glass card ai"><span class="eyebrow">Para empezar</span>
    <p style="margin:8px 0 14px;font-size:15px;line-height:1.45">Conecta tu cuenta de Google. Tus tareas, tu calendario y tu progreso se quedan en tu propia cuenta: la app no guarda nada en otro lugar.</p>
    <button class="btn p" onclick="gConnect()">Conectar Google</button></div>
  <div class="glass card"><span class="eyebrow">Después</span>
    <ol class="steps-list"><li>Define tus bloques de rutina en Ajustes.</li><li>Agrega tus hábitos.</li><li>Escribe tu primera tarea abajo: Claude la ubica en el mejor bloque.</li></ol></div>`;

views.calendario = () => {
  const nums=DAYS_1.map((_,i)=>dateOfIdx(i).getDate()), gd=gDayEvents(calDay), y=m=>(m-DAY_START)*0.95, tz2=zone2(), sh=tz2?tzShift(tz2):null;
  const zone = tz2 ? ` · segunda columna: ${ZONES.find(z=>z[0]===tz2)?.[1]||tzCity(tz2)}` : '';
  let h=`<h1>Día</h1><div class="date">Tus bloques de rutina y tus eventos de Google${zone}</div>
  <div class="days">${DAYS_1.map((d,i)=>`<button class="${i===calDay?'on':''}" onclick="calDay=${i};render()">${d}<b>${nums[i]}</b></button>`).join('')}</div>${gd.top}`;
  if(!routine.length && !gd.grid) h+=emptyCard('No hay bloques ni eventos este día.', `<button class="btn" onclick="go('ajustes')">Definir mi rutina</button>`);
  h+=`<div class="grid" id="grid">`;
  for(let m=DAY_START;m<=24*60;m+=60) h+=`<div class="hr" style="top:${y(m)}px"><span>${fmt(m)}${sh!==null?`<i>${fmt((m+sh+2880)%1440)}</i>`:''}</span></div>`;
  h+=dayBlocks(calDay).map(([a,b,n,k])=>`<div class="ev" style="--c:${V[k][1]};top:${y(Math.max(toM(a),DAY_START))}px;height:${y(endM(b))-y(Math.max(toM(a),DAY_START))-3}px"><b>${escA(n)}</b><small>${a}–${b}</small></div>`).join('');
  h+=gd.grid;
  const nm=nowMin(); if(calDay===TODAY&&nm>=DAY_START) h+=`<div class="nowline" style="top:${y(nm)}px"></div>`;
  return h+`</div>`;
};

views.semana = () => {
  const nums=DAYS_1.map((_,i)=>dateOfIdx(i).getDate()), sh=d=>d.toLocaleDateString('es-ES',{day:'numeric',month:'short'}).replace('.','');
  const loads=DAYS_1.map((_,i)=>bookedHours(i)), total=loads.reduce((a,b)=>a+b,0);
  return `<h1>Semana</h1><div class="date">${sh(dateOfIdx(0))} – ${sh(dateOfIdx(6))} · ${String(total).replace('.',',')} h en eventos y tareas · arrastra tareas entre días</div>
  <div class="glass card"><div class="row"><span class="eyebrow grow">Carga por día</span><span class="date">verde ≤ 8h · naranja ≤ 10h · rojo > 10h</span></div></div>
  <div class="wk">${DAYS_1.map((d,i)=>{const l=loads[i],c=l>10?'var(--orko)':l>8?'var(--soda)':'#3cc48d';
    return `<div class="col ${i===TODAY?'today':''}" data-d="${i}" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="dropTask(event,${i})">
      <div class="hd">${d}<b>${nums[i]}</b>${gWeekCount(i)?`<i>📅 ${gWeekCount(i)}</i>`:''}</div><div class="load" style="background:${c}" title="${l} h"></div>
      ${blocksOf(i).map(b=>`<div class="blk" style="--c:${V[b.k][1]}">${escA(b.n)}</div>`).join('')}
      ${tasks.map((x,j)=>x.day===i&&!x.done?`<div class="blk t" draggable="true" ondragstart="event.dataTransfer.setData('t',${j})" style="--c:${V[x.v][1]}">${escA(x.t.split(' ').slice(0,3).join(' '))}</div>`:'').join('')}
    </div>`;}).join('')}</div>
  ${!routine.length?emptyCard('Tu semana aún no tiene bloques de rutina.', `<button class="btn" onclick="go('ajustes')">Definir mi rutina</button>`):''}`;
};
function dropTask(e,d){e.preventDefault();const x=tasks[+e.dataTransfer.getData('t')];x.day=d;x.when=d===TODAY?'Hoy':DAYS_FULL[d];render();gTaskMoved(x);}

/* ---------- Focus timer: free mode or Pomodoro, adjustable, notifies when time is up ---------- */
const FOCUS = {mode:'pomodoro', work:25, short:5, long:15, cycles:4, free:45, autoNext:false, calAlarm:true};
const FOCUS_LIMITS = {work:[5,90], short:[1,30], long:[5,45], cycles:[2,8], free:[5,180]};
let fz = {phase:'work', cycle:1, total:25*60, left:25*60, end:null, run:false, timer:null};
const PHASE = {work:['Enfoque','#F75E3F'], short:['Pausa corta','#7FA6BA'], long:['Pausa larga','#7FA6BA']};

function phaseMinutes(p){ return p==='work' ? (FOCUS.mode==='pomodoro' ? FOCUS.work : FOCUS.free) : FOCUS[p]; }
function resetFocus(phase){
  clearInterval(fz.timer); fz.run=false; fz.end=null; fz.phase=phase||'work'; gFocusCancel();
  fz.total=fz.left=phaseMinutes(fz.phase)*60;
}
function setFocusMode(m){ FOCUS.mode=m; fz.cycle=1; resetFocus('work'); render(); }
function stepFocus(key,delta){
  const [lo,hi]=FOCUS_LIMITS[key]; FOCUS[key]=Math.min(hi,Math.max(lo,FOCUS[key]+delta));
  if(!fz.run) resetFocus(fz.phase); render();
}
function presetFree(min){ FOCUS.free=min; resetFocus('work'); render(); }
function toggleFocus(){
  if(fz.run){ // pause: keep what is left
    fz.left=Math.max(0,Math.ceil((fz.end-Date.now())/1000)); fz.run=false; clearInterval(fz.timer); gFocusCancel(); sfx('pause'); render(); return;
  }
  askNotify();
  fz.run=true; fz.end=Date.now()+fz.left*1000; sfx('start');
  if(FOCUS.calAlarm && gOn()) gFocusAlarm(new Date(fz.end), fz.phase==='work' ? '⏰ Terminó tu bloque de enfoque' : '⏰ Terminó la pausa: vuelve al enfoque');
  // Measure against the end time so the clock stays right even if the tab sleeps
  fz.timer=setInterval(()=>{ fz.left=Math.max(0,Math.ceil((fz.end-Date.now())/1000)); if(fz.left<=0) phaseDone(); else if(view==='enfoque') tickFocus(); },500);
  render();
}
function skipPhase(){ phaseDone(true); }
function focusDone(msg){ counters.focus++; markActive(); reward(20, msg); }
function phaseDone(skipped){
  clearInterval(fz.timer); fz.run=false;
  const was=fz.phase;
  if(FOCUS.mode==='free'){ if(!skipped){ notify('⏰ Tiempo de enfoque terminado','Buen trabajo. Tómate un respiro.'); focusDone('Bloque de enfoque completado'); } resetFocus('work'); render(); return; }
  let next;
  if(was==='work'){ next = fz.cycle%FOCUS.cycles===0 ? 'long' : 'short';
    if(!skipped){ notify('🍅 Pomodoro completado', next==='long'?`¡${FOCUS.cycles} ciclos! Pausa larga de ${FOCUS.long} min.`:`Pausa de ${FOCUS.short} min.`); focusDone('Pomodoro completado'); } }
  else { next='work'; fz.cycle = was==='long' ? 1 : fz.cycle+1;
    if(!skipped){ notify('⏰ Fin de la pausa', `Vuelve al enfoque: ciclo ${fz.cycle} de ${FOCUS.cycles}.`); sfx('start'); } }
  resetFocus(next);
  if(FOCUS.autoNext && !skipped) toggleFocus(); else render();
}
function finishFocus(){ clearInterval(fz.timer); fz.cycle=1; resetFocus('work'); focusDone('Tarea de enfoque completada'); render(); }

/* Notifications: system banner when allowed, plus sound, vibration and an in-app toast as fallback */
function askNotify(){ try{ if('Notification' in window && Notification.permission==='default') Notification.requestPermission().then(()=>{ if(view==='enfoque') render(); }); }catch(e){} }
function notify(title,body){
  try{ if('Notification' in window && Notification.permission==='granted') new Notification(title,{body,icon:'apple-touch-icon.png'}); }catch(e){}
  navigator.vibrate?.([200,100,200]); sfx('big'); toast(`${title} · ${body}`);
}
function notifyState(){
  if(!('Notification' in window)) return 'Este navegador no permite notificaciones; recibirás un aviso en pantalla.';
  return {granted:'🔔 Recibirás una notificación cuando termine el tiempo.', denied:'🔕 Notificaciones bloqueadas: actívalas en los ajustes del navegador.', default:'🔔 Al iniciar te pediremos permiso para avisarte cuando termine.'}[Notification.permission];
}
function tickFocus(){
  const C=2*Math.PI*126, pct=1-fz.left/fz.total, ring=$('fring'), clk=$('fclock');
  if(ring) ring.setAttribute('stroke-dashoffset', C*(1-pct));
  if(clk) clk.textContent=`${String(Math.floor(fz.left/60)).padStart(2,'0')}:${String(fz.left%60).padStart(2,'0')}`;
}
function stepper(label,key,unit){
  return `<div class="stepper"><span>${label}</span><div class="row"><button class="ic" onclick="stepFocus('${key}',-${key==='cycles'?1:5})" aria-label="Menos">−</button>
    <b>${FOCUS[key]}${unit}</b><button class="ic" onclick="stepFocus('${key}',${key==='cycles'?1:5})" aria-label="Más">+</button></div></div>`;
}
views.enfoque = () => {
  const C=2*Math.PI*126, pct=1-fz.left/fz.total, [pname,pcolor]=PHASE[fz.phase], pomo=FOCUS.mode==='pomodoro';
  const ticks=Array.from({length:60},(_,i)=>{const a=i*6*Math.PI/180;return `<line x1="${140+Math.sin(a)*112}" y1="${140-Math.cos(a)*112}" x2="${140+Math.sin(a)*(i%5?106:100)}" y2="${140-Math.cos(a)*(i%5?106:100)}" stroke="rgba(255,255,255,${i%5?.2:.5})"/>`;}).join('');
  const mm=String(Math.floor(fz.left/60)).padStart(2,'0'), ss=String(fz.left%60).padStart(2,'0');
  const dots=pomo?`<div class="cycles">${Array.from({length:FOCUS.cycles},(_,i)=>`<i class="${i<fz.cycle-1||(i===fz.cycle-1&&fz.phase!=='work')?'ok':i===fz.cycle-1?'now':''}"></i>`).join('')}</div>`:'';
  // What to focus on: the first pending task for today, priority first
  const next=tasks.filter(x=>!x.done&&x.day<=TODAY).sort((a,b)=>(b.p-a.p)||(a.day-b.day))[0];
  return `<div class="focus">
  <div class="glass seg focus-seg"><button class="${pomo?'on':''}" onclick="setFocusMode('pomodoro')">🍅 Pomodoro</button><button class="${pomo?'':'on'}" onclick="setFocusMode('free')">⏱ Libre</button></div>
  <span class="eyebrow" style="color:${pcolor}">${pname}${pomo?` · ciclo ${fz.cycle} de ${FOCUS.cycles}`:''}</span>
  <div class="ring"><svg viewBox="0 0 280 280">
    <circle cx="140" cy="140" r="126" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="8"/>
    <circle id="fring" cx="140" cy="140" r="126" fill="none" stroke="${pcolor}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C*(1-pct)}" transform="rotate(-90 140 140)"/>${ticks}</svg>
    <div class="in"><b id="fclock">${mm}:${ss}</b><span class="muted">${fz.run?'en curso':fz.left<fz.total?'en pausa':'listo'}</span></div></div>
  ${dots}
  ${next?`<h2>${escA(next.t)}</h2><div class="date">${V[next.v][0]} · ${escA(next.when)}</div>`:`<h2>Enfoque libre</h2><div class="date">No tienes tareas pendientes para hoy</div>`}
  <div class="row" style="justify-content:center;margin-top:20px;flex-wrap:wrap">
    <button class="btn w" onclick="toggleFocus()">${fz.run?'⏸ Pausar':fz.left<fz.total?'▶ Reanudar':'▶ Iniciar'}</button>
    <button class="btn" onclick="resetFocus(fz.phase);render()">↺ Reiniciar</button>
    ${pomo?`<button class="btn" onclick="skipPhase()">⏭ Saltar</button>`:''}
    <button class="btn p" onclick="finishFocus()">✓ Hecho</button></div>
  <div class="glass card focus-cfg">
    ${pomo ? stepper('Enfoque','work',' min')+stepper('Pausa corta','short',' min')+stepper('Pausa larga','long',' min')+stepper('Ciclos antes de la pausa larga','cycles','')
           : stepper('Duración','free',' min')+`<div class="chips" style="margin:10px 0 0">${[25,45,60,90].map(m=>`<button class="${FOCUS.free===m?'on':''}" onclick="presetFree(${m})">${m} min</button>`).join('')}</div>`}
    ${gOn()?`<div class="set"><span>Avisar también con Google Calendar <span class="date">Te llega aunque la app esté cerrada</span></span><button class="toggle ${FOCUS.calAlarm?'on':''}" onclick="FOCUS.calAlarm=!FOCUS.calAlarm;render()"></button></div>`:''}
    ${pomo?`<div class="set"><span>Empezar la siguiente fase automáticamente</span><button class="toggle ${FOCUS.autoNext?'on':''}" onclick="FOCUS.autoNext=!FOCUS.autoNext;render()"></button></div>`:''}
  </div>
  <p class="date" style="margin-top:14px">${notifyState()} <a href="#" class="lnk" onclick="event.preventDefault();askNotify();notify('🔔 Prueba de notificación','Así te avisaré cuando termine el tiempo.')">Probar</a></p></div>`;
};

views.bandeja = () => `<h1>Bandeja</h1><div class="date">Lo que Claude no pudo programar solo</div>
  ${inbox.length?inbox.map((x,i)=>`<div class="glass card" style="border-left:3px solid ${V[x.v][1]}"><b>${escA(x.t)}</b>
    <div class="date" style="margin:4px 0 10px">${V[x.v][0]} · ${x.s} · ${escA(x.why)}</div>
    <div class="row"><button class="btn p" onclick="inboxAccept(${i})">Programar</button><button class="btn" onclick="splitTask(inbox[${i}].t)">✂️ Dividir</button><button class="btn" onclick="inbox.splice(${i},1);render()">Descartar</button></div></div>`).join('')
  :emptyCard('Bandeja vacía. Aquí llegan las tareas que no caben en tus bloques.')}`;
function inboxAccept(i){const x=inbox.splice(i,1)[0], slot=nextSlot(x.v);tasks.push(x);x.when=slot.split(' ').slice(0,3).join(' ');render();gTaskCreated(x,slot);}

/* ---------- Correos: unread Gmail from the accounts where it is on; one tap turns a message into a task ---------- */
const mailPending = () => (G.mail||[]).filter(m=>!mailDone.includes(m.id));
const shortDate = d => ymd(d)===ymd(new Date()) ? d.toTimeString().slice(0,5) : d.toLocaleDateString('es-ES',{day:'numeric',month:'short'}).replace('.','');
views.correo = () => {
  const on = G.accounts.filter(a=>a.gmail), list = mailPending();
  if(!on.length) return `<h1>Correos</h1><div class="date">Convierte correos en tareas con un toque</div>
    ${emptyCard('Activa Gmail en las cuentas que quieras. Sisyphus solo lee tus correos no leídos de las últimas dos semanas: no envía, no borra y no guarda tus correos.', `<button class="btn p" onclick="go('ajustes')">Activar Gmail en Ajustes</button>`)}`;
  return `<h1>Correos</h1><div class="date">No leídos de las últimas dos semanas · ${on.map(a=>escA(a.email.endsWith('@gmail.com')?a.email.split('@')[0]:a.email.split('@')[1])).join(', ')}</div>
  ${list.length?list.map(m=>`<div class="glass card mail"><div class="row" style="justify-content:space-between;gap:8px"><b class="grow">${escA(m.from)}</b><span class="date">${shortDate(m.date)}</span></div>
    <div style="margin:4px 0 2px;font-weight:500">${escA(m.subject)}</div><div class="date">${escA(m.snippet.slice(0,140))}${m.snippet.length>140?'…':''}</div>
    <div class="row" style="margin-top:10px;flex-wrap:wrap"><button class="btn p" onclick="mailToTask('${m.id}')">→ Tarea</button>
      <a class="btn" href="${escA(m.link)}" target="_blank" rel="noopener">Abrir</a><button class="btn" onclick="mailDismiss('${m.id}')">Ignorar</button>
      ${G.accounts.filter(a=>a.gmail).length>1?`<span class="date" style="align-self:center">${escA(m.acc)}</span>`:''}</div></div>`).join('')
    :emptyCard('No tienes correos pendientes por revisar. 🎉')}
  <button class="btn" style="width:100%" onclick="refreshMail()">↻ Buscar correos nuevos</button>`;
};
async function refreshMail(){ toast('Buscando correos…'); await loadMail(); render(); }
function mailDismiss(id){ mailDone.push(id); mailDone = mailDone.slice(-300); render(); }
async function mailToTask(id){
  const m = G.mail.find(x=>x.id===id); if(!m) return;
  sheetHTML(`<span class="eyebrow">✦ Claude</span><h3>${escA(m.subject)}</h3><div class="date">Convirtiendo el correo en una tarea…</div>`);
  const title = await claudeMailTask(m) || `Responder a ${m.from}: ${m.subject}`;
  captureTask(title, {mail:m.link, mailId:m.id, single:true});
}

/* ---------- Goals: created by the person, steps checked off by hand ---------- */
const goalPct = g => g.steps.length ? Math.round(g.steps.filter(s=>s.ok).length / g.steps.length * 100) : 0;
views.objetivos = () => `<h1>Objetivos</h1><div class="date">Las metas grandes y los pasos que las acercan</div>
  ${goals.length?`<div class="goalgrid">${goals.map(g=>`<div class="glass card goal"><div class="row"><span class="eyebrow">${V[g.v][0]}${g.due?` · ${escA(g.due)}`:''}</span><b style="font-size:22px;font-weight:500">${goalPct(g)}%</b></div>
    <h4>${escA(g.ic)} ${escA(g.n)}</h4><div class="track" style="--c:${V[g.v][1]}"><i style="width:${goalPct(g)}%"></i></div>
    <ul>${g.steps.map((s,i)=>`<li class="${s.ok?'ok':''}" onclick="toggleStep('${g.id}',${i})" style="cursor:pointer">${s.ok?'✓':'○'} ${escA(s.s)}</li>`).join('')}</ul>
    <div class="row addstep"><input placeholder="+ Agregar paso" onkeydown="if(event.key==='Enter'){addGoalStep('${g.id}',this.value);}"><button class="ic gx" onclick="delGoal('${g.id}')" aria-label="Eliminar objetivo">×</button></div></div>`).join('')}</div>`
  :emptyCard('Aún no tienes objetivos.')}
  <button class="btn p" style="width:100%" onclick="goalSheet()">+ Nuevo objetivo</button>`;
function goalSheet(){
  draft = {ic:'🎯', n:'', v:'proyectos', due:''};
  openSheet(`<span class="eyebrow">Nuevo objetivo</span><h3>¿Qué quieres lograr?</h3>
    <div class="field"><span>Nombre</span><input placeholder="Terminar el semestre" oninput="draft.n=this.value"></div>
    <div class="field"><span>Ícono</span><input value="🎯" maxlength="4" style="width:70px" oninput="draft.ic=this.value"></div>
    <div class="field"><span>Categoría</span><select onchange="draft.v=this.value">${catOptions('proyectos')}</select></div>
    <div class="field"><span>Fecha</span><input placeholder="Jul 2027" oninput="draft.due=this.value"></div>
    <div class="row" style="margin-top:14px"><button class="btn p grow" onclick="saveGoal()">Crear${claudeOn()?' · Claude sugiere pasos':''}</button><button class="btn" onclick="closeSheet()">Cancelar</button></div>`);
}
async function saveGoal(){
  if(!draft.n.trim()) return toast('Escribe el nombre del objetivo');
  const g = {id:uid('g'), ic:draft.ic.trim()||'🎯', n:draft.n.trim(), v:draft.v, due:draft.due.trim(), steps:[]};
  goals.push(g); closeSheet(); render();
  if(claudeOn()){ toast('Claude está pensando los pasos…'); const st = await claudeSteps(g.n, g.v); if(st){ g.steps = st.map(x=>({s:x.s, ok:false})); render(); } }
}
function toggleStep(id,i){ const g=goals.find(x=>x.id===id), s=g.steps[i]; s.ok=!s.ok; if(s.ok){ markActive(); reward(15, goalPct(g)===100?`🎉 ¡${g.n} completado!`:'Paso del objetivo completado'); } render(); }
function addGoalStep(id,txt){ if(!txt.trim()) return; goals.find(x=>x.id===id).steps.push({s:txt.trim(), ok:false}); render(); }
function delGoal(id){ if(!confirm('¿Eliminar este objetivo?')) return; goals = goals.filter(x=>x.id!==id); render(); }

/* ---------- Progress: everything measured from real activity ---------- */
const inWeek = iso => iso && new Date(iso) >= weekStart();
const doneThisWeek = () => tasks.filter(x=>x.done && inWeek(x.doneAt));
views.insights = () => {
  const done=doneThisWeek(), perDay=DAYS_1.map((_,i)=>done.filter(x=>idxOfDate(new Date(x.doneAt))===i).length), max=Math.max(1,...perDay);
  const plan=plannedByCat(), keys=Object.keys(V), sessions=HABITS.reduce((s,h)=>s+weekSessions(h.id),0);
  return `<h1>Insights</h1><div class="date">Esta semana</div>
  <div class="kpis"><div class="glass card"><span class="eyebrow">Tareas hechas</span><b>${done.length}</b><span class="date">esta semana</span></div>
    <div class="glass card"><span class="eyebrow">Sesiones de hábitos</span><b>${sessions}</b><span class="date">esta semana</span></div>
    <div class="glass card"><span class="eyebrow">Racha</span><b>${streak()} 🔥</b><span class="date">mejor: ${bestStreak()}</span></div>
    <div class="glass card"><span class="eyebrow">Bloques de enfoque</span><b>${counters.focus}</b><span class="date">en total</span></div></div>
  <div class="glass card"><span class="eyebrow">Tareas hechas por día</span>
    <div class="chart">${perDay.map(n=>`<div class="c" style="height:${n/max*100}%"><i style="--c:var(--soda);height:100%"></i></div>`).join('')}</div>
    <div class="chart-x">${DAYS_1.map(d=>`<span>${d}</span>`).join('')}</div></div>
  <div class="glass card"><span class="eyebrow">Horas de rutina por categoría</span>
    ${routine.length?`<div class="bal" style="margin-top:8px">${keys.filter(k=>plan[k]).map(k=>`<div class="r" style="--c:${V[k][1]}"><span>${V[k][0]}</span><span class="track"><i style="width:${Math.min(plan[k]/Math.max(...Object.values(plan)),1)*100}%"></i></span><span class="v">${plan[k]} h</span></div>`).join('')}</div>`
      :'<p class="date">Define tu rutina en Ajustes para ver cómo repartes tu semana.</p>'}</div>`;
};

views.revision = () => {
  const done=doneThisWeek(), pend=tasks.filter(x=>!x.done&&x.day<=6), prio=tasks.filter(x=>!x.done&&x.p).slice(0,3), plan=plannedByCat();
  const reviewed = counters.lastReview===ymd(weekStart());
  const st=[
    ['🎉 Logros de la semana',`<div class="kpis"><div class="glass card"><span class="eyebrow">Hechas</span><b>${done.length}</b></div><div class="glass card"><span class="eyebrow">Hábitos</span><b>${HABITS.reduce((s,h)=>s+weekSessions(h.id),0)}</b></div></div><p class="date">Racha actual: ${streak()} días.</p>`],
    ['⏭️ Lo que quedó pendiente',pend.length?pend.map(x=>`<div class="glass task" style="--c:${V[x.v][1]}"><span class="bar"></span><div class="body">${escA(x.t)}<div class="m"><span>${escA(x.when)}</span></div></div></div>`).join('')+'<p class="date">Arrástralas en la vista Semana o márcalas como hechas.</p>':'<p>Nada pendiente. 🎉</p>'],
    ['⚖️ Balance',Object.keys(plan).length?`<p>${Object.keys(V).filter(k=>plan[k]||budget[k]).map(k=>`${V[k][0]} ${plan[k]||0}${budget[k]?`/${budget[k]}`:''} h`).join(' · ')}</p><p class="date">Horas de tu rutina frente a tu meta por categoría.</p>`:'<p class="date">Define tu rutina y tus horas por categoría en Ajustes.</p>'],
    ['🎯 Foco de la semana',prio.length?`<ol>${prio.map(x=>`<li>${escA(x.t)}</li>`).join('')}</ol>`:'<p class="date">Marca tus tareas importantes como prioritarias para verlas aquí.</p>'],
    ['✅ Confirmar plan',reviewed?'<p>Ya revisaste esta semana. ✓</p>':`<p>Cierra la semana y empieza la siguiente con claridad.</p><button class="btn p" onclick="confirmReview()">Confirmar semana</button>`]];
  return `<h1>Revisión</h1><div class="date">Cinco minutos para cerrar la semana</div><div class="steps">${st.map((_,i)=>`<i class="${i<=reviewStep?'on':''}"></i>`).join('')}</div>
  <div class="glass card"><h3 style="margin:0 0 12px;font-weight:500">${st[reviewStep][0]}</h3>${st[reviewStep][1]}</div>
  <div class="row"><button class="btn" ${reviewStep?'':'disabled style="opacity:.4"'} onclick="reviewStep--;render()">Atrás</button><span class="grow"></span>${reviewStep<4?'<button class="btn w" onclick="reviewStep++;render()">Siguiente</button>':''}</div>`;
};
function confirmReview(){ counters.reviews++; counters.lastReview=ymd(weekStart()); markActive(); reward(50,'Semana revisada'); go('inicio'); }

views.logros = () => {
  const best=bestStreak(), l=level();
  const badges=[['✅','Primer paso','1 tarea hecha',counters.done>=1],['📈','Imparable','50 tareas hechas',counters.done>=50],['🔥','Semana redonda','7 días de racha',best>=7],
    ['🏔️','Racha de 30','30 días seguidos',best>=30],['🏋️','Constancia','20 sesiones de hábitos',counters.habits>=20],['🍅','Enfocado','10 bloques de enfoque',counters.focus>=10],
    ['🧭','Con rumbo','Primer objetivo',goals.length>=1],['🗓️','Planificador','4 revisiones',counters.reviews>=4],['🌍','Explorador','5 lugares guardados',places.length>=5]];
  return `<h1>Logros</h1><div class="date">Cada tarea, hábito y bloque de enfoque suma estrellas</div>
  <div class="glass card level"><div class="lv">${l}</div><div class="grow"><b>${levelName(l)}</b><div class="date">${stars} ⭐ · ${toNext()} para el nivel ${l+1}</div><div class="track" style="--c:var(--soda);margin-top:8px"><i style="width:${(stars%LEVEL_STEP)/LEVEL_STEP*100}%"></i></div></div></div>
  <div class="badges">${badges.map(([i,n,d,ok])=>`<div class="glass badge ${ok?'':'lock'}"><div class="ic">${i}</div><b>${n}</b><small>${d}</small></div>`).join('')}</div>`;
};

/* ---------- Día fuera: the places saved in Google Maps, imported once from Google Takeout ---------- */
let here = null, placeFilter = 'all';   // current position stays in memory only, never saved
const kmTo = p => here && p.lat!=null ? haversine(here, p) : null;
function haversine(a, b){ const R=6371, r=x=>x*Math.PI/180, dLat=r(b.lat-a.lat), dLng=r(b.lng-a.lng);
  return 2*R*Math.asin(Math.sqrt(Math.sin(dLat/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLng/2)**2)); }
const kmLabel = k => k==null ? '' : k<1 ? `${Math.round(k*1000)} m` : `${k.toFixed(k<10?1:0).replace('.',',')} km`;
function locate(){
  if(!navigator.geolocation) return toast('Este navegador no permite usar tu ubicación');
  toast('Buscando tu ubicación…');
  navigator.geolocation.getCurrentPosition(p=>{ here={lat:p.coords.latitude, lng:p.coords.longitude}; render(); },
    e=>toast(e.code===1?'Permiso de ubicación denegado: actívalo en los ajustes del navegador':'No pude obtener tu ubicación'), {enableHighAccuracy:false, timeout:10000, maximumAge:300000});
}
function placeSuggestion(){
  const pool = places.filter(p=>p.work!==false && p.lat!=null);
  if(!pool.length) return null;
  if(here) return [...pool].sort((a,b)=>kmTo(a)-kmTo(b))[0];
  const favs = pool.filter(p=>p.fav);
  const list = favs.length ? favs : pool;
  return list[Math.floor(Date.now()/864e5) % list.length];   // a different one each day
}
views.fuera = () => {
  if(!places.length) return `<h1>Día fuera 🌍</h1><div class="date">Trabajo profundo con otro paisaje</div>
    <div class="glass card"><span class="eyebrow">Importa tus lugares de Google Maps</span>
      <ol class="steps-list"><li>Entra a <b>takeout.google.com</b>, deja marcado solo <b>Maps (Tus sitios)</b> y exporta.</li>
        <li>Descarga el .zip que te llega por correo.</li><li>Elígelo aquí (o el archivo <b>Sitios guardados.json</b> que trae dentro).</li></ol>
      <label class="btn p" style="display:inline-block;margin-top:12px">Elegir archivo<input type="file" accept=".zip,.json,application/json,application/zip" hidden onchange="importPlaces(this.files[0])"></label></div>
    <button class="btn" style="width:100%" onclick="placeSheet()">+ Agregar un lugar a mano</button>`;
  const sug = placeSuggestion();
  // Destacados: Claude marked them good for working · Guardados: imported from Google Maps · Favoritos: starred by the person
  const filters = {all:['Todos',()=>true],top:['Destacados',p=>p.work===true],fav:['Favoritos',p=>p.fav],saved:['Guardados',p=>!p.manual]};
  let list = places.filter(filters[placeFilter][1]);
  if(here) list = [...list].sort((a,b)=>(kmTo(a)??1e9)-(kmTo(b)??1e9));
  return `<h1>Día fuera 🌍</h1><div class="date">Trabajo profundo con otro paisaje · ${places.length} lugares</div>
  ${sug?`<div class="glass card ai"><span class="eyebrow">${here?'✦ El más cercano para trabajar':'✦ Sugerencia de hoy'}</span>
    <h3 style="margin:8px 0 4px;font-weight:500">${escA(sug.ic||'📍')} ${escA(sug.n)}</h3><div class="date">${escA(sug.addr||'')}${here?` · ${kmLabel(kmTo(sug))}`:''}</div>
    <div class="row" style="margin-top:12px;flex-wrap:wrap">${sug.url?`<a class="btn w" href="${escA(sug.url)}" target="_blank" rel="noopener">Abrir en Maps</a>`:''}${here?'':'<button class="btn" onclick="locate()">📍 Usar mi ubicación</button>'}</div></div>`:''}
  <div class="chips">${Object.entries(filters).map(([k,[n]])=>`<button class="${placeFilter===k?'on':''}" onclick="placeFilter='${k}';render()">${n}</button>`).join('')}</div>
  ${list.length?list.map(p=>`<div class="glass task place"><span style="font-size:22px">${escA(p.ic||'📍')}</span>
    <a class="body" ${p.url?`href="${escA(p.url)}" target="_blank" rel="noopener"`:''}><div>${escA(p.n)}</div><div class="m"><span>${escA(p.kind||'')}</span><span>${escA((p.addr||'').split(',').slice(0,2).join(','))}</span>${here&&p.lat!=null?`<span>${kmLabel(kmTo(p))}</span>`:''}</div></a>
    <button class="ic star ${p.fav?'on':''}" onclick="toggleFav('${p.id}')" aria-label="Favorito">${p.fav?'★':'☆'}</button></div>`).join('')
    :emptyCard(placeFilter==='fav'?'Marca con ☆ tus lugares favoritos.':placeFilter==='top'?'Claude destaca aquí los lugares buenos para trabajar.':'Ningún lugar en este filtro.')}
  <div class="row" style="margin-top:8px;flex-wrap:wrap"><button class="btn" onclick="placeSheet()">+ Agregar lugar</button>
    <label class="btn">Importar de nuevo<input type="file" accept=".zip,.json,application/json,application/zip" hidden onchange="importPlaces(this.files[0])"></label>
    ${claudeOn()&&places.some(p=>!p.kind)?'<button class="btn" onclick="tagPlaces()">✦ Clasificar con Claude</button>':''}</div>`;
};
function toggleFav(id){ const p=places.find(x=>x.id===id); p.fav=!p.fav; render(); }
async function loadJSZip(){
  if(window.JSZip) return window.JSZip;
  await new Promise((ok,fail)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.onload=ok; s.onerror=()=>fail(new Error('No pude cargar el lector de .zip')); document.head.appendChild(s); });
  return window.JSZip;
}
// Reads Takeout's "Sitios guardados.json" (GeoJSON), from the .zip or on its own, and merges it with what is already saved
async function importPlaces(file){
  if(!file) return;
  try{
    let text;
    if(/\.zip$/i.test(file.name) || file.type.includes('zip')){
      const zip = await (await loadJSZip()).loadAsync(file);
      const entry = Object.values(zip.files).find(f=>/(Sitios guardados|Saved Places)\.json$/i.test(f.name));
      if(!entry) return toast('Ese .zip no trae "Sitios guardados.json". Exporta "Maps (Tus sitios)" en Takeout.');
      text = await entry.async('string');
    } else text = await file.text();
    const feats = (JSON.parse(text).features || []).filter(f=>f.properties?.location?.name);
    const known = new Map(places.map(p=>[p.url||p.n, p]));
    let added = 0;
    feats.forEach(f=>{
      const loc = f.properties.location, [lng, lat] = f.geometry?.coordinates || [], url = f.properties.google_maps_url || '';
      const key = url || loc.name;
      if(known.has(key)) return;
      const hasPos = !!(lat || lng);   // Takeout writes [0, 0] when it has no position
      const p = {id:uid('p'), n:loc.name, addr:loc.address||'', cc:loc.country_code||'', url, lat:hasPos?lat:null, lng:hasPos?lng:null, fav:false};
      places.push(p); known.set(key, p); added++;
    });
    toast(added ? `${added} lugares importados` : 'No había lugares nuevos'); render();
    if(added && claudeOn()) tagPlaces();
  }catch(e){ console.error(e); toast('No pude leer el archivo: ' + e.message); }
}
async function tagPlaces(){
  const todo = places.filter(p=>!p.kind);
  if(!todo.length) return;
  toast(`Claude está clasificando ${todo.length} lugares…`);
  const tags = await claudeTagPlaces(todo);
  if(!tags) return;
  tags.forEach(t=>{ const p = todo[t.i]; if(p){ p.ic = t.emoji; p.kind = t.kind; p.work = t.work; } });
  toast('Lugares clasificados'); render();
}
function placeSheet(){
  draft = {n:'', url:'', addr:''};
  openSheet(`<span class="eyebrow">Nuevo lugar</span><h3>¿Dónde te gusta trabajar?</h3>
    <div class="field"><span>Nombre</span><input placeholder="Café del barrio" oninput="draft.n=this.value"></div>
    <div class="field"><span>Zona o dirección</span><input placeholder="Opcional" oninput="draft.addr=this.value"></div>
    <div class="field"><span>Enlace de Maps</span><input placeholder="Opcional" oninput="draft.url=this.value"></div>
    <div class="row" style="margin-top:14px"><button class="btn p grow" onclick="savePlace()">Guardar</button><button class="btn" onclick="closeSheet()">Cancelar</button></div>`);
}
function savePlace(){
  if(!draft.n.trim()) return toast('Escribe el nombre del lugar');
  const url = /^https?:\/\//.test(draft.url.trim()) ? draft.url.trim() : '';
  places.push({id:uid('p'), n:draft.n.trim(), addr:draft.addr.trim(), url, lat:null, lng:null, fav:true, work:true, manual:true, ic:'📍'});
  closeSheet(); toast('Lugar guardado'); render();
}

/* ---------- Ajustes: routine, habits and hours per category are the person's own ---------- */
const daysLabel = ds => ds.length===7 ? 'Todos los días' : ds.join()==='0,1,2,3,4' ? 'Lunes a viernes' : ds.join()==='5,6' ? 'Fin de semana' : ds.map(d=>DAYS_1[d]).join(' ');
views.ajustes = () => {
  const plan=plannedByCat();
  return `<h1>Ajustes</h1>
  <div class="sec"><h3>Conexiones</h3></div>
  ${gSettingsCard()}
  ${gOn()?`<div class="sec"><h3>Rutina</h3><span class="eyebrow">bloques de tiempo</span></div>
  <div class="glass card">${routine.length?[...routine].sort((x,y)=>toM(x.a)-toM(y.a)).map(b=>`<div class="set rt" onclick="blockSheet('${b.id}')" style="cursor:pointer"><span class="row" style="gap:10px"><i class="dot" style="background:${V[b.k][1]}"></i><span><b>${escA(b.n)}</b><span class="date">${b.a}–${b.b} · ${daysLabel(b.days)}</span></span></span><span class="muted">›</span></div>`).join('')
    :'<p class="date" style="margin:4px 0 10px">Crea tus bloques: por ejemplo "Trabajo profundo, 9:00–12:00, lunes a viernes". Claude ubicará cada tarea en el bloque que le corresponde.</p>'}
    <div class="row" style="margin-top:10px;gap:8px"><button class="btn p grow" onclick="planSheet()">✦ Planificar con Claude</button><button class="btn grow" onclick="blockSheet()">+ Agregar bloque</button></div></div>
  <div class="sec"><h3>Hábitos</h3></div>
  <div class="glass card">${HABITS.map(h=>`<div class="set"><span class="row" style="gap:10px"><span style="font-size:20px">${escA(h.ic)}</span><span><b>${escA(h.n)}</b><span class="date">${V[h.v][0]}${h.types?.length?` · ${h.types.map(escA).join(', ')}`:''}</span></span></span><button class="ic gx" onclick="delHabit('${h.id}')" aria-label="Quitar hábito">×</button></div>`).join('')}
    <button class="btn" style="width:100%;margin-top:10px" onclick="habitSheet()">+ Agregar hábito</button></div>
  <div class="sec"><h3>Horas por categoría</h3><span class="eyebrow">meta semanal</span></div>
  <div class="glass card">${Object.entries(V).map(([k,[n,c]])=>`<div class="set"><span style="display:flex;align-items:center;gap:8px"><i class="dot" style="background:${c}"></i>${n}${plan[k]?`<span class="date">· ${plan[k]} h en tu rutina</span>`:''}</span>
    <span class="row" style="gap:6px"><input class="num" type="number" min="0" step="0.5" value="${budget[k]??''}" placeholder="—" onchange="budget['${k}']=this.value===''?undefined:+this.value;render()"> h</span></div>`).join('')}</div>`:''}
  <div class="sec"><h3>Preferencias</h3></div>
  <div class="glass card">${[['quotes','Frase del día en el Inicio'],['sound','Sonidos']].map(([k,n])=>`<div class="set"><span>${n}</span><button class="toggle ${S[k]?'on':''}" onclick="S['${k}']=!S['${k}'];render()"></button></div>`).join('')}
    <div class="set"><span>Segunda zona horaria</span><select class="sel" onchange="S.tz2=this.value;render()">${ZONES.map(([z,n])=>`<option value="${z}" ${S.tz2===z?'selected':''}>${z?n:(zone2()?`Automática (${tzShort(zone2())})`:n)}</option>`).join('')}</select></div></div>`;
};
function blockSheet(id){
  const b = routine.find(x=>x.id===id);
  draft = b ? {...b, days:[...b.days]} : {id:null, a:'09:00', b:'10:00', n:'', k:'trabajo', days:[0,1,2,3,4]};
  renderBlockSheet();
}
function renderBlockSheet(){
  const d = draft;
  sheetHTML(`<span class="eyebrow">${d.id?'Editar bloque':'Nuevo bloque de rutina'}</span><h3>${d.id?escA(d.n):'Bloque de tiempo'}</h3>
    <div class="field"><span>Nombre</span><input value="${escA(d.n)}" placeholder="Trabajo profundo" oninput="draft.n=this.value"></div>
    <div class="field"><span>Categoría</span><select onchange="draft.k=this.value">${catOptions(d.k)}</select></div>
    <div class="field"><span>Desde</span><input type="time" value="${d.a}" onchange="draft.a=this.value"></div>
    <div class="field"><span>Hasta</span><input type="time" value="${d.b}" onchange="draft.b=this.value"></div>
    <div class="field" style="flex-direction:column;align-items:stretch;gap:8px"><span>Días</span><div class="chips dchips">${DAYS_FULL.map((n,i)=>`<button class="${d.days.includes(i)?'on':''}" onclick="toggleDraftDay(${i})">${n}</button>`).join('')}</div></div>
    <div class="row" style="margin-top:14px"><button class="btn p grow" onclick="saveBlock()">Guardar</button>${d.id?`<button class="btn" onclick="delBlock('${d.id}')">Eliminar</button>`:''}<button class="btn" onclick="closeSheet()">Cancelar</button></div>`);
}
function toggleDraftDay(i){ const ds = draft.days; ds.includes(i) ? ds.splice(ds.indexOf(i),1) : ds.push(i); ds.sort(); renderBlockSheet(); }
function saveBlock(){
  const d = draft;
  if(!d.days.length) return toast('Elige al menos un día');
  if(endM(d.b) <= toM(d.a)) return toast('La hora de fin debe ser después del inicio');
  const b = {id:d.id||uid('b'), a:d.a, b:d.b, n:d.n.trim()||V[d.k][0], k:d.k, days:d.days, eid:d.eid};
  const i = routine.findIndex(x=>x.id===b.id); i>=0 ? routine[i]=b : routine.push(b);
  closeSheet(); toast('Bloque guardado'); render();
  if(b.eid) gBlockEvent(b).then(render);   // its copy in Google Calendar follows the change
}
function delBlock(id){ const b = routine.find(x=>x.id===id); if(b?.eid) gBlockDelete(b); routine = routine.filter(x=>x.id!==id); closeSheet(); toast('Bloque eliminado'); render(); }
function habitSheet(){
  draft = {ic:'⭐', n:'', v:'ejercicio', types:''};
  openSheet(`<span class="eyebrow">Nuevo hábito</span><h3>¿Qué quieres repetir?</h3>
    <div class="field"><span>Nombre</span><input placeholder="Gimnasio" oninput="draft.n=this.value"></div>
    <div class="field"><span>Ícono</span><input value="⭐" maxlength="4" style="width:70px" oninput="draft.ic=this.value"></div>
    <div class="field"><span>Categoría</span><select onchange="draft.v=this.value">${catOptions('ejercicio')}</select></div>
    <div class="field" style="flex-direction:column;align-items:stretch;gap:8px"><span>Tipos de sesión <span class="date">(opcional, separados por coma)</span></span><input placeholder="Pesas, Natación, Cardio" oninput="draft.types=this.value"></div>
    <div class="row" style="margin-top:14px"><button class="btn p grow" onclick="saveHabit()">Agregar</button><button class="btn" onclick="closeSheet()">Cancelar</button></div>`);
}
function saveHabit(){
  if(!draft.n.trim()) return toast('Escribe el nombre del hábito');
  const h = {id:uid('h'), ic:draft.ic.trim()||'⭐', n:draft.n.trim(), v:draft.v, types:draft.types.split(',').map(s=>s.trim()).filter(Boolean)};
  HABITS.push(h); habitLog[h.id] = []; closeSheet(); toast('Hábito agregado'); render();
}
function delHabit(id){ if(!confirm('¿Quitar este hábito?')) return; HABITS = HABITS.filter(x=>x.id!==id); delete habitLog[id]; render(); }

/* ---------- Home: a dashboard built only from real data ---------- */
function nowCard(order){
  const nm=nowMin(), today=G.events[ymd(new Date())]||[];
  const items=[...today.filter(e=>!e.all).map(e=>({n:e.title, a:e.s.getHours()*60+e.s.getMinutes(), b:ymd(e.e)===ymd(e.s)?e.e.getHours()*60+e.e.getMinutes():1440, src:'Calendario'})),
    ...blocksOf(TODAY).map(b=>({n:b.n, a:toM(b.a), b:endM(b.b), src:V[b.k][0]}))].sort((x,y)=>x.a-y.a);
  const cur=items.find(x=>x.a<=nm&&nm<x.b), next=items.find(x=>x.a>nm);
  if(!cur&&!next) return `<div style="order:${order}" class="glass card now"><span class="eyebrow">Ahora</span><h2>Nada agendado</h2><div class="date">No hay más eventos ni bloques hoy.</div>
    <div class="row" style="margin-top:14px"><button class="btn w" onclick="go('enfoque')">Modo enfoque</button></div></div>`;
  const pct=cur?Math.round((nm-cur.a)/(cur.b-cur.a)*100):0;
  return `<div style="order:${order}" class="glass card now"><div class="row" style="justify-content:space-between"><span class="eyebrow">${cur?`Ahora · ${fmt(cur.a)}–${fmt(cur.b)}`:'Siguiente'}</span>${cur?'<span class="pill live">● En curso</span>':''}</div>
    <h2>${escA((cur||next).n)}</h2><div class="date">${cur?`${escA(cur.src)}${next?` · Siguiente: ${escA(next.n)} a las ${fmt(next.a)}`:''}`:`${escA(next.src)} · a las ${fmt(next.a)}`}</div>
    ${cur?`<div class="prog"><i style="width:${pct}%"></i></div>`:''}
    <div class="row" style="margin-top:14px"><button class="btn w" onclick="go('enfoque')">Modo enfoque</button></div></div>`;
}
function setupCard(){
  const steps=[[routine.length,'✦ Cuéntale a Claude tus objetivos y tu semana',"planSheet()"],[HABITS.length,'Agrega tus hábitos',"habitSheet()"],[claudeOn(),'Pega tu clave de Claude',"go('ajustes')"],[tasks.length,'Escribe tu primera tarea abajo',"$('capIn').focus()"]];
  if(steps.every(s=>s[0])) return '';
  return `<div style="order:0" class="glass card ai"><span class="eyebrow">Primeros pasos</span>
    ${steps.map(([ok,n,fn])=>`<div class="set" style="cursor:pointer" onclick="${fn}"><span>${ok?'✅':'○'} ${n}</span>${ok?'':'<span class="muted">›</span>'}</div>`).join('')}</div>`;
}
views.inicio = () => {
  const today=tasks.filter(x=>x.day===TODAY), done=today.filter(x=>x.done).length, pend=tasks.filter(x=>!x.done&&x.day<=TODAY);
  const ev=(G.events[ymd(new Date())]||[]).filter(e=>!e.all), booked=bookedHours(TODAY), plan=plannedByCat(), sk=streak();
  const dial = Array.from({length:61},(_,i)=>{const a=Math.PI*(1+i/60),r=i%5?118:112;return `<line x1="${130+Math.cos(a)*r}" y1="${130+Math.sin(a)*r}" x2="${130+Math.cos(a)*124}" y2="${130+Math.sin(a)*124}" stroke="rgba(255,255,255,${i%5?.25:.55})" stroke-width="1.2"/>`;}).join('');
  const hr=new Date().getHours(), hoy=new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'});
  const filters={all:['Todas',()=>true],pend:['Pendientes',x=>!x.done],prio:['Prioritarias',x=>x.p&&!x.done],done:['Hechas',x=>x.done]};
  const list=tasks.map((x,i)=>[x,i]).filter(([x])=>filters[taskFilter][1](x)).sort((a,b)=>(a[0].done-b[0].done)||(b[0].p-a[0].p)||(a[0].day-b[0].day));
  const nextEv=ev.find(e=>e.s>new Date());
  return `<h1>${hr<6?'Buenas noches.':hr<13?'Buenos días.':hr<20?'Buenas tardes.':'Buenas noches.'}</h1><div class="date">${hoy[0].toUpperCase()+hoy.slice(1)} · Nivel ${level()} ${levelName(level())}</div>
  ${tokenOk(primary())?'':gHomeNote()}
  ${S.quotes?`<div class="glass quote"><span class="eyebrow">Sisyphus · frase del día</span><p>“${phrases[quoteIdx].t}”</p>
    <div class="who"><span>${phrases[quoteIdx].a}</span><button onclick="nextQuote()" aria-label="Otra frase">↻</button></div></div>`:''}
  <div class="dash"><div class="colA">
    ${setupCard()}
    <div style="order:1" class="glass card"><span class="eyebrow">Tu día</span>
      <p style="margin:8px 0 0;font-size:15px;line-height:1.45">${ev.length?`<b>${ev.length} evento${ev.length===1?'':'s'}</b> en tu calendario`:'Sin eventos en tu calendario'} y <b>${pend.length} tarea${pend.length===1?'':'s'} pendiente${pend.length===1?'':'s'}</b>.${nextEv?` Lo siguiente: ${escA(nextEv.title)} a las ${nextEv.s.toTimeString().slice(0,5)}.`:''}</p></div>
    ${booked>10?`<div style="order:2" class="glass card alert"><div class="row"><span style="font-size:22px">⚠️</span><div class="grow"><b>Hoy tienes ${String(booked).replace('.',',')} h agendadas.</b>
      <div class="date" style="margin-top:4px">Es más de lo recomendable. Considera mover alguna tarea en la vista Semana.</div></div></div></div>`:''}
    ${mailPending().length?`<div style="order:7;cursor:pointer" class="glass card" onclick="go('correo')"><div class="row"><span style="font-size:20px">✉️</span><div class="grow"><b>${mailPending().length} correo${mailPending().length===1?'':'s'} por revisar</b><div class="date">Conviértelos en tareas con un toque</div></div><span>›</span></div></div>`:''}
    ${inbox.length?`<div style="order:7;cursor:pointer" class="glass card" onclick="go('bandeja')"><div class="row"><span style="font-size:20px">📥</span><div class="grow"><b>${inbox.length} tareas en la bandeja</b><div class="date">Necesitan tu confirmación</div></div><span>›</span></div></div>`:''}
    <div style="order:8"><div class="sec"><h3>Tareas</h3><span class="eyebrow">Por prioridad</span></div>
      <div class="chips">${Object.entries(filters).map(([k,[n]])=>`<button class="${taskFilter===k?'on':''}" onclick="taskFilter='${k}';render()">${n}</button>`).join('')}</div>
      ${list.length?list.map(([x,i])=>taskRow(x,i)).join(''):emptyCard(tasks.length?'Nada en este filtro.':'Sin tareas. Escribe una abajo y Claude la organiza.')}</div>
  </div><div class="colB">
    <div style="order:3" class="streak"><div class="eyebrow" style="position:relative;z-index:1">Racha</div>
      <svg class="dial" viewBox="0 0 260 70">${dial}<line x1="130" y1="0" x2="130" y2="40" stroke="#fff" stroke-width="2"/></svg>
      <div class="bignum">${sk}<sup style="font-size:40px;vertical-align:top">🔥</sup></div>
      <div class="lbl">${sk===1?'día':'días'} seguidos empujando la roca</div>
      <div class="week">${DAYS_1.map((d,i)=>`<span class="${activity.includes(ymd(dateOfIdx(i)))?'ok':i===TODAY?'today':''}">${d}</span>`).join('')}</div></div>
    ${habitsCard(4)}
    ${nowCard(5)}
    <div style="order:6" class="stats"><div class="glass stat hot"><span class="eyebrow">Hoy</span><b>${done}/${today.length}</b><span style="font-size:13px">tareas hechas</span></div>
      <div class="glass stat"><span class="eyebrow">Estrellas</span><b>${stars}</b><span style="font-size:13px" class="muted">${toNext()} para el nivel ${level()+1}</span></div></div>
    <div style="order:9"><div class="sec"><h3>Plan semanal</h3><span class="eyebrow">Rutina vs. meta</span></div>
      ${Object.keys(plan).length||Object.values(budget).some(v=>v)?`<div class="glass card bal">${Object.keys(V).filter(k=>plan[k]||budget[k]).map(k=>{const r=plan[k]||0,m=budget[k]||r;return `<div class="r" style="--c:${V[k][1]}"><span>${V[k][0]}</span><span class="track"><i style="width:${m?Math.min(r/m,1)*100:0}%"></i></span><span class="v">${r}${budget[k]?`/${budget[k]}`:''}h</span></div>`;}).join('')}</div>`
        :emptyCard('Define tu rutina y tus horas por categoría en Ajustes.', `<button class="btn" onclick="go('ajustes')">Ir a Ajustes</button>`)}</div>
    ${placeSuggestion()?`<div style="order:10;cursor:pointer" class="glass card" onclick="go('fuera')"><div class="row"><span style="font-size:22px">🌍</span><div class="grow"><b>Día fuera</b><div class="date">Sugerencia: ${escA(placeSuggestion().n)}</div></div><span>›</span></div></div>`:''}
  </div></div>
  ${tokenOk(primary())?gHomeNote():''}`;
};

function render(){
  const t = tabOf(view), subs = t ? TABS[t] : [];
  const seg = subs.length>1 ? `<div class="glass seg">${subs.map(s=>`<button class="${s===view?'on':''}" onclick="go('${s}')">${LABEL[s]}</button>`).join('')}</div>` : '';
  const page = !gOn() && !['ajustes','enfoque'].includes(view) ? views.bienvenida() : seg + views[view]();
  $('view').innerHTML = `<button class="avatar" onclick="go('ajustes')" aria-label="Ajustes">⚙️</button>` + page;
  renderSide();
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
  gAfterRender();
}

/* ---------- Actions ---------- */
function burst(){let s=`<defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#D61505"/><stop offset=".6" stop-color="#F75E3F"/><stop offset="1" stop-color="#C04BD8"/></linearGradient></defs>`;
  for(let i=0;i<24;i++)s+=`<rect x="-3" y="-105" width="6" height="${i%2?42:62}" rx="3" fill="url(#g)" transform="rotate(${i*15})"/>`;$('burst').innerHTML=s;}
function reward(n,msg){sfx(/Día completo/.test(msg)?'streak':n>=20?'big':'star');stars+=n;$('rpts').textContent=`+${n} ⭐`;$('rmsg').textContent=msg;const r=$('reward');r.classList.add('on');navigator.vibrate?.(30);clearTimeout(r._h);r._h=setTimeout(()=>r.classList.remove('on'),1500);}
function toggle(i){
  const x=tasks[i]; x.done=!x.done; x.doneAt=x.done?new Date().toISOString():null;
  if(!x.done){ sfx('undo'); counters.done=Math.max(0,counters.done-1); }
  else { counters.done++; markActive(); const left=tasks.filter(y=>y.day===TODAY&&!y.done).length; reward(10,x.day===TODAY&&!left?`🔥 ¡Día completo! Racha: ${streak()} días`:'¡Bien hecho!'); }
  gTaskToggled(x); render();
}

/* ---------- Split a task into steps: Claude suggests, the user edits (or writes them from scratch) ---------- */
let split = null;
// Fallback when Claude is not available: generic steps by kind of task
function suggestSteps(t){
  const s = t.toLowerCase();
  if(/contrato/.test(s)) return ['Leer el contrato y marcar cláusulas dudosas','Revisar pagos, exclusividad y duración','Anotar preguntas y comentarios','Enviar comentarios o agendar llamada'];
  if(/presentaci|propuesta|informe|campaña/.test(s)) return ['Definir objetivo y mensaje clave','Reunir datos y referencias','Armar primer borrador','Revisar, pulir y enviar'];
  if(/leer|cap[ií]tulo|estudiar|examen/.test(s)) return ['Lectura rápida y esquema','Lectura a fondo con notas','Resumen en 5 puntos'];
  if(/benchmark|investig|portafolio/.test(s)) return ['Listar 5–8 referentes','Analizar oferta y precios','Conclusiones en una página'];
  return ['Definir qué significa "terminado"','Primer avance concreto','Completar y revisar'];
}
async function splitTask(t, manual){
  const x = [...inbox,...tasks].find(y=>y.t===t), v = x ? x.v : guess(t).v, days = catDays(v);
  if(!manual && claudeOn()){
    sheetHTML(`<span class="eyebrow">✦ Claude</span><h3>${escA(t)}</h3><div class="date">Pensando los pasos…</div>`);
    const steps = await claudeSteps(t, v);
    if(steps){ split = {t, v, manual:false, by:'claude', steps}; renderSplit(); return; }
  }
  const list = manual ? [''] : suggestSteps(t);
  split = {t, v, manual:!!manual, steps:list.map((s,i)=>({s, d:days[Math.floor(i*days.length/list.length)]}))};
  renderSplit();
}
function renderSplit(){
  const b = split, n = b.steps.length;
  const opt = d => DAYS_FULL.map((name,i)=>`<option value="${i}" ${i===d?'selected':''}>${name}</option>`).join('');
  sheetHTML(`<span class="eyebrow">${b.manual?'✎ Divide la tarea tú mismo':b.by==='claude'?'✦ Claude sugiere estos pasos · puedes editarlos':'Pasos sugeridos · puedes editarlos'}</span><h3>${escA(b.t)}</h3>
    <div class="date" style="margin:-6px 0 8px">${V[b.v][0]} · los días proponen tus bloques de esta categoría</div>
    ${b.steps.map((st,i)=>`<div class="stp"><span class="n">${i+1}</span>
      <input value="${escA(st.s)}" placeholder="Describe el paso…" oninput="split.steps[${i}].s=this.value">
      <select onchange="split.steps[${i}].d=+this.value" aria-label="Día">${opt(st.d)}</select>
      <button class="ic" onclick="moveStep(${i},-1)" ${i?'':'disabled'} aria-label="Subir">↑</button>
      <button class="ic" onclick="moveStep(${i},1)" ${i<n-1?'':'disabled'} aria-label="Bajar">↓</button>
      <button class="ic" onclick="delStep(${i})" aria-label="Borrar">×</button></div>`).join('')}
    <button class="btn" style="width:100%;margin-top:10px" onclick="addStep()">+ Agregar paso</button>
    <p class="date" style="margin:12px 0 0;text-align:center">${b.manual
      ? `<a href="#" class="lnk" onclick="event.preventDefault();splitTask(split.t)">✦ Pedir sugerencia a Claude</a>`
      : `<a href="#" class="lnk" onclick="event.preventDefault();splitTask(split.t,true)">✎ Prefiero dividirla yo mismo</a>`}</p>
    <div class="row" style="margin-top:14px"><button class="btn p grow" onclick="programSplit()">Programar ${n} paso${n===1?'':'s'}</button><button class="btn" onclick="closeSheet()">Cancelar</button></div>`);
}
function addStep(){ const last = split.steps[split.steps.length-1]; split.steps.push({s:'', d:last?last.d:catDays(split.v)[0]}); renderSplit(); const ins=$('sheetBody').querySelectorAll('.stp input'); ins[ins.length-1].focus(); }
function delStep(i){ split.steps.splice(i,1); renderSplit(); }
function moveStep(i,dir){ const j=i+dir, s=split.steps; if(j<0||j>=s.length) return; [s[i],s[j]]=[s[j],s[i]]; renderSplit(); }
function programSplit(){
  const steps = split.steps.filter(st=>st.s.trim());
  if(!steps.length) return toast('Escribe al menos un paso');
  steps.forEach((st,i)=>{const x={t:`${st.s.trim()} · ${split.t}`, v:split.v, s:'S', p:false, day:st.d, when:`${DAYS_FULL[st.d]} · paso ${i+1}/${steps.length}`};tasks.push(x);gTaskCreated(x,st.d===TODAY?'Hoy':DAYS_FULL[st.d]);});
  const k = inbox.findIndex(y=>y.t===split.t); if(k>=0) inbox.splice(k,1);
  closeSheet(); sfx('star'); toast(`${steps.length} paso${steps.length===1?'':'s'} programado${steps.length===1?'':'s'}`); render();
}

// Capture: Claude classifies when there is a key; otherwise simple keyword rules and the next free routine block
function guess(t){const s=t.toLowerCase();
  const v=/clase|máster|master|universidad|curso|leer cap|examen|tesis|repaso/.test(s)?'universidad':/gym|gimnasio|correr|entren|nadar|yoga/.test(s)?'ejercicio':/proyecto|emprend|negocio|startup|escrib|blog/.test(s)?'proyectos':/cine|desayun|brunch|playa|salir|dormir|amigos/.test(s)?'ocio':/leer|libro|artículo|revista/.test(s)?'lectura':'trabajo';
  const size=/responder|llamar|enviar|mandar/.test(s)?'S':/propuesta|presentación|informe|proyecto/.test(s)?'L':'M';
  const prio=/urgente|hoy|mañana|para el/.test(s);
  return {v,size,prio,slot:nextSlot(v)};}
$('capture').onsubmit=e=>{e.preventDefault();const t=$('capIn').value.trim();if(!t)return;
  if(!gOn()){ toast('Conecta tu cuenta de Google para guardar tareas'); return; }
  $('capIn').value=''; captureTask(t);
};
async function captureTask(t, extra={}){
  if(!extra.single && t.length > 60) return voiceNote(t);
  if(claudeOn()&&!$('sheet').classList.contains('on'))openSheet(`<span class="eyebrow">✦ Claude</span><h3>${escA(t)}</h3><div class="date">Organizando tu tarea…</div>`);
  const g=await classifyTask(t);
  const opt=(o,sel)=>Object.keys(o).map(k=>`<option value="${k}" ${k===sel?'selected':''}>${o[k]}</option>`).join('');
  sheetHTML(`<span class="eyebrow">${g.by==='claude'?'✦ Claude organizó tu tarea':'Clasificación básica · agrega tu clave de Claude en Ajustes'}</span><input id="ct" class="ttl" value="${escA(t)}" aria-label="Tarea">${g.why?`<div class="date" style="margin:2px 0 8px">${escA(g.why)}</div>`:''}
    <div class="field"><span>Categoría</span><select id="cv">${catOptions(g.v)}</select></div>
    <div class="field"><span>Tamaño</span><select id="cs">${opt({S:'S · <30 min',M:'M · 1–2 h',L:'L · medio bloque+'},g.size)}</select></div>
    <div class="field"><span>Prioridad</span><select id="cp">${opt({1:'Prioritaria',0:'Normal'},g.prio?'1':'0')}</select></div>
    <div class="field"><span>Programada</span><span>${escA(g.slot)}</span></div>
    <div class="row" style="margin-top:14px"><button class="btn p grow" id="cok">Aceptar</button><button class="btn" onclick="splitTask(${escA(JSON.stringify(t))})">✂️ Dividir</button></div>`);
  $('cok').onclick=()=>{const x={t:$('ct').value.trim()||t,v:$('cv').value,s:$('cs').value,p:$('cp').value==='1',when:g.slot.split(' ').slice(0,3).join(' '),day:g.slot.startsWith('Hoy')?TODAY:0,mail:extra.mail};
    if(extra.mailId){ mailDone.push(extra.mailId); mailDone=mailDone.slice(-300); }
    tasks.push(x);closeSheet();toast('Guardando en Google…');render();gTaskCreated(x,g.slot);};
}

/* ---------- Voice notes: the browser turns speech into text, Claude splits the note into tasks ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
if(!SR) $('micBtn').hidden = true;   // e.g. Firefox: the keyboard's own dictation still works
function toggleVoice(){
  if(!gOn()) return toast('Conecta tu cuenta de Google para guardar tareas');
  dictate($('capIn'), $('micBtn'), t => { $('capIn').value = ''; voiceNote(t); });
}
// Speech to text into any field; a second tap on the button ends it, then onDone gets the full text
function dictate(input, btn, onDone){
  if(rec) return rec.stop();
  const before = input.value.trim(), idle = input.placeholder;
  let heard = '';
  rec = new SR(); rec.lang = 'es-ES'; rec.interimResults = true; rec.continuous = true;
  btn.classList.add('on'); input.placeholder = 'Te escucho… toca el micrófono para terminar';
  input.dispatchEvent(new Event('input'));
  rec.onresult = e => {
    let interim = '';
    for(let i = e.resultIndex; i < e.results.length; i++){ const r = e.results[i]; r.isFinal ? heard += r[0].transcript + ' ' : interim += r[0].transcript; }
    input.value = [before, heard + interim].join(' ').trim(); input.dispatchEvent(new Event('input'));
  };
  rec.onerror = e => toast(/not-allowed/.test(e.error) ? 'Permite el micrófono en los ajustes del navegador' : e.error === 'no-speech' ? 'No te escuché. Intenta de nuevo.' : 'No pude usar el micrófono');
  rec.onend = () => {
    rec = null; btn.classList.remove('on'); input.placeholder = idle;
    const t = input.value.trim();
    if(t && heard.trim()) onDone(t);
  };
  try{ rec.start(); }catch(e){ rec = null; btn.classList.remove('on'); toast('No pude usar el micrófono'); }
}
// A note with one or many things to do: Claude splits it, then each task is categorized and placed with day and time
async function voiceNote(text){
  sheetHTML(`<span class="eyebrow">✦ Tu nota</span><h3>${escA(text)}</h3><div class="date">${claudeOn() ? 'Claude está separando las tareas…' : ''}</div>`);
  if(!claudeOn() && text.length > 80) return sheetHTML(`<span class="eyebrow">🎤 Nota de voz</span><h3>${escA(text)}</h3>
    <div class="date" style="margin:-4px 0 12px">Para separar una nota larga en varias tareas y ponerlas en tu calendario, Claude necesita tu clave en este dispositivo.</div>
    <div class="row" style="flex-wrap:wrap"><button class="btn p grow" onclick="go('ajustes')">Pegar mi clave de Claude</button><button class="btn" onclick="captureTask(${escA(JSON.stringify(text))},{single:true})">Guardarla como una tarea</button></div>`);
  const list = claudeOn() ? await claudeSplitNote(text) : null;
  if(!list || list.length <= 1) return captureTask(list?.[0] || text, {single: true});
  draft = {notes: list};
  renderVoiceSheet();
}
function renderVoiceSheet(){
  const n = draft.notes.length;
  sheetHTML(`<span class="eyebrow">✦ Encontré ${n} tareas en tu nota</span><h3>Revísalas y las organizo</h3><div class="date" style="margin:-6px 0 8px">Cada una queda con su categoría, día y hora, y se crea como evento en tu calendario.</div>
    ${draft.notes.map((t, i) => `<div class="stp vn"><span class="n">${i+1}</span><input value="${escA(t)}" oninput="draft.notes[${i}]=this.value"><button class="ic" onclick="draft.notes.splice(${i},1);renderVoiceSheet()" aria-label="Quitar">×</button></div>`).join('')}
    <div class="row" style="margin-top:14px"><button class="btn p grow" onclick="organizeAll()">${n === 1 ? 'Organizar la tarea' : `Organizar las ${n}`}</button><button class="btn" onclick="closeSheet()">Cancelar</button></div>`);
}
/* ---------- Planner: tell Claude your goals and how you want your week; it builds routine, habits, goals and tasks ---------- */
const MIC_ICON = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
function planSheet(){
  if(!gOn()) return toast('Conecta tu cuenta de Google primero');
  if(!claudeOn()) return toast('Pega tu clave de Claude en Ajustes para planificar');
  sheetHTML(`<span class="eyebrow">✦ Planifica tu semana con Claude</span><h3>Cuéntame tus objetivos y cómo quieres tu semana</h3>
    <div class="date" style="margin:-4px 0 10px">Escribe o habla con naturalidad: tus metas, a qué hora trabajas o estudias, cuándo haces ejercicio, qué días quieres libres, horarios fijos… Claude arma tu rutina, hábitos, objetivos y las tareas de esta semana. Antes de guardar nada te muestra el plan.</div>
    <div class="planbox"><textarea id="planIn" rows="8" placeholder="Ej.: Quiero terminar el semestre y lanzar mi proyecto. Trabajo de 9 a 13 y de 15 a 18 entre semana, clases lunes a jueves de 19 a 22. Gimnasio 3 veces por semana en la mañana. Leer 30 minutos antes de dormir. Fines de semana libres salvo el sábado en la mañana para el proyecto." oninput="S.planText=this.value">${escA(S.planText || '')}</textarea>
      ${SR ? `<button type="button" id="planMic" class="mic" aria-label="Dictar" onclick="dictate($('planIn'), $('planMic'), t => { S.planText = t; })">${MIC_ICON}</button>` : ''}</div>
    <div class="row" style="margin-top:14px"><button class="btn p grow" onclick="makePlan()">✦ Armar mi plan</button><button class="btn" onclick="closeSheet()">Cancelar</button></div>`);
}
async function makePlan(){
  if(rec) rec.stop();
  const text = ($('planIn')?.value || S.planText || '').trim();
  if(text.length < 20) return toast('Cuéntame un poco más: tus objetivos y tus horarios');
  S.planText = text;
  sheetHTML(`<span class="eyebrow">✦ Claude</span><h3>Armando tu semana…</h3><div class="date">Repartiendo bloques, hábitos, objetivos y tareas. Toma unos segundos.</div>`);
  const plan = await claudePlan(text);
  if(!plan) return planSheet();
  draft = {plan, use: {routine: plan.routine.length > 0, habits: plan.habits.length > 0, goals: plan.goals.length > 0, budget: plan.budget.length > 0, tasks: plan.tasks.length > 0},
    replace: routine.length > 0, cal: true};
  renderPlan();
}
const dayList = ds => daysLabel(ds.map(d => DAYS_FULL.indexOf(d)).filter(i => i >= 0).sort());
function renderPlan(){
  const {plan: p, use: u} = draft;
  const sec = (key, title, items) => items.length ? `<div class="plansec"><label class="row"><input type="checkbox" ${u[key] ? 'checked' : ''} onchange="draft.use.${key}=this.checked"> <b>${title}</b></label><ul>${items.join('')}</ul></div>` : '';
  sheetHTML(`<span class="eyebrow">✦ Tu plan</span><h3>Revísalo antes de aplicarlo</h3><p class="date" style="margin:-4px 0 10px">${escA(p.summary)}</p>
    ${sec('routine', `Rutina · ${p.routine.length} bloques`, p.routine.map(b => `<li><i class="dot" style="background:${V[b.category][1]}"></i> ${escA(b.name)} · ${b.start}–${b.end} · ${dayList(b.days)}</li>`))}
    ${sec('habits', `Hábitos · ${p.habits.length}`, p.habits.map(h => `<li>${escA(h.emoji)} ${escA(h.name)}${h.types.length ? ` <span class="date">(${h.types.map(escA).join(', ')})</span>` : ''}</li>`))}
    ${sec('goals', `Objetivos · ${p.goals.length}`, p.goals.map(g => `<li>${escA(g.emoji)} ${escA(g.name)}${g.due ? ` · ${escA(g.due)}` : ''} <span class="date">· ${g.steps.length} pasos</span></li>`))}
    ${sec('budget', 'Horas por categoría', p.budget.map(x => `<li><i class="dot" style="background:${V[x.category][1]}"></i> ${V[x.category][0]}: ${x.hours} h a la semana</li>`))}
    ${sec('tasks', `Tareas de esta semana · ${p.tasks.length}`, p.tasks.map(t => `<li><i class="dot" style="background:${V[t.category][1]}"></i> ${t.day} ${t.time} · ${escA(t.title)}</li>`))}
    <div class="plansec opts">
      ${routine.length ? `<label class="row"><input type="checkbox" ${draft.replace ? 'checked' : ''} onchange="draft.replace=this.checked"> Reemplazar mi rutina actual (${routine.length} bloques)</label>` : ''}
      <label class="row"><input type="checkbox" ${draft.cal ? 'checked' : ''} onchange="draft.cal=this.checked"> Poner también los bloques de rutina en Google Calendar</label>
      <p class="date">Las tareas con hora siempre se crean como eventos en tu calendario.</p></div>
    <div class="row" style="margin-top:12px"><button class="btn p grow" onclick="applyPlan()">Aplicar plan</button><button class="btn" onclick="planSheet()">Ajustar</button></div>`);
}
async function applyPlan(){
  const {plan: p, use: u} = draft, replace = draft.replace, cal = draft.cal;
  sheetHTML(`<span class="eyebrow">✦ Claude</span><h3>Aplicando tu plan…</h3><div class="date" id="vprog">Guardando en tu Google</div>`);
  const step = msg => { if($('vprog')) $('vprog').textContent = msg; };
  if(u.routine){
    if(replace){ for(const b of routine) if(b.eid) await gBlockDelete(b); routine = []; }
    const fresh = p.routine.map(b => ({id: uid('b'), n: b.name, k: b.category, a: b.start, b: b.end, days: b.days.map(d => DAYS_FULL.indexOf(d)).filter(i => i >= 0).sort()}))
      .filter(b => b.days.length && /^\d\d:\d\d$/.test(b.a) && /^\d\d:\d\d$/.test(b.b) && endM(b.b) > toM(b.a));
    routine.push(...fresh);
    if(cal) for(const [i, b] of fresh.entries()){ step(`Bloques en tu calendario: ${i+1} de ${fresh.length}`); await gBlockEvent(b); }
  }
  if(u.habits) p.habits.forEach(h => { const x = {id: uid('h'), ic: h.emoji || '⭐', n: h.name, v: h.category, types: h.types}; HABITS.push(x); habitLog[x.id] = []; });
  if(u.goals) p.goals.forEach(g => goals.push({id: uid('g'), ic: g.emoji || '🎯', n: g.name, v: g.category, due: g.due, steps: g.steps.map(s => ({s, ok: false}))}));
  if(u.budget) p.budget.forEach(x => { budget[x.category] = x.hours; });
  if(u.tasks) for(const [i, t] of p.tasks.entries()){
    step(`Tareas: ${i+1} de ${p.tasks.length} · ${t.title}`);
    const slot = `${t.day} · ${t.time} ${t.block}`, x = {t: t.title, v: t.category, s: t.size, p: t.priority, when: `${t.day} · ${t.time}`, day: t.day === 'Hoy' ? TODAY : DAYS_FULL.indexOf(t.day)};
    tasks.push(x); await gTaskCreated(x, slot);
  }
  markActive(); closeSheet(); reward(50, 'Semana planificada'); render();
}

// Each task is classified and placed like a typed one; the person reviewed the list, so they are saved without one sheet per task
async function organizeAll(){
  const list = draft.notes.map(s => s.trim()).filter(Boolean);
  if(!list.length) return closeSheet();
  sheetHTML(`<span class="eyebrow">✦ Claude</span><h3>Organizando ${list.length} tareas…</h3><div class="date" id="vprog">0 de ${list.length}</div>`);
  const taken = [];
  for(const [i, t] of list.entries()){
    const g = await classifyTask(t, taken);
    const m = /^(\S+) · (\d\d):(\d\d)/.exec(g.slot);
    if(m){ const a = +m[2]*60 + +m[3]; taken.push(`${m[1]} ${fmt(a)}-${fmt(a + ({S:30, M:60, L:120}[g.size] || 60))}`); }
    const x = {t, v:g.v, s:g.size, p:g.prio, when:g.slot.split(' ').slice(0,3).join(' '), day:g.slot.startsWith('Hoy') ? TODAY : 0};
    tasks.push(x); await gTaskCreated(x, g.slot);
    if($('vprog')) $('vprog').textContent = `${i+1} de ${list.length} · ${t}`;
  }
  closeSheet(); toast(`${list.length} tareas organizadas y en tu calendario`); render();
}

/* ---------- Updates: every publish writes a new build number; the app reloads itself when it sees one ---------- */
const BUILD = document.querySelector('meta[name=build]')?.content || '0';
if(/[?&]v=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
async function checkUpdate(){
  if(BUILD === '0' || rec || $('sheet').classList.contains('on')) return;   // never interrupt something in progress
  try{
    const v = (await (await fetch(`version.txt?t=${Date.now()}`, {cache: 'no-store'})).text()).trim();
    if(!/^\d+$/.test(v) || v === BUILD || sessionStorage.getItem('sisyphus.reloadedFor') === v) return;
    sessionStorage.setItem('sisyphus.reloadedFor', v);
    location.replace(`${location.pathname}?v=${v}`);   // the ?v= skips the cached page
  }catch(e){}
}
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') checkUpdate(); });
setTimeout(checkUpdate, 2500);

// Tapping the current tab keeps the sub-view; another tab opens its first sub-view
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{const t=b.dataset.t;go(tabOf(view)===t?view:TABS[t][0]);});
burst(); render();
