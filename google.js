/* ---------- Google: several accounts, Calendar, Tasks and Drive (runs entirely in the browser) ----------
   The first connected account is the main one: its Google Tasks list "Sisyphus" holds the tasks and its
   Drive app folder holds stars, habits and settings. Calendar events are read from every connected account. */
const G = {
  clientId: '914287258092-ihootl8kun38hkgjb4re3ufu7h5296us.apps.googleusercontent.com',
  scopes: ['openid','email','profile',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/tasks',
    'https://www.googleapis.com/auth/drive.appdata'].join(' '),
  accounts: [],    // [{email, name, pic, token, exp}]
  events: {},      // 'YYYY-MM-DD' -> [{title, s, e, all, acc, cal}]
  listId: null, fileId: null, ready: false, status: ''
};
const CAL = 'https://www.googleapis.com/calendar/v3', TASKS = 'https://tasks.googleapis.com/tasks/v1',
      DRIVE = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const STATE_FILE = 'sisyphus-state.json', TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
// Google Calendar colour ids closest to each category colour
const GCOLOR = {trabajo:'11', lectura:'6', universidad:'7', ejercicio:'9', proyectos:'3', ocio:'4'};

const gLoad = (k,d) => { try{ return JSON.parse(localStorage.getItem('sisyphus.'+k)) ?? d; }catch(e){ return d; } };
const gStore = (k,v) => { try{ localStorage.setItem('sisyphus.'+k, JSON.stringify(v)); }catch(e){} };
G.accounts = gLoad('accounts', []);
const saveAccounts = () => gStore('accounts', G.accounts);
const primary = () => G.accounts[0] || null;
const tokenOk = a => !!(a && a.token && a.exp > Date.now() + 60e3);
// The main account's calendar time zone rules: new events are created on its clock, whatever the device says
const mainTz = () => primary()?.tz || TZ;
const TZ_SHORT = {'America/Bogota':'COL', 'Europe/Madrid':'ESP', 'America/New_York':'NY', 'America/Mexico_City':'MEX', 'Europe/London':'UK'};
const tzShort = tz => TZ_SHORT[tz] || (tz || '').split('/').pop().replace(/_/g, ' ');
const tzCity = tz => new Intl.DateTimeFormat('es-ES', {timeZone: tz, timeZoneName: 'long'}).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || tz;
const gOn = () => !!primary();

/* Dates: the app's "day" index is 0 = Monday of the current week */
const gDay = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
function weekStart(){ const d = gDay(new Date()); d.setDate(d.getDate() - (d.getDay()+6)%7); return d; }
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function dateOfIdx(i){ const d = weekStart(); d.setDate(d.getDate()+i); return d; }
const idxOfDate = d => Math.round((gDay(d) - weekStart()) / 864e5);
const TODAY = (new Date().getDay()+6) % 7;

/* ---------- Sign-in ---------- */
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
// withGmail adds read-only Gmail access, only for the accounts where the person turned it on
function requestToken(hint, prompt, withGmail){
  return new Promise((res, rej) => {
    if(!window.google?.accounts?.oauth2) return rej(new Error('El servicio de Google aún está cargando. Intenta de nuevo en unos segundos.'));
    google.accounts.oauth2.initTokenClient({
      client_id: G.clientId, scope: G.scopes + (withGmail ? ' ' + GMAIL_SCOPE : ''), prompt, login_hint: hint || undefined,
      callback: r => r.error ? rej(new Error(r.error_description || r.error)) : res(r),
      error_callback: e => rej(new Error(e.type === 'popup_closed' ? 'Cerraste la ventana de Google.' : e.type === 'popup_failed_to_open' ? 'El navegador bloqueó la ventana de Google.' : (e.message || e.type)))
    }).requestAccessToken();
  });
}
/* ---------- Session server: Google asks for consent once per account, then the app renews access by itself ----------
   Sign-in goes to the server in this same window and comes back with the result after the # (never sent to any server). */
G.server = 'https://sisyphus-auth.sisyphus-roca.workers.dev';
// Sessions issued before the app moved to production (Google's test mode) expire after 7 days: renew them once
const PROD_AT = Date.parse('2026-10-30T13:22:00Z');
const needsSession = a => !a.session || !(a.sessionAt > PROD_AT);
// Gmail is never requested again here: Google blocks that permission for apps in production without its formal review,
// and the read access granted earlier carries over to the new session (include_granted_scopes)
function serverLogin(hint){
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  gStore('authNonce', {nonce, at: Date.now()});
  const state = btoa(JSON.stringify({nonce, ret: location.origin + location.pathname + `?r=${Date.now()}`})).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  location.href = `${G.server}/login?${new URLSearchParams({state, hint: hint || '', gmail: ''})}`;
}
// Back from the server: check it answers our own request, keep the account and its sealed session, clean the address bar
function serverReturn(){
  const m = /#sisyphus-auth=([\w-]+)/.exec(location.hash);
  if(!m) return;
  history.replaceState(null, '', location.pathname);
  const pending = gLoad('authNonce', null); try{ localStorage.removeItem('sisyphus.authNonce'); }catch(e){}
  let r; try{ r = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))); }catch(e){ return; }
  if(!pending || r.nonce !== pending.nonce || Date.now() - pending.at > 15*60e3) return toast('No pude confirmar el inicio de sesión. Intenta de nuevo.');
  if(r.error) return toast(r.error === 'access_denied' ? 'Cancelaste el permiso en Google.' : 'Google: ' + r.error);
  const acc = {email: r.email, name: r.name, pic: r.pic, token: r.access_token, exp: Date.now() + r.expires_in*1000, gmail: (r.scope || '').includes(GMAIL_SCOPE)};
  if(r.session){ acc.session = r.session; acc.sessionAt = Date.now(); }
  const i = G.accounts.findIndex(a => a.email === acc.email);
  if(i >= 0) G.accounts[i] = {...G.accounts[i], ...acc}; else G.accounts.push(acc);
  saveAccounts();
  toast(r.session ? `${acc.email} conectada sin vencimiento` : `${acc.email} conectada`);
}
const refreshing = new Map();
async function refreshAcc(acc){
  if(!acc?.session || !G.server) return false;
  if(!refreshing.has(acc.email)) refreshing.set(acc.email, (async () => {
    try{
      const r = await fetch(`${G.server}/refresh`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({session: acc.session})});
      const t = await r.json();
      if(!r.ok){ if(r.status === 401){ delete acc.session; saveAccounts(); } return false; }   // revoked at Google: needs a new sign-in
      acc.token = t.access_token; acc.exp = Date.now() + t.expires_in*1000; saveAccounts();
      return true;
    }catch(e){ return false; }
    finally{ refreshing.delete(acc.email); }
  })());
  return refreshing.get(acc.email);
}

async function gConnect(hint){
  const known = G.accounts.find(a => a.email === hint);
  if(G.server) return serverLogin(hint, known?.gmail);
  try{
    const r = await requestToken(hint, hint ? '' : 'select_account', known?.gmail);
    if(!google.accounts.oauth2.hasGrantedAllScopes(r, ...G.scopes.split(' ').slice(3)))
      toast('Faltan permisos: marca todas las casillas para que Sisyphus funcione completo');
    const me = await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {headers:{Authorization:'Bearer '+r.access_token}})).json();
    const acc = {email: me.email, name: me.name, pic: me.picture, token: r.access_token, exp: Date.now() + r.expires_in*1000};
    const i = G.accounts.findIndex(a => a.email === acc.email);
    if(i >= 0) G.accounts[i] = {...G.accounts[i], ...acc}; else G.accounts.push(acc);
    saveAccounts();
    toast(i >= 0 ? `${acc.email} reconectada` : `${acc.email} conectada`);
    await gSync();
  }catch(e){ gFail(e); }
}
function gRemove(i){
  const a = G.accounts[i];
  if(a.session) fetch(`${G.server}/revoke`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({session: a.session})}).catch(() => {});
  else if(tokenOk(a)) try{ google.accounts.oauth2.revoke(a.token); }catch(e){}
  G.accounts.splice(i, 1); saveAccounts();
  if(i === 0){ G.listId = G.fileId = null; G.ready = false; }
  toast(`${a.email} desconectada`); gSync();
}
function gMakePrimary(i){
  G.accounts.unshift(G.accounts.splice(i, 1)[0]); saveAccounts();
  G.listId = G.fileId = null; G.ready = false; gSync();
}

/* ---------- API helper ---------- */
async function api(acc, url, opt = {}){
  if(!tokenOk(acc) && acc.session) await refreshAcc(acc);
  if(!tokenOk(acc)) throw Object.assign(new Error('expired'), {expired: true, acc});
  const headers = {Authorization: 'Bearer ' + acc.token, ...(typeof opt.body === 'string' ? {'Content-Type': 'application/json'} : {}), ...opt.headers};
  const r = await fetch(url, {...opt, headers});
  if(r.status === 401 && acc.session && !opt._retry){ acc.exp = 0; if(await refreshAcc(acc)) return api(acc, url, {...opt, _retry: true}); }
  if(r.status === 401){ acc.exp = 0; saveAccounts(); throw Object.assign(new Error('expired'), {expired: true, acc}); }
  if(!r.ok){ const t = await r.text(); throw new Error(`${r.status} · ${(t.match(/"message":\s*"([^"]+)/) || [,t])[1].slice(0,160)}`); }
  return r.status === 204 ? null : r.json();
}
function gFail(e){
  console.error('[Google]', e);
  if(e.expired){ G.status = 'La sesión de Google venció. Toca Reconectar.'; render(); return; }
  if(/^(Cerraste|El navegador bloqueó)/.test(e.message)){ toast(e.message); return; }   // a sign-in window, not a sync problem
  G.status = 'Error al sincronizar'; toast('Google: ' + e.message); render();
}

/* ---------- Sync everything ---------- */
async function gSync(){
  const acc = primary();
  if(!acc){ G.events = {}; G.status = ''; render(); return; }
  await Promise.all(G.accounts.filter(a => !tokenOk(a) && a.session).map(refreshAcc));
  if(!tokenOk(acc)){ G.status = 'La sesión de Google venció. Toca Reconectar.'; render(); return; }
  G.status = 'Sincronizando…'; render();
  try{
    await loadState(acc);
    await loadTasks(acc);
    await loadWeek();
    await loadMail();
    G.status = `Sincronizado a las ${nowHM()}`;
    if(gLoad('focusAlarm', null)?.end < Date.now()) gFocusCancel();   // clean up an alarm that already rang
  }catch(e){ return gFail(e); }
  render();
}

/* ---------- Drive: routine, habits, goals, hours, stars, streak, focus and preferences ---------- */
const STATE_V = 2;
const emptyHabits = () => Object.fromEntries(HABITS.map(h => [h.id, []]));
const snapshot = () => ({v: STATE_V, stars, routine, habits: HABITS, habit: {date: ymd(new Date()), log: habitLog}, habitHist, goals, budget, places, activity, counters, mailDone,
  focus: {...FOCUS}, prefs: {...S}});
function applyState(s){
  if(s.focus) Object.assign(FOCUS, s.focus);
  if(s.prefs) Object.assign(S, {quotes: s.prefs.quotes ?? S.quotes, sound: s.prefs.sound ?? S.sound, tz2: s.prefs.tz2 || "", profile: s.prefs.profile || ""});
  if(s.v !== STATE_V) s = {};    // data from the first version was sample data: start from zero, keep only preferences
  stars = typeof s.stars === "number" ? s.stars : 0;
  routine = s.routine || []; HABITS = s.habits || []; goals = s.goals || []; budget = s.budget || {};
  places = s.places || []; activity = s.activity || []; mailDone = s.mailDone || []; counters = {done: 0, habits: 0, focus: 0, reviews: 0, lastReview: "", ...s.counters};
  const cut = ymd(new Date(Date.now() - 21*864e5));
  habitHist = Object.fromEntries(Object.entries(s.habitHist || {}).filter(([d]) => d >= cut));
  const log = s.habit?.date === ymd(new Date()) ? s.habit.log || {} : {};
  habitLog = Object.fromEntries(HABITS.map(h => [h.id, log[h.id] || []]));
}
async function loadState(acc){
  const q = encodeURIComponent(`name='${STATE_FILE}'`);
  const f = (await api(acc, `${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id)`)).files[0];
  if(f){ G.fileId = f.id; applyState(await api(acc, `${DRIVE}/files/${f.id}?alt=media`)); lastSaved = JSON.stringify(snapshot()); }
  else { G.fileId = null; applyState({}); lastSaved = null; }   // first time: real data starts from zero
  G.ready = true;
}
let lastSaved = null, saveTimer;
async function saveState(json){
  const acc = primary(); if(!tokenOk(acc)) return;
  try{
    if(!G.fileId){
      const fd = new FormData();
      fd.append('metadata', new Blob([JSON.stringify({name: STATE_FILE, parents: ['appDataFolder']})], {type: 'application/json'}));
      fd.append('file', new Blob([json], {type: 'application/json'}));
      G.fileId = (await api(acc, `${UPLOAD}/files?uploadType=multipart&fields=id`, {method: 'POST', body: fd})).id;
    } else await api(acc, `${UPLOAD}/files/${G.fileId}?uploadType=media`, {method: 'PATCH', body: json});
    lastSaved = json;
  }catch(e){ gFail(e); }
}
// Called after every render: saves to Drive a moment after something changes
function gAfterRender(){
  if(!gOn() || !G.ready) return;
  const json = JSON.stringify(snapshot());
  if(json === lastSaved) return;
  gStore('state', JSON.parse(json));
  clearTimeout(saveTimer); saveTimer = setTimeout(() => saveState(json), 1500);
}

/* ---------- Google Tasks: the "Sisyphus" list ---------- */
const packNotes = x => (x.mail ? `Correo: ${x.mail}\n` : '') + `sisyphus:${JSON.stringify({v: x.v, s: x.s, p: x.p ? 1 : 0, when: x.when, eid: x.eid, mail: x.mail})}`;
const parseNotes = n => { const m = /sisyphus:(\{.*\})/.exec(n || ''); try{ return m ? JSON.parse(m[1]) : {}; }catch(e){ return {}; } };
async function listId(acc){
  if(G.listId) return G.listId;
  const lists = (await api(acc, `${TASKS}/users/@me/lists?maxResults=100`)).items || [];
  const l = lists.find(x => x.title === 'Sisyphus') || await api(acc, `${TASKS}/users/@me/lists`, {method: 'POST', body: JSON.stringify({title: 'Sisyphus'})});
  return G.listId = l.id;
}
function fromGTask(g){
  const m = parseNotes(g.notes), gs = guess(g.title), due = g.due ? new Date(g.due.slice(0,10) + 'T00:00') : null;
  const day = due ? idxOfDate(due) : -1;
  const when = m.when || (!due ? 'Sin fecha' : day === TODAY ? 'Hoy' : day >= 0 && day < 7 ? DAYS_FULL[day] : due.toLocaleDateString('es-ES', {day: 'numeric', month: 'short'}));
  return {t: g.title, v: m.v || gs.v, s: m.s || gs.size, p: !!m.p, done: g.status === 'completed', doneAt: g.completed || null, gid: g.id, eid: m.eid, mail: m.mail,
          day, when: !g.completed && due && day < TODAY ? `Atrasada · ${when}` : when};
}
async function loadTasks(acc){
  const id = await listId(acc), since = weekStart().toISOString();
  const r = await api(acc, `${TASKS}/lists/${id}/tasks?showCompleted=true&showHidden=true&maxResults=100&completedMin=${encodeURIComponent(since)}`);
  const open = await api(acc, `${TASKS}/lists/${id}/tasks?showCompleted=false&maxResults=100`);
  const byId = new Map([...(r.items || []), ...(open.items || [])].map(t => [t.id, t]));
  tasks = [...byId.values()].filter(t => t.title).map(fromGTask);
  inbox = [];
}

/* Slots look like "Lun · 09:15 Trabajo profundo", "Hoy · 23:15 …" or "Sáb · tarde" */
function slotDate(slot){
  const m = /^(Hoy|Lun|Mar|Mié|Jue|Vie|Sáb|Dom)\b(?:\s*·\s*(\d{1,2}):(\d{2}))?/.exec(slot || '');
  if(!m) return null;
  const d = gDay(new Date());
  if(m[1] !== 'Hoy'){ const add = (DAYS_FULL.indexOf(m[1]) - TODAY + 7) % 7 || 7; d.setDate(d.getDate() + add); }
  if(m[2] != null){ d.setHours(+m[2], +m[3]); if(+m[2] < 6) d.setDate(d.getDate() + 1); return {d, time: true}; }
  if(/tarde/.test(slot)){ d.setHours(16, 0); return {d, time: true}; }
  return {d, time: false};
}
const wallTime = d => `${ymd(d)}T${d.toTimeString().slice(0,8)}`;
// A new task in the app: Calendar event when it has a time, plus a Google Task with the due date
async function gTaskCreated(x, slot){
  const acc = primary(); if(!acc) return;
  const sd = slotDate(slot) || {d: dateOfIdx(x.day), time: false};
  x.day = idxOfDate(sd.d);
  try{
    if(sd.time){
      const end = new Date(sd.d.getTime() + ({S: 30, M: 60, L: 120}[x.s] || 60) * 6e4);
      const ev = await api(acc, `${CAL}/calendars/primary/events`, {method: 'POST', body: JSON.stringify({
        summary: x.t, description: `Creada desde Sisyphus · ${V[x.v][0]}`, colorId: GCOLOR[x.v],
        start: {dateTime: wallTime(sd.d), timeZone: mainTz()}, end: {dateTime: wallTime(end), timeZone: mainTz()},
        extendedProperties: {private: {sisyphus: '1'}}})});
      x.eid = ev.id;
    }
    const t = await api(acc, `${TASKS}/lists/${await listId(acc)}/tasks`, {method: 'POST', body: JSON.stringify({
      title: x.t, notes: packNotes(x), due: `${ymd(sd.d)}T00:00:00.000Z`})});
    x.gid = t.id;
    toast(sd.time ? 'Guardada en Google Tasks y Calendar' : 'Guardada en Google Tasks');
    if(sd.time) await loadWeek();
    render();
  }catch(e){ gFail(e); }
}
// A task dragged to another day in the Semana view: move its due date in Google Tasks
async function gTaskMoved(x){
  const acc = primary(); if(!acc || !x.gid) return;
  try{
    await api(acc, `${TASKS}/lists/${await listId(acc)}/tasks/${x.gid}`, {method: 'PATCH',
      body: JSON.stringify({due: `${ymd(dateOfIdx(x.day))}T00:00:00.000Z`, notes: packNotes(x)})});
    toast('Fecha actualizada en Google Tasks');
  }catch(e){ gFail(e); }
}
async function gTaskToggled(x){
  const acc = primary(); if(!acc || !x.gid) return;
  try{
    await api(acc, `${TASKS}/lists/${await listId(acc)}/tasks/${x.gid}`, {method: 'PATCH',
      body: JSON.stringify(x.done ? {status: 'completed'} : {status: 'needsAction', completed: null})});
  }catch(e){ gFail(e); }
}

/* Focus timer alarm: a one-minute event when the timer ends, with a pop-up reminder at that moment, so the phone
   notifies even with the app closed. It is deleted as soon as the timer is paused, reset or finished. */
async function gFocusAlarm(end, title){
  await gFocusCancel();
  const acc = primary(); if(!tokenOk(acc)) return;
  try{
    const ev = await api(acc, `${CAL}/calendars/primary/events`, {method: 'POST', body: JSON.stringify({
      summary: title, description: 'Aviso del temporizador de Sisyphus. Se borra solo.', transparency: 'transparent',
      start: {dateTime: end.toISOString(), timeZone: TZ}, end: {dateTime: new Date(end.getTime() + 60e3).toISOString(), timeZone: TZ},
      reminders: {useDefault: false, overrides: [{method: 'popup', minutes: 0}]}, extendedProperties: {private: {sisyphus: 'focus'}}})});
    gStore('focusAlarm', {id: ev.id, end: end.getTime()});
  }catch(e){ console.warn('[Google] aviso de enfoque', e.message); }
}
async function gFocusCancel(){
  const al = gLoad('focusAlarm', null), acc = primary();
  if(!al || !tokenOk(acc)) return;
  try{ await api(acc, `${CAL}/calendars/primary/events/${al.id}`, {method: 'DELETE'}); }catch(e){}
  if(gLoad('focusAlarm', {}).id === al.id) try{ localStorage.removeItem('sisyphus.focusAlarm'); }catch(e){}
}

/* ---------- Gmail (read-only): recent unread mail from the accounts where it is on, to turn into tasks ---------- */
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
G.mail = [];
async function gGmailOn(i){
  const a = G.accounts[i];
  if(G.server) return serverLogin(a.email, true);
  try{
    const r = await requestToken(a.email, 'consent', true);
    if(!google.accounts.oauth2.hasGrantedAllScopes(r, GMAIL_SCOPE)) return toast('Para usar Gmail, marca la casilla de leer tus correos');
    Object.assign(a, {gmail: true, token: r.access_token, exp: Date.now() + r.expires_in*1000}); saveAccounts();
    toast(`Gmail activo en ${a.email}`); await loadMail(); render();
  }catch(e){ gFail(e); }
}
function gGmailOff(i){ G.accounts[i].gmail = false; saveAccounts(); G.mail = G.mail.filter(m => m.acc !== G.accounts[i].email); toast('Gmail desactivado en esta cuenta'); render(); }
const header = (m, n) => (m.payload?.headers || []).find(h => h.name.toLowerCase() === n)?.value || '';
async function loadMail(){
  const out = [];
  for(const acc of G.accounts.filter(a => a.gmail && tokenOk(a))){
    try{
      const q = encodeURIComponent('in:inbox is:unread newer_than:14d -category:promotions -category:social -category:forums');
      const ids = (await api(acc, `${GMAIL}/messages?maxResults=15&q=${q}`)).messages || [];
      const msgs = await Promise.all(ids.map(x => api(acc, `${GMAIL}/messages/${x.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&fields=id,threadId,snippet,internalDate,payload/headers`)));
      msgs.forEach(m => {
        const from = header(m, 'from');
        out.push({id: m.id, thread: m.threadId, acc: acc.email, from: from.replace(/<.*>/, '').replace(/"/g, '').trim() || from, subject: header(m, 'subject') || '(Sin asunto)',
          snippet: (m.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'), date: new Date(+m.internalDate),
          link: `https://mail.google.com/mail/?authuser=${encodeURIComponent(acc.email)}#all/${m.threadId}`});
      });
    }catch(e){ if(!e.expired) console.warn('[Gmail]', acc.email, e.message); }
  }
  G.mail = out.sort((a, b) => b.date - a.date);
}

/* ---------- Google Calendar: this week's events from every account ---------- */
async function loadWeek(){
  const from = weekStart(), to = new Date(from); to.setDate(to.getDate() + 7);
  const out = {}, seen = new Set();
  for(const acc of G.accounts.filter(tokenOk)){
    try{
      const cals = ((await api(acc, `${CAL}/users/me/calendarList?minAccessRole=reader&fields=items(id,summary,selected,primary,timeZone)`)).items || []).filter(c => c.selected || c.primary);
      const own = cals.find(c => c.primary); if(own?.timeZone && acc.tz !== own.timeZone){ acc.tz = own.timeZone; saveAccounts(); }
      for(const c of cals){
        const r = await api(acc, `${CAL}/calendars/${encodeURIComponent(c.id)}/events?singleEvents=true&orderBy=startTime&maxResults=250` +
          `&timeMin=${encodeURIComponent(from.toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}&fields=items(summary,start,end,status,extendedProperties)`);
        for(const e of r.items || []){
          if(e.status === 'cancelled' || e.extendedProperties?.private?.sisyphus === 'focus') continue;
          const all = !!e.start.date, s = new Date(e.start.dateTime || e.start.date + 'T00:00'), en = new Date(e.end.dateTime || e.end.date + 'T00:00');
          const key = `${e.summary}|${s.getTime()}`; if(seen.has(key)) continue; seen.add(key);   // shared events show once
          (out[ymd(s)] ||= []).push({title: e.summary || '(Sin título)', s, e: en, all, acc: acc.email, cal: c.primary ? 'Principal' : c.summary, tz: c.timeZone || acc.tz});
        }
      }
    }catch(e){ if(e.expired) G.status = `La sesión de ${acc.email} venció. Toca Reconectar.`; else gFail(e); }
  }
  G.events = out;
}
// Real events for the Day view: all-day ones as chips, timed ones in the right half of the grid
function gDayEvents(i){
  const list = G.events[ymd(dateOfIdx(i))] || [], START = DAY_START, y = m => (m - START) * 0.95;
  const top = list.filter(e => e.all).map(e => `<span class="gchip">📅 ${escA(e.title)}</span>`).join('');
  const timed = list.filter(e => !e.all).map(e => {
    const a = Math.max(e.s.getHours()*60 + e.s.getMinutes(), START);
    const b = Math.min(Math.max(ymd(e.e) === ymd(e.s) ? e.e.getHours()*60 + e.e.getMinutes() : 24*60, a + 20), 24*60);
    return {...e, a, b};
  }).sort((p, q) => p.a - q.a || q.b - p.b);
  // Overlapping events share the right half side by side: each cluster gets as many lanes as it needs
  let cluster = [], lanes = [], clusterEnd = 0;
  const close = () => cluster.forEach(e => e.n = lanes.length);
  for(const e of timed){
    if(e.a >= clusterEnd){ close(); cluster = []; lanes = []; }
    let l = lanes.findIndex(end => end <= e.a); if(l < 0) l = lanes.length;
    lanes[l] = e.b; e.lane = l; cluster.push(e); clusterEnd = Math.max(clusterEnd, e.b);
  }
  close();
  const grid = timed.map(e => `<div class="ev gev" style="top:${y(e.a)}px;height:${Math.max(y(e.b) - y(e.a) - 3, 18)}px;width:calc(46% / ${e.n} - 4px);right:calc(6px + 46% * ${e.n - 1 - e.lane} / ${e.n})" title="${escA(e.acc)}">` +
    `<b>${escA(e.title)}</b><small>${fmt(e.a)}–${fmt(e.b)}${e.tz && e.tz !== mainTz() ? ` · ${e.s.toLocaleTimeString('es-ES', {timeZone: e.tz, hour: '2-digit', minute: '2-digit'})} ${tzShort(e.tz)}` : ''} · ${escA(e.cal)}</small></div>`).join('');
  return {top: top ? `<div class="gtop">${top}</div>` : '', grid};
}
const gWeekCount = i => (G.events[ymd(dateOfIdx(i))] || []).length;

/* ---------- UI pieces used by the views ---------- */
function gSettingsCard(){
  const accs = G.accounts;
  return `<div class="glass card">
    ${accs.map((a, i) => `<div class="set acc"><span class="who">${a.pic ? `<img src="${escA(a.pic)}" class="gav" referrerpolicy="no-referrer" alt="">` : '<span class="gav">👤</span>'}
        <span><b>${escA(a.email)}</b><span class="date">${a.tz ? `🕐 ${escA(tzCity(a.tz))} · ` : ''}${i === 0 ? 'Principal · tareas, progreso y calendario' : `Calendario · <a href="#" class="lnk" onclick="event.preventDefault();gMakePrimary(${i})">hacer principal</a>`}</span>
          ${G.server && needsSession(a) ? `<span class="date"><a href="#" class="lnk" onclick="event.preventDefault();serverLogin('${escA(a.email)}',${!!a.gmail})">🔒 ${a.session ? 'Renovar sesión (una sola vez)' : 'Activar sesión sin vencimiento'}</a></span>` : ''}
          <span class="date">${a.gmail ? `✉️ Gmail activo · <a href="#" class="lnk" onclick="event.preventDefault();gGmailOff(${i})">desactivar</a>` : `<a href="#" class="lnk" onclick="event.preventDefault();gGmailOn(${i})">✉️ Activar Gmail</a>`}</span></span></span>
        <span class="row" style="gap:6px">${tokenOk(a) || a.session ? '<span class="pill live">Conectada</span>' : `<button class="btn" onclick="gConnect('${escA(a.email)}')">Reconectar</button>`}
        <button class="ic gx" onclick="gRemove(${i})" aria-label="Desconectar">×</button></span></div>`).join('')}
    <div class="set"><span class="date">${accs.length ? escA(G.status) : 'Conecta tu cuenta para usar tus tareas y tu calendario reales.'}</span>
      <span class="row" style="gap:6px">${accs.length ? '<button class="btn" onclick="gSync()">↻</button>' : ''}<button class="btn p" onclick="gConnect()">+ Cuenta de Google</button></span></div>
    ${claudeSettingsRow()}</div>`;
}
function gHomeNote(){
  const a = primary();
  if(!a) return '';
  if(!tokenOk(a) && a.session) return '';   // renewing by itself
  if(!tokenOk(a)) return `<div class="glass card alert" style="cursor:pointer"><div class="row"><span style="font-size:20px">🔑</span><div class="grow"><b>Toca para reconectar Google</b><div class="date">Google cierra la sesión cada hora por seguridad. Se abre una ventanita que se cierra sola; tus datos están a salvo.</div></div></div></div>`;
  return `<p class="note">Conectado a Google · ${escA(G.status)}</p>`;
}

/* Google gives browser-only apps one-hour sessions. Renew them on the next tap anywhere in the app:
   a Google window opens and closes by itself (browsers only allow it right after a tap). One account per tap. */
document.addEventListener('pointerdown', e => {
  if(G.renewing || !window.google?.accounts?.oauth2 || e.target.closest('[onclick^="gConnect"]')) return;
  const a = G.accounts.find(x => !x.session && x.exp < Date.now() + 5*60e3);
  if(a) gRenew(a);
}, true);
async function gRenew(a){
  G.renewing = true;
  try{
    const r = await requestToken(a.email, '', a.gmail);   // the window opens synchronously, inside the tap
    a.token = r.access_token; a.exp = Date.now() + r.expires_in*1000; saveAccounts();
    if(a === primary() && !G.ready) await gSync(); else { await loadWeek(); render(); }
  }catch(e){ console.warn('[Google] renovación', e.message); }
  finally{ G.renewing = false; }
}

/* Start: restore the last saved progress right away, then refresh from Google */
window.addEventListener('DOMContentLoaded', () => {
  serverReturn();
  if(!gOn()) return render();
  const cached = gLoad('state', null);
  if(cached){ applyState(cached); G.ready = false; }
  tasks = []; inbox = [];
  render();
  const start = () => window.google?.accounts?.oauth2 ? gSync() : setTimeout(start, 300);
  start();
});
