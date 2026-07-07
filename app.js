const money = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const pct = n => `${(Number(n)||0).toFixed(2).replace('.',',')}%`;
const brl = n => money.format(Number(n)||0);
function formatInputDecimal(n){
  const num = Number(n)||0;
  return num.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}
function parseVal(v){
  let s = String(v ?? '').trim();
  if (!s) return 0;
  s = s.replace(/R\$/g,'').replace(/\s/g,'').replace(/[^\d,.-]/g,'');

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // Formato BR: 150.000,50
    s = s.replace(/\./g,'').replace(',', '.');
  } else if (hasComma) {
    // Formato BR sem milhar: 150000,50 ou 2,5
    s = s.replace(',', '.');
  } else if (hasDot) {
    const parts = s.split('.');
    // Se tiver mais de um ponto, trata como separador de milhar: 150.000.000
    if (parts.length > 2) s = parts.join('');
    // Se tiver apenas um ponto, mantém como decimal: 2.5 ou 150000.50
  }

  return Number(s) || 0;
}

const AUTH_SESSION_KEY = 'farmaisAuthSession';

const EXTRA_SALES_CATEGORIES = [
  {key:'ppv', label:'PPV'},
  {key:'genericoSimilar', label:'GENÉRICO/SIMILAR'},
  {key:'vitamina', label:'VITAMINA'},
  {key:'aplicacao', label:'APLICAÇÃO'},
  {key:'perfuracaoLobulo', label:'PERFURAÇÃO LÓBULO'}
];

function normalizeClientUsername(username){
  return String(username || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/\s+/g,'-')
    .replace(/[^a-z0-9._-]/g,'')
    .slice(0,60) || 'sem-login';
}


function normalizeExtraTotalsForEmployee(employeeId){
  state.extraTotals ||= {};
  state.extraTotals[employeeId] ||= {};

  const row = state.extraTotals[employeeId];
  const legacyGeneric = parseVal(row.generico);
  const legacySimilar = parseVal(row.similar);
  const currentCombined = parseVal(row.genericoSimilar);

  // Migra valores antigos de GENÉRICO e SIMILAR para o campo único.
  // Remove as chaves antigas para não somar duas vezes em próximos salvamentos.
  if((legacyGeneric || legacySimilar) && !currentCombined){
    row.genericoSimilar = Number((legacyGeneric + legacySimilar).toFixed(2));
  }

  delete row.generico;
  delete row.similar;

  EXTRA_SALES_CATEGORIES.forEach(cat=>{
    if(row[cat.key] === undefined){
      row[cat.key] = 0;
    }
  });
}

function employeeExtraTotal(employeeId){
  const row = state.extraTotals && state.extraTotals[employeeId] ? state.extraTotals[employeeId] : {};
  return EXTRA_SALES_CATEGORIES.reduce((sum,cat)=>sum + parseVal(row[cat.key]), 0);
}

function getCurrentUsername(){
  try{
    const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
    return session && session.username ? normalizeClientUsername(session.username) : 'sem-login';
  }catch{
    return 'sem-login';
  }
}


function sanitizeNumberInput(value){
  let v = String(value ?? '');

  // Permite somente números, ponto e vírgula.
  v = v.replace(/[^0-9.,]/g, '');

  // Se houver mais de um separador, mantém o último como decimal.
  // Exemplos:
  // 1.265,91 -> 1265,91
  // 1,265.91 -> 1265.91
  const lastComma = v.lastIndexOf(',');
  const lastDot = v.lastIndexOf('.');
  const lastSep = Math.max(lastComma, lastDot);

  if(lastSep >= 0){
    const integerPart = v.slice(0, lastSep).replace(/[.,]/g, '');
    const decimalPart = v.slice(lastSep + 1).replace(/[.,]/g, '');
    const sep = v[lastSep];
    v = integerPart + sep + decimalPart;
  }

  return v;
}

function isDayOff(day){
  const row = state.sales[day] || {};
  return row.__status === 'folga';
}

function setDayOff(day){
  state.sales[day] ||= {};
  state.sales[day].__status = 'folga';
  state.employees.forEach(e=>{
    state.sales[day][e.id] = 'folga';
  });
}

function clearDayOff(day){
  state.sales[day] ||= {};
  delete state.sales[day].__status;
  state.employees.forEach(e=>{
    if(String(state.sales[day][e.id] ?? '').toLowerCase() === 'folga'){
      state.sales[day][e.id] = 0;
    }
  });
}


const SPECIAL_DAY_VALUES = ['folga','falta','atestado'];

function normalizeSpecialValue(value){
  const normalized = String(value ?? '').trim().toLowerCase();
  return SPECIAL_DAY_VALUES.includes(normalized) ? normalized : '';
}

function getCellSpecialValue(day, employeeId){
  const row = state.sales[day] || {};
  return normalizeSpecialValue(row[employeeId]);
}

function setCellSpecialValue(day, employeeId, status){
  state.sales[day] ||= {};
  const normalized = normalizeSpecialValue(status);
  if(normalized){
    state.sales[day][employeeId] = normalized;
  }
}

function clearCellSpecialValue(day, employeeId){
  state.sales[day] ||= {};
  if(normalizeSpecialValue(state.sales[day][employeeId])){
    state.sales[day][employeeId] = 0;
  }
}

function specialValueLabel(status){
  const normalized = normalizeSpecialValue(status);
  if(normalized === 'folga') return 'folga';
  if(normalized === 'falta') return 'falta';
  if(normalized === 'atestado') return 'atestado';
  return '';
}

function currentMonth(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function employeeId(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `emp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const defaultState = {
  settings:{month:currentMonth(), workDays:0, monthlyGoal:0, prize:0},
  employees:[],
  sales:{},
  extraTotals:{},
  updatedAt:null
};

const STORAGE_PREFIX = 'metasVendasSite';
function currentMonthKey(username=getCurrentUsername()){
  return `${STORAGE_PREFIX}:currentMonth:${username}`;
}

function storageKey(month, username=getCurrentUsername()){
  return `${STORAGE_PREFIX}:${username}:${month}`;
}

function cloneState(obj){
  return JSON.parse(JSON.stringify(obj));
}

function normalizeState(raw, month){
  const base = cloneState(defaultState);
  const data = raw && typeof raw === 'object' ? raw : {};
  const normalized = {
    settings:{...base.settings, ...(data.settings || {})},
    employees:Array.isArray(data.employees) ? data.employees : base.employees,
    sales:data.sales && typeof data.sales === 'object' ? data.sales : {},
    extraTotals:data.extraTotals && typeof data.extraTotals === 'object'
      ? data.extraTotals
      : (data.extraSalesTotals && typeof data.extraSalesTotals === 'object' ? data.extraSalesTotals : {}),
    updatedAt:data.updatedAt || null
  };

  normalized.settings.month = month || normalized.settings.month || currentMonth();
  normalized.settings.workDays = parseVal(normalized.settings.workDays);
  normalized.settings.monthlyGoal = parseVal(normalized.settings.monthlyGoal);
  normalized.settings.prize = parseVal(normalized.settings.prize);

  const employeeCount = Math.max(1, normalized.employees.length);
  const fallbackTarget = normalized.settings.monthlyGoal ? (normalized.settings.monthlyGoal / employeeCount) : 0;
  const fallbackDaily = fallbackTarget / Math.max(1, normalized.settings.workDays);

  normalized.employees = normalized.employees.map(e=>{
    const targetValue = e.target ?? e.metaIndividual ?? e.individualTarget ?? e.goal;
    const dailyValue = e.daily ?? e.metaDiaria ?? e.dailyGoal;
    const target = targetValue === undefined || targetValue === null || targetValue === '' ? fallbackTarget : parseVal(targetValue);
    const daily = dailyValue === undefined || dailyValue === null || dailyValue === '' ? fallbackDaily : parseVal(dailyValue);

    return {
      id:e.id || employeeId(),
      name:e.name ?? '',
      role:e.role ?? '',
      percent:parseVal(e.percent),
      target,
      daily
    };
  });

  // Migração: versões anteriores tinham vendas extras por dia.
  // Agora a aba de extras guarda somente o total mensal por funcionário/categoria.
  if(Object.keys(normalized.extraTotals).length === 0 && data.extraSales && typeof data.extraSales === 'object'){
    Object.values(data.extraSales).forEach(dayRow=>{
      if(!dayRow || typeof dayRow !== 'object') return;
      Object.entries(dayRow).forEach(([employeeId, cats])=>{
        if(!cats || typeof cats !== 'object') return;
        normalized.extraTotals[employeeId] ||= {};
        normalized.extraTotals[employeeId].ppv = parseVal(normalized.extraTotals[employeeId].ppv) + parseVal(cats.ppv);
        normalized.extraTotals[employeeId].genericoSimilar = parseVal(normalized.extraTotals[employeeId].genericoSimilar) + parseVal(cats.genericoSimilar) + parseVal(cats.generico) + parseVal(cats.similar);
        normalized.extraTotals[employeeId].vitamina = parseVal(normalized.extraTotals[employeeId].vitamina) + parseVal(cats.vitamina);
        normalized.extraTotals[employeeId].aplicacao = parseVal(normalized.extraTotals[employeeId].aplicacao) + parseVal(cats.aplicacao);
        normalized.extraTotals[employeeId].perfuracaoLobulo = parseVal(normalized.extraTotals[employeeId].perfuracaoLobulo) + parseVal(cats.perfuracaoLobulo);
      });
    });
  }

  normalized.employees.forEach(e=>{
    normalized.extraTotals[e.id] ||= {};

    const row = normalized.extraTotals[e.id];
    const legacyGeneric = parseVal(row.generico);
    const legacySimilar = parseVal(row.similar);
    const currentCombined = parseVal(row.genericoSimilar);

    if((legacyGeneric || legacySimilar) && !currentCombined){
      row.genericoSimilar = Number((legacyGeneric + legacySimilar).toFixed(2));
    }

    delete row.generico;
    delete row.similar;

    EXTRA_SALES_CATEGORIES.forEach(cat=>{
      if(row[cat.key] === undefined){
        row[cat.key] = 0;
      }
    });
  });

  return normalized;
}

function createMonthState(month, baseState){
  const base = baseState ? cloneState(baseState) : cloneState(defaultState);
  return normalizeState({
    settings:{...base.settings, month},
    employees:Array.isArray(base.employees) ? base.employees : [],
    sales:{},
    extraTotals:{},
    updatedAt:new Date().toISOString()
  }, month);
}

function loadLocalMonth(month){
  try{
    const saved = localStorage.getItem(storageKey(month));
    if(saved) return normalizeState(JSON.parse(saved), month);
  }catch{}

  // Migração do salvamento antigo para o novo formato mensal.
  try{
    const legacy = localStorage.getItem(STORAGE_PREFIX);
    if(legacy){
      const legacyState = normalizeState(JSON.parse(legacy), month);
      if(legacyState.settings.month === month){
        localStorage.setItem(storageKey(month), JSON.stringify(legacyState));
        return legacyState;
      }
    }
  }catch{}

  return null;
}

function loadInitial(){
  const month = currentMonth();

  // Quando há login, a nuvem será carregada logo em seguida.
  // Começamos com estado limpo para evitar mostrar/salvar cache antigo do navegador.
  if(getCurrentUsername() !== 'sem-login'){
    return createMonthState(month);
  }

  return loadLocalMonth(month) || createMonthState(month);
}

let cloudSaveTimer = null;
let cloudAutoSyncTimer = null;
let lastCloudSavedAt = 0;
let cloudReady = false;
let appReady = false;
let state = loadInitial();

function saveLocal(touch=true){
  if(touch) state.updatedAt = new Date().toISOString();
  localStorage.setItem(currentMonthKey(), state.settings.month);
  localStorage.setItem(storageKey(state.settings.month), JSON.stringify(state));
}

async function apiRequest(method, month, data){
  if (location.protocol === 'file:') return null;

  const options = {
    method,
    headers:{'Content-Type':'application/json'}
  };

  if (method !== 'GET') {
    options.body = JSON.stringify({month, user:getCurrentUsername(), data});
  }

  const username = getCurrentUsername();
  if(username === 'sem-login') return null;
  const response = await fetch(`/api/monthly-data?month=${encodeURIComponent(month)}&user=${encodeURIComponent(username)}`, options);
  if (!response.ok) {
    const errorText = await response.text().catch(()=>'');
    throw new Error(errorText || `Erro ${response.status}`);
  }
  return response.json();
}


async function apiCurrentMonth(method='GET', month=null){
  if (location.protocol === 'file:') return null;

  const username = getCurrentUsername();
  if(username === 'sem-login') return null;

  const options = {
    method,
    headers:{'Content-Type':'application/json'}
  };

  if(method !== 'GET'){
    options.body = JSON.stringify({month});
  }

  const response = await fetch(`/api/monthly-data?month=current&user=${encodeURIComponent(username)}`, options);
  if(!response.ok) return null;
  return response.json();
}

async function getCloudCurrentMonth(){
  try{
    const response = await apiCurrentMonth('GET');
    return response && response.currentMonth ? response.currentMonth : null;
  }catch{
    return null;
  }
}

async function setCloudCurrentMonth(month){
  try{
    if(month) await apiCurrentMonth('POST', month);
  }catch{}
}

async function loadFromUpstash(month){
  try{
    const response = await apiRequest('GET', month);
    cloudReady = true;
    if(response && response.data) return normalizeState(response.data, month);
  }catch(err){
    console.warn('Upstash indisponível, usando salvamento local:', err.message);
  }
  return null;
}

async function saveToUpstash(force=false){
  if(getCurrentUsername() === 'sem-login') return;

  // Evita que o estado inicial vazio sobrescreva os dados salvos
  // quando a página é recarregada antes de terminar o carregamento.
  if(!appReady && !force) return;

  try{
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(currentMonthKey(), state.settings.month);
    localStorage.setItem(storageKey(state.settings.month), JSON.stringify(state));

    await apiRequest('POST', state.settings.month, state);
    await setCloudCurrentMonth(state.settings.month);
    lastCloudSavedAt = Date.now();
    cloudReady = true;
  }catch(err){
    console.warn('Não foi possível salvar no Upstash agora:', err.message);
  }
}


async function saveNowToCloud(){
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = null;
  await saveToUpstash();
}

function scheduleCloudSave(){
  if(getCurrentUsername() === 'sem-login') return;
  clearTimeout(cloudSaveTimer);

  // No celular, timers podem atrasar ao trocar de aba/app.
  // Por isso o salvamento fica mais rápido.
  cloudSaveTimer = setTimeout(async ()=>{
    cloudSaveTimer = null;
    await saveToUpstash();
  }, 350);
}

function save(){
  saveLocal();
  scheduleCloudSave();
  renderAll();
}

window.addEventListener('beforeunload', ()=>{
  if(getCurrentUsername() !== 'sem-login') saveToUpstash();
});

window.addEventListener('pagehide', ()=>{
  if(getCurrentUsername() !== 'sem-login') saveToUpstash();
});

document.addEventListener('visibilitychange', ()=>{
  if(document.hidden && getCurrentUsername() !== 'sem-login'){
    saveNowToCloud();
  }
});


async function loadMonth(month){
  const previousScreen = document.querySelector('.screen.active')?.id || 'resultados';
  const targetMonth = month || currentMonth();

  const cloudState = await loadFromUpstash(targetMonth);
  const localState = loadLocalMonth(targetMonth);

  let selectedState = null;
  let shouldSendLocalToCloud = false;

  if(cloudState && localState){
    const cloudTime = cloudState.updatedAt ? Date.parse(cloudState.updatedAt) : 0;
    const localTime = localState.updatedAt ? Date.parse(localState.updatedAt) : 0;

    if(localTime > cloudTime){
      selectedState = localState;
      shouldSendLocalToCloud = true;
    }else{
      selectedState = cloudState;
    }
  }else if(cloudState){
    selectedState = cloudState;
  }else if(localState){
    selectedState = localState;
    shouldSendLocalToCloud = true;
  }else{
    selectedState = createMonthState(targetMonth);
    shouldSendLocalToCloud = true;
  }

  state = selectedState;
  ensureDays();
  saveLocal(false);
  renderAll();
  switchScreen(previousScreen);
  await setCloudCurrentMonth(targetMonth);

  appReady = true;

  if(shouldSendLocalToCloud){
    await saveToUpstash(true);
  }
}

async function initCloudSync(){
  const sharedMonth = await getCloudCurrentMonth();
  const monthToLoad = sharedMonth || currentMonth();
  await loadMonth(monthToLoad);
  appReady = true;
}


async function refreshFromCloud(){
  if(getCurrentUsername() === 'sem-login') return;
  if(cloudSaveTimer) return;
  if(Date.now() - lastCloudSavedAt < 1200) return;

  // Não puxa nuvem enquanto o usuário está digitando em algum campo.
  if(document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;

  const activeScreen = document.querySelector('.screen.active')?.id || 'resultados';
  const month = state.settings?.month || await getCloudCurrentMonth() || currentMonth();
  const cloudState = await loadFromUpstash(month);

  if(!cloudState) return;

  const localTime = state.updatedAt ? Date.parse(state.updatedAt) : 0;
  const cloudTime = cloudState.updatedAt ? Date.parse(cloudState.updatedAt) : 0;

  if(cloudTime > localTime){
    state = cloudState;
    ensureDays();
    saveLocal(false);
    renderAll();
    switchScreen(activeScreen);
  }
}


function handleCloudCommitFromField(event){
  const target = event.target;
  if(!target || !target.matches || !target.matches('input, select, textarea')) return;
  if(getCurrentUsername() === 'sem-login') return;

  // Garante que alterações feitas no celular sejam enviadas quando o teclado fecha
  // ou o campo perde foco, mesmo que o timer normal não rode.
  saveNowToCloud();
}

document.addEventListener('change', handleCloudCommitFromField, true);
document.addEventListener('blur', handleCloudCommitFromField, true);

function startAutoCloudSync(){
  stopAutoCloudSync();
  if(getCurrentUsername() === 'sem-login') return;
  cloudAutoSyncTimer = setInterval(()=>refreshFromCloud(), 5000);
}

function stopAutoCloudSync(){
  if(cloudAutoSyncTimer){
    clearInterval(cloudAutoSyncTimer);
    cloudAutoSyncTimer = null;
  }
}

window.addEventListener('focus', ()=>refreshFromCloud());
document.addEventListener('visibilitychange', ()=>{
  if(!document.hidden) refreshFromCloud();
});

function daysInMonth(month){const [y,m]=month.split('-').map(Number);return new Date(y,m,0).getDate();}
function ensureDays(){
  const total=daysInMonth(state.settings.month);
  let changed=false;

  if(!state.sales || typeof state.sales !== 'object'){
    state.sales={};
    changed=true;
  }

  if(!state.extraTotals || typeof state.extraTotals !== 'object'){
    state.extraTotals={};
    changed=true;
  }

  // Remove dias que não existem no mês selecionado.
  Object.keys(state.sales).forEach(day=>{
    if(Number(day)>total){
      delete state.sales[day];
      changed=true;
    }
  });

  // Garante que todos os dias válidos do mês existam para lançamentos diários.
  for(let d=1;d<=total;d++){
    if(!state.sales[d]){
      state.sales[d]={};
      changed=true;
    }

    state.employees.forEach(e=>{
      if(state.sales[d][e.id] === undefined){
        state.sales[d][e.id]=0;
        changed=true;
      }
    });
  }

  // Garante totais mensais das vendas extras por funcionário e categoria.
  const employeeIds = new Set(state.employees.map(e=>e.id));

  Object.keys(state.extraTotals).forEach(id=>{
    if(!employeeIds.has(id)){
      delete state.extraTotals[id];
      changed=true;
    }
  });

  state.employees.forEach(e=>{
    const before = JSON.stringify(state.extraTotals[e.id] || {});
    normalizeExtraTotalsForEmployee(e.id);
    const after = JSON.stringify(state.extraTotals[e.id] || {});
    if(before !== after){
      changed=true;
    }
  });

  if(changed){
    saveLocal();
  }
}
function recalcEmployeeGoals(){
  const totalPercent = state.employees.reduce((sum,e)=>sum+parseVal(e.percent),0);
  const count = Math.max(1, state.employees.length);
  const days = Math.max(1, parseVal(state.settings.workDays) || 1);

  state.employees.forEach(e=>{
    const share = totalPercent > 0 ? (parseVal(e.percent) / totalPercent) : (1 / count);
    const target = (parseVal(state.settings.monthlyGoal) || 0) * share;
    e.target = Number(target.toFixed(2));
    e.daily = Number((target / days).toFixed(2));
  });
}

function employeeTarget(e){return parseVal(e.target)}
function employeeDaily(e){return parseVal(e.daily)}
function dailyCellValue(v){
  const special = normalizeSpecialValue(v);
  if(special) return specialValueLabel(special);
  if(v === undefined || v === null || v === 0 || v === '0') return '';
  return String(v);
}
function employeeSold(id){return Object.values(state.sales).reduce((sum,row)=>sum+parseVal(row[id]),0)}
function totalSold(){return state.employees.reduce((sum,e)=>sum+employeeSold(e.id),0)}
function launchedDays(){return Object.values(state.sales).filter(row=>Object.values(row).some(v=>parseVal(v)>0)).length}

const downloadIconHtml = `<svg class="btn-icon bi bi-download" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.6a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-2.6a.5.5 0 0 1 1 0v2.6A1.5 1.5 0 0 1 14.5 14.5h-13A1.5 1.5 0 0 1 0 13v-2.6a.5.5 0 0 1 .5-.5"/><path d="M7.646 10.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 9.293V1.5a.5.5 0 0 0-1 0v7.793L5.354 7.146a.5.5 0 1 0-.708.708z"/></svg>`;
function setPrintButtonLabel(text){
  const printBtn = document.getElementById('printCurrentBtn');
  if (!printBtn) return;
  printBtn.innerHTML = `${downloadIconHtml}<span>${text}</span>`;
}

function switchScreen(id){
  document.querySelectorAll('.screen').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.nav').forEach(el=>el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll(`[data-screen="${id}"]`).forEach(el=>el.classList.add('active'));
  const titles={
    resultados:['Resultados','Resumo geral das vendas, metas e desempenho.'],
    metas:['Metas do mês','Configure meta, premiação e distribuição por funcionário.'],
    lancamentos:['Lançamentos diários','Informe as vendas por dia e por funcionário.'],
    extras:['Vendas extras','Lance PPV, Genérico, Similar, Vitamina, Aplicação e Perfuração lóbulo.']
  };
  screenTitle.textContent=titles[id][0];
  screenSubtitle.textContent=titles[id][1];
  closeTooltipItems();

  const printBtn = document.getElementById('printCurrentBtn');
  const vouchersBtn = document.getElementById('printVouchersBtn');
  if (printBtn) {
    if (id === 'resultados') {
      setPrintButtonLabel('Imprimir resultados');
      printBtn.classList.remove('hidden-print-cta');
      printBtn.dataset.printScreen = 'resultados';
    } else if (id === 'lancamentos') {
      setPrintButtonLabel('Imprimir lançamentos');
      printBtn.classList.remove('hidden-print-cta');
      printBtn.dataset.printScreen = 'lancamentos';
    } else if (id === 'extras') {
      setPrintButtonLabel('Imprimir vendas extras');
      printBtn.classList.remove('hidden-print-cta');
      printBtn.dataset.printScreen = 'extras';
    } else {
      printBtn.classList.add('hidden-print-cta');
      printBtn.dataset.printScreen = '';
    }
  }
  if (vouchersBtn) {
    vouchersBtn.classList.toggle('hidden-print-cta', id !== 'resultados');
  }
}
document.querySelectorAll('.nav').forEach(btn=>btn.onclick=()=>switchScreen(btn.dataset.screen));

function closeTooltipItems(){
  document.querySelectorAll('.tooltip-item').forEach(item=>{
    item.classList.remove('is-open');
    const btn = item.querySelector('.tooltip-toggle');
    if(btn) btn.setAttribute('aria-expanded','false');
  });
}
/* Tooltip somente por hover/cursor */
document.querySelectorAll('.tooltip-toggle').forEach(btn=>{
  btn.addEventListener('click', (event)=>{
    event.preventDefault();
    event.stopPropagation();
    closeTooltipItems();
  });
});



const printCurrentBtn = document.getElementById('printCurrentBtn');
if (printCurrentBtn) {
  printCurrentBtn.addEventListener('click', () => {
    const target = printCurrentBtn.dataset.printScreen || 'resultados';
    document.body.classList.add('print-mode', `print-${target}`);
    setTimeout(() => window.print(), 80);
  });
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('print-mode', 'print-resultados', 'print-lancamentos');
});




/* Comprovantes de bonificação em PDF/Impressão */
const printVouchersBtn = document.getElementById('printVouchersBtn');
const voucherLogoDataUri = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAhYAAADrCAYAAAA11N89AAEAAElEQVR4nOy9d6BlWVXn/1l7n3PvfaFCV3V3dYXO0AJNDg00SBJR0RFGHAVRDGAYf4px1HF+Oo5jDhhHHB3j6G8MDOoYRx1BaJLQ3SBI7ACdU3WlF244e6/fHzue+97rLugqkPGu7lv3vnvP2WfHtb4r7LVhQQta0IIWtKAFLWhBC1rQgha0oAUtaEELWtCCFrSgBS1oQQta0IIWtKAFLWhBC1rQgha0oAUtaEELWtCCFrSgBS1oQQta0IIWtKAFLWhBC1rQgha0oAUtaEELWtCCFrSgBS1oQQta0IIWtKAFLWhBC1rQgha0oAUtaEELWtCCFrSgBS1oQQta0IIWtKAFLWhBC1rQgha0oAUtaEELWtCCFrSgBS1oQQta0IIWtKAFLWhBC1rQgha0oAUtaEELWtCCFrSgBS1oQQta0IIWtKAFLWhBC1rQgha0oAUtaEELWtCCFvTpQvKprsCnM73l0MGBel3G66r3fqCqVhVERABERI1IZ4yZipGxiFl/2h23jT/V9V7Qgha0oAUt6GzRAlg8AL3r0AWN8+x2mP0Yu98Ye5FRPSzeH/JeLrJiDhgv5xqxezuvw853VhAVAUEwxnijzIyRqaATLMfGs9k9Tme3yKC5XY2533t3n/rudsHf/oy77rn1U93mBS1oQQta0IIeCi2AxRxdf+GhVe/84c7ZxxrVJ6ppntza5hJPe8CI2TXQjkYdgseIIICooCjOe9SDEcGIIoTvJfayInigQ3BGmGHo0LEyvWs6c7cp7h/E2OsHhne1TfPRJ9xyy8K6saAFLWhBC/q0ogWwAN5z+OCyV3O5Efksp/Jca80jvTaX7dKpbQFQPAbB4lUAg0oACih4MaiCqq9K1QA6JHSyqiIiKAA+dLwAODChHFWY+mYs2t3a4W+QljdNnL5NhH988u23Hvtk9smCFrSgBS1oQZ8I/YsGFu85dPBhzvH5xrQvMs3giauie1rfoT6AANTixOBE8BrcGxK7TNH4l6IEUCCieB+gg/R6VgGDAh6IvpIIPRQjilWl8Z4GaNRjDExUOCFmo1N9x8x3f9k08von3PaxGz+ZfbSgBS1oQQta0MdD/+KAxbsOHrygMfa54s3L2sHg6hHs3+WmOO9xNHRi6bCQQUS0NGiAAUaC9SGaIWKp4V01mh3ifQogggqgwVoRYUf+TYRcVnCreBoRLB4rHqseFcPYLDHD3D5V/+4p099zbvbnT7r9loUVY0ELWtCCFvTPiv7FAIvrDx2+VNGXG22/dNguPXq3jhFVnFicWmYoKgZREDHgfXRlSEIDwa2hPtssSu9FYOE1Py/hix6YkPI5GjHC9yhGBGLZYoJVw4hB8LTRomEANQ1r2p5a76bXrrvJ/2rU/d5T7rz9zrPaeQta0IIWtKAFnSb9Xw8srrvg8MNHrX2ZN8OX75LZFUszh1PL2Bo60+AV8CnYEkDAB3Ef3BkaMIRE60W0VkhGG/FBqjlOIpOAVw0Wi8pKkd7TfRp3kQTriCIKxsTvQkhHcMdIg1VH6xWcYcNLN9Hp+5HuLzan7jeees8dHz6rnbmgBS1oQQta0IPQ/7XA4t2HLj44sOabnNqXjWx76bKfIXg2afASYyQ0Nl9MdkUkQ0TpGM2fBS2AIn9OpolotUi/qpars+VCyL4Pyc6SQhGwmBTJEcwnoRxjcBgUjyg0Dpa6GULHBi0bTm86Pp3+ejPg55529+1rZ7Y3F7SgBS1oQQs6Pfq/Dli8+8il5w9N8wJov2lo3FNXppt0ZshELE4EjZaJEDORAjALIEAlg4f8nrweyaqhBVRoZcWIP4X38mvlCimQJQEOSBaL8IVEt4hQLBaKRINI3L4KiFOMehrnsF2IxzjWrugpP3vnxE1+RoQ/vfqeO9bPTi8vaEELWtCCFrQ9/V8FLN51+GFfPGzbrxo27fOXx+tDh6UzlcQ3gmoNIwIoSDs9fHRPSPZy5IiIvvsjWTdQVLT6m+gOie6PZLWQPlTJV6eqxXcjBcRkCJLdKHEHSnS3mOh3EZea4zHqEYRj1mycms7+zqv/sc88esdbHnrPLmhBC1rQghZ0evR/BbC49tAl5zZeXj5a3f0dS258oZ14JmJQa/Ea4xaIwMITQIKWsMraI5H2dCASAUaJtai3kCbLRykLstSPAKAPLIrjJFkfkosEwu4QicDCxDokgFO2poY/YrWCRaRqhvfBijFyM5wVjhlz12S6+YtY+YWn3X3XyTPS2Qta0IIWtKAFPQB92gOLdx687KqBtD80agbP38tYJt4ywyJSnBGYGFgZkUByhRRgoRXGyH4JjIkCP15rEgyIQMPEOpj0nFycxpwVAVj4HJ0RMm+iEvNZxMI0JdJSjEqM19Qc71EHeyaLRw4ELVgm1iEEfzbiWXZjTrQNJ5z7624y+6FnHL37zWd+BBa0oAUtaEELKvRpCyyuP3yhdZ28ajTY9e8PeHdx5x1TY/DGgjGod8H6YEJGzBTTIDHQMoVaamVtkJijQozBNm1wPrguuEskAAkTLRe9XSSSUUnYUqrg5kCFj2DCp1iJdEtMjmGMwRqBWYc6H59TQJCKhIslbIstQaJk9BE+a0wx7jHes+ynOCPcr/b2mZv8KFZ++Sl33O7O+gAtaEELWtCC/kXSpyWweM/hC1f8zHzPcGn1O/d3k9EmAzpRbHJZGBPBRAjWhCJ0wx/BOuCTlUGKlcGIYAF/z1GYdphBg1iDGMJ78llUrhGlmA1UI3jQAFrUhXevMcjTBwuIeh+2o4qAsXjnMI3Q7NpDu7wL5xw+7gpJubhyMGflk8nAqN5l4jXuLlHECwZYth3Hm8Ha+nT6Pzr0Pz3lto/dfnZHaUELWtCCFvQvkT7tgMW7D1+0v3HyA6PB7m/aNRtzwhiwDYKLqbANPsZRlIRUiTQK6PBtclWEvRYe4yyins3ja+x+7vPY++ynY87dC9aEpFlNAAFYE7eBRh+G+uIK0SLcSQDC+/C3V8QrqAfnQ8wHgDrc0fuZ3nQTp974JtzREwyXVnFW8QKCKaaJBCqyj6S4dFRKO8UrJgWmGvBiGaLMGuGkt2/txuPveNIdN739rA3Ugha0oAUt6F8kfVoBi3cfuugyq80Prw5GLx1MJ4zF4hrBYzDiaQXwKRoiHfpVuTiAWv77CDxEQ+ps42eM1zv2ffO3s+fLv4jhpRfCoDk7jUkuDA+og8kEd/Qo05tv4O4ffg3Ta/+RwWiAb0wV7FmGK+e5qIBScsOUbbIxV4cVfExVPhBYVuFExwdP+fF/fPLtH/mDs9PABS1oQQta0L9E+rQBFtcdvOTpo+HoB1fQ5zedY6KCWpscGiCCjbs+0tkeSXJneZyDNMOhYj4aAkQ9re/Y2DjJ+V/9DZz7vd+D7lvBTybBe5LcDJKzS1DtH9me6h0kGUGkY8vi/Z5gvYj1R8AOR0zf+15u+oZvpf3wDTRLQzyCE5ODUOuyhZSXIz0rBprG5BgGASN4MTjbIB6GXllR5SjNnSfHaz/w5Ltu/JVPdFwWtKAFLWhBC6rp0wJYXH/w0s8bDkc/uVv8lbOpokYQo6gPgtSY4GkIgRA5pDJLW6klb/xexQS5Tsj94NdOYC57OJf84e8jF5wXQIWVEFfR2FJ2itXs5cPYphsrt0R5chL70ZMR4y3Kjg6Pn3W0q6vc+8uv5cR//nGGHejSErO4RURLUdXzS4aMZJlJ8RgmxoRofCFgxQCWFa8chY2Tm5vfddUdN/6XT2x0FrSgBS1oQQsqZB78kk8tXX/BJZ+3a7j8U3u68ZXTmcMZwUnaXZFOHiXkqhDt3atSCeOSBiJihHh6qIBtBOc79n/OC5ALzkddh2kMxhjEGBAL1ob4CjHhZdLLosbkF+lzuk7slpfEd2Mt0jSItZimwbQt0g7w0xn7vvQlDC+7FO8cIhLTfNcpxenjmbR1NX7pUxxJDhwF8R7xHsL/nDTCPj9Z3rM0+pF/OPeif3t2RnBBC1rQghb0L4nOUgDBmaFrz7/wX48Gg59cmc4uX1OLaSxq4nZRVYwJVoO8YyJmjyi5H4i+Dok7NVPgo4RTSlMSLFGksTQPvxyxhFNOfWWNyFs9Q8FeK7tD3nYaqIY2XvtAp0d1ti0T6qPehxNMuxn2nPMxF19C96GbMHlvacEOKsktEuqSHS1GS/woof2hG3zazIIXF64xwklp2T+b7NZdqz/9VrlofPW9t/zGaQ/Qghb0z5D+4cgRQRgAjQqiqKqIL5nyYgJeAJEcDl32jAVGoqoGiWlsiv+T+Jehv/QBwuNi4FPhNjnnXRVpnf/phZgHHUDTlnivOQw91F9SuFXYLha4QS4xnTFEYgK5fpJ+Sh9SxFm6d6uht7KJprLCgwnHGeXri84mVd6/7H+uy60MrmoUjKpaVTWxxQ4Nxmc0JkJWEBEf2Z4XEW8EsSJqJB+8lOoRN/dpbaCO6qWkLIRxDMQTWWQYq1JPybv8EFSNqprIY0XzGIVchhVrTuZxLY/N7TVhmoXxkzLn0jNrZz2Az4mWYj00DUfpw6BSh69VNPSNIP4pN9/yAILnk0P/bIHFdQcufOHq0tJP755ML13XQdDuRYLWHU36iYyR2ONxPsclLXEuQRxhU4UopIPHorvD2BYZDRBrs84f/SvlQQp9rKAFcGxHtbekX1KOC8krLk138lxBV1fCjhSCccR7zY/sVSGXr+WZPfdPnKMpIkMVURfzXcBxGs6bbSxNV0eveQtHNp9x722/t0OLFrSgf3b0ziNHRiiPsp4nSqeP9hM5ZIxd8WjrUfGi3og4I8wwkoSW816tsaIiYlCMxoUjqt6r7+KStIQd6CQ1RBATl1EGDFFYBGGlIIYZQaBYQVoFUfVOwOExUXqJVywhm3+KvTYer96rU/XOR6Eo4MWIC6cDiDHGGJAGJeytD9qPC2ZRFLzXlHoHFSMmbhATkVh9AniSIFiTw1jxqMEzE5gpajxiQyVEFbFItHQLgqqNnFYjv1VT45Mi5kVVw4Z7wSYvtYL1qPHeK4p36jsVwGtnRJyqGiPiUFUB3wiuMaaxxlhrTRMZqYkpflLDlQJSRBGLEYMRjMpUjCjQGZEALMLuuSj51QgRdqDqVVtVtV7VqFf1qHNgvKqETX5eCRZ0H3GOibzXidAFYGRsRDYJHFkrJqmIBjCK+hwaqOpQuthfBmgioHGgXeTgxihOVa1HRbzOWmM7UP+Phy+a4jmFtXeMVW+coddbozc87dZb/Nlag/P0zxJYvPv8I09bGi7/1J5pd+ma2jCtUdRrjhkoQK9I76wSmD6UVq3ScWdQEndMSAAWiGCtLddEUggAw2i+r0/JYhIe2DuxdAvmkFwx0/9h7qpYLxO3uRrpt9RvrUf+LcV+6FwfQE49bkQAH3JcRO5zTBoOuNnebnX0s2+SI6eedc9tf75zDRe0oE89XXv4iMy8fqFz+iVL7dJnLiEXrsoEq4qoxxvNW85VYvyRh6LZB9VTNa1HQaLtzxvJBxVCUumjghuz5aZ1r+UfUika16ipeEYQGpItjxrQTEq+S6xSrrMXwWdjguasveFMoRAbVqXViWUUhQHRkMgvQJisbJhkcAlop+TCiW0PPMzmNueWR40mK0GGsIVegGTEkHT2kuRzlNI9qfmhrhLcxZrqF35wKZuwqazJqW8kmEsadTS+o8EEvU5CXSVaor2AjwpfgUuxTsakwnK/hvonmevzYAQY5JGAeXKCw+BermzjmmLYCHhGi4xKGZWFaMxQCWc6RQuyaMroHGVcrIlm5FWOnlTAkaSeYoxJFp3gna8MY74xjLXhRNNO6Tbf62ezP/mHI5f+7lW33XwTnwT6Zwcs3nfBhZcNRys/vTzzjzyFhTaNs68yUVLAQb5TArbrydsUaRCvypM+kDHFAJbO6eiT5mfkn+asEOVJsY49C8cOF1elz8OiOqU4s1lehPPlFFuKYArULaVJuVL6vUQOskgARAKXOOYbDog/0C0t/eKb9x858ZlHb7tmx8ovaEGfQrr28CW7xHXfORosfcuRbrLHuo5NhPFgwEwMDkrKfMra6EP0oKgka2ZZa4WC0E/+kyRxyK7IqO7npHWiBcCHL6pytOIx2tNfqp1rsTzve/WqLZAiSQHKRUWwUzGx6h5J9Ys/ifZcBblC5ezkvuGzglSpioW3ZaAQjTBR+EdNBgCj6cyk1IdJNCbrrOS6JrON+pR52GdwJwhGwpiZ1N8SwEJonil9nzbblW5FsrCPwApBJIHPZLwIYChgjXDIpJiw99BrSFGAj4dBpi6QmF05yqTUJpEEKGo1OH6XgE/q5eSyz3ycDF6DK1/TJcEHE9/7oCsWYwxGlcYr5zEdWPRJxwfLT1o38txrL7rsp590y01nXWn8ZwUs/ungkd2NHf3gbuevXnce0zb4aK0KSF1y3EJekzlRFRkkhAkqIcsl1aKuwEgehKRRqCdvXSV+l7lCuk/ydz3LRF5I27UqLQCq+bLjxT0yXUdQfeZqlpNl1XWNelhuVGJ8pRYqkneh5BNd0++qCA3H3YCL8Jfcaoevuea8C7/8mffe+uEHreiCFvRJpGsPX7bSOn5o1QxfvWcyY8OM2BSDiCd5623iCx4CIyhaZKAkwYIFT11cU6YSrxq0wHTYn4/MPACEJBhieXkhpTUYeU9hX0HoStFME08p+rRE4RLXKrmKZGdF73NlDUjrum6ir9oXLTaK5ECBXEdJ7KuArmCtiQHjVSyaAuLNHP8DH/lUqFsEF9lqI1U94zjkGLbIu2NWw9R2HzV1IyBxDILuKFgEybxdyVv2o1VBSF/F7YLxOIaUNVnEJIaIFx/8UOozcAOQsOWQFK6SesYQLEmKVgdahr/zTogKYCQbQim3kjk+gZ1qPkKKxMjzIvhayrUmIr3s+o7zLz1RVZgBzho21dIOLLvUs9/7597dLF387gsv363G/94TPnbzzlrvQ6R/NsDifYcubIw337rcDl6+sbmJWAveE6w9KdkVeTFHINcHAqq589XPqQSQJ31J+hDKx4N6FzJkArU5LJa89Y+5IZHq397FdR1MfW3fklCpGKXsbHsrf+bJTGxGNevDx6DiaDXnerWqAU7SPKL3L+hBjrVOONK2T7ll3P3ENece+bfPvO+2O1nQgv4Z0DsOPWyf9XzXytC+ejAec1wGQQinED3KkgvL3FNimeLfUYD346OSRp3cHSYEiEdNVSSABK0EZV7eKdMvBNM5VM8LaMSrZr4TNG8p92UhHw4aEKK7UjULygpHFJ0igZxqTQvRcyvpSenbcKHzVXC7aminhyRriWZ/kWBY19p1o6kSPgrIAAA0BsJHhEAKpDckd1KpSyjCl37U0ufxdlQ9JlqEDHFs4/NQsqZe930Zxfiu4TlEUBSeHeutDrUEVwIRPECOwQMQp3HMfWGxEvrDpLmVsKl6xCTw5EmMPoeJxkpJQh4ZBEgAVKrhflUEE61oacej5j7NcyD2abJU50SQGMQI6pXGBEsR8bqxwkzhAje97N7hrp84sX58L/BazhL9swEW06l56b49e77Hb66HSMUkYL3SWBNMUWFJzt0Zp0Icz5QgKwdG5zWVAEeZ4nljhdfAEObMaDtZFrbCvMTR5i8o9/ZhRL8E2fJNqoePKcE1ph+fKzeDnDTBti0sf5F9eRW2Ct2ZkLAL11iYqHBwZfii+zY2bnzbgQu/8+l333rW0O2CFnS61E3dq3ftWvpuJhM2miHpzGCJGqQkGzFaCdzKwSFRD1RPCXTyWToXC4SPDD7s1AoKphbekcrTLasyCsIoXCTu10pauSQBkgC9T1UkJfNL8RdQ8gHU0Vv1noKspGQhBDYDrBiDEH/3MVI0xY5IbF/sli3ARbTut3BfsChEa4aGwxh9jNeK5gXKlvikxZd+TZaPJCXzEMX7sisEja7qEkuS2puUyt43FbBSSfEdkhh+sIAIGGOx1mbBbYxAE0+bdg7tHIYS/6AS4mASXNCYMTFBRCUOtaS2BODV0ymT/PGl3ckKlmJUwnQMSEkri1TS/SKiyAVK/CFfJ2leBAtMseiEz1YAK5xU2NdNjkyXVr77+osu/+ATbrnxDZwF+mcBLK6/4NJnLg9H/2kw2VjaJAYthuxRYTDjgBipJyFlcCOCEI3BTlqwOsRJoeSFlwOi4mAbHxadjxaLPHFr60T17Eo+k4rR/EzJ3EDnJnxtjOhtOJqnZFHoHDhfGJKU+yHGiCTETHx+9k1qrnBaRCGIKVl1+qBJoELmQifKyHvapeVvnY3H1wG/u3OFF7Sgs09vOe/Sp64srXzNYLLOVJso8EP+mqS5CdA3VkpWGMqMrzSOSInHzGv/AlFh0fxd3xoay0rYBIm/a/4tuR9jbShp8uLvFdCXtMij8DXVI7KiVLtXIGfZRci8LzwyBWyanqYbiow3aNyiUhlyJPLU1Gs9K2+sWla7FCwmepySRDPVIESpLJoDNCVfG8oxkW8VXUeqwEhIsQdadXvOsEzsj1y25hxHqaWqirENxhq69Q1m62sw7ZDGBlg3sDBsGazuZti0MJmCc3FYJQCHWq6nkmOFald7nmM13xfNo46mOVQuSrw3D6ASXUYFwBUluQDmujoJ1Ei0ehQhEn5VJFpMLOtO2aty8T1Ovv7dRy6+7vG3fewEZ5g+5cDiugsuPjSwg+/d1U0vm6hgbBMFsmCMVhO8WnCVQOz1X0VhrpWR9nGih0EPE9Irwaeq8XM6MCyOWnK5bEcy/9e2OKFvpdiprK3fx7u8Dz7a3GQpv4tuc+PcVMszNuXlrCw5NahIiyD5dwExDRud5wAzc8tS+31vO/fwtU+/7/YP7tCEBS3orNLbDlw8HKh8yy63eaHDZmEn9ZqgH2RYa+BFLkrRApMGUUcyVmshfghfS8moX5ef1kyfAVTP70kambtfq9sUxBQWl9Z4hkKJ0c1znrouFd5J7ZtjEzUAy8pQDgpNYCOVoVUb+pBEq59zeak+9c6bum8SAKg3PW7hbeHhyQ2T3Q4RCNX91+urWFDwHlc7YRCMafCTCZsnjmP3rDK68nKG559Ls3cvHoNbW2Ny2x1M77gHt3mcpd17sLbB+S6CnHT6VOqOqh6xr+rEHsllVhxR/d2CecdHNWeMlHbWcyp/R4ZyVefVSKaMU4qPKd0i5UBOI3hjwMFwtPKlm+sn/gT4H5xh+pQCi/dccFhE+ao9ZvB5486HbZ/EwTFlIJKlIpnFysBUh41pzDApUuZttbCEFIoUhylF2dYrME2XBC3TiPXfUgVLQ7Q2WVFQ5TZoI31d/JX1e1JHqnrUl2zBL77/d+SWOTGXJGZR6ifFnJLrV09YH2NOAGgsJ5xyUNxn3KXyLe84cOQbn3r3bTvhowUt6OxR5x89HA1f2HRjXDPK2zQzEDC1yOvD+FqYJgEpUahnIJ0uTnI6A3eJfvN4nxR1Q+t1LGUNz4OevBxjkYai7dZ8QDRn44nXSqmbVpyq4ke14pJiRnLwaXKPZBNHD2LM9RLZ998DHqmNmQ+VDbg13zKZn9YgKPyTLKkh6FAiH9PMm4NFNvLo0u193ia18M1F95rjpbi/U4YAK0K3tsnEK7u+4PPZ9dxnsPr4R9NccAC7axeYBr+2weSjt7J53XWs/9X/Yf09/8iotQyaBt9NMSp5i6mTMsYiMf4mx7VphVgVolKsEYCGvgwNrF1qZVgi+EwxN1piCet+qOFmgSeaYzOAGMQslXuKbP4ShE4852rHbZiXXXfB4T974l23n+IM0qcUWHjsC0ej5e/00xneWGxEhtlVEQckMwPKpE2BTsU/UgAa8V6ktjhU4jNOUDHFd5bvSUecV1oGzE3yCmuGRbAVQISrNEd3bwUZNePbDoJUVyVulKn48NTX12oBRcnPWylHSNqlT4WKC/PwqXOEGDgrdAJd17C0a/iqkxvrbwX++w5VXdCCzhoZ4VlD7/d4aSgqBWGumt7KZwtDkN63YTllVLItYq9uSPym/4T+d/UWy62/litKTor6cWFpFj6Wbg1CJ8VozAesF9ECyTyuZddFLaDTZxOFVUQnUitXUhS2QqaqSBCfyVmcyi6ummKhyAJ0rg+r1pZ+8ZUsrgDT1nxAUv6o2sWWHo3CVjzGgZ+M6ZaWOPANX8f5X/ky5PBBNLq9fQJRe89l+chFLD/zGez53M/j6O/9Pid+83exnaPB4H1HCnKfJyNFskS1LsZI1LMjUrY+y5xSG5skafdL9RxJ/S2lD1JHV3Ijv9f9uKW6VR8ZsJ1nOBo9ezqeHQE+sKVxD4E+ZcDiuvMPXmCs/Z5dXXfOhjQILqoPaYr4PKHzbK3WXuqjMNljgJXEbUrRpJiuS/IyjWOCLv2BEpL0rqd+bRLtx0UUljJXpTyi/SW0PdXMrugn6f6KQW7hRORFa4Rspai1heR7zuAoaQhI8QcmLUB68ecIijjPwAhj9ezrZs3awH7HNecfvv6Z99z+vgdp1hmh+45uHhR0nwiDOPydpLTGRRhIbFrqIRu5XJIaSlnSKVIueGyDz63ip5LKCjxas0Lro/4xtsbef+45w/Eno/0LKmTawWNbndERE0sS469qzlpbFgBI0faVKTquh7I7VMryVw2CV4gp/RMiqcpM0yYUX+1sKGsMyi62siMhxaRHtSk9rw7ENFG7V81HFxRRkKLTk+BM9c8XVO2jZ9VIi12IfCLrTTExmCRFKyWNDGUkC0GO79YQrFmwQgXOqj4qBzbXfVvVV8NOktQNJo9WvFaSZTrcUyIGCripR7nX/rjwrRdkc8yksVzwna9m/zd+Ld1kCsePl3OfTLRGeY/vPNI22CsexoHv/16sbbjv53+ZvUuDCBa09GMN3HLKzzJf6nRKaXdOFWZTAbjY+VUzTDWetfvNSHDIVBtLipxM/RfrlpmhlCtMJV1S4Z0ISzLb3YndxxmmT53FwpsvPZ/mmRtOo2Ld3/dQy07pfQvFvC+kpFQpcrYW6bW9ou7igqrTn/UqrCuwAyyoAXhCrPNgfyeqFtnp3JJEvfi0wvNObSBGTmtfA9riN4bsY0sLPUVJ1+bjVKe6v9UpxhpOOuWcdvi4NTP9srddeOT/ffqtt3nOEq2d1Kd77z9fhWcZywGBJgZJJZBAb0FqCA2LCyvlPMpN9WF6eJMsmilxrnqR0LMxZi3HVosPXaQ+hG+HE1hUT6nq+0+c7P7GzWb/e9/+pWNnqw8W1KcGWUUI2RojacbBES4LccfCPO2w0qSOyisR9mk5l+Wv+d9KHZlbNfW6iaAg1a9ei1IpEFKXUl9T6bLp/oRScr3m1jfQizlJe07To3JCLwrPIm7l3En9SUI0Y3LJ7ifpXUN048zxj17QbNlR0+uvbPLYXncq3ZbuM3Pf1xxRQt8ZkGmHczPO+ddfwP5veBWzk2sYa2E4KIdJxieJV7CBrfj1DcxoyLmv/gam1/4jG298A8srS6gqTpNVN884khzq5yKJ/ZGurcBlbTEu7e6hwNxvqZ0ZRFZzJcdQ1BKvz8p7M0Qhu7rCWVjhMUPrWbdmxBmmTwmwuP7Aoc+wdvB1rpvh7ABMMB950Zx4BuhZn5IQ7C1e5hdf8g1WrhQg2YeSKpqiydPu4LzNVOenM9RMIe8+qZ7/QLTdFVusjbFxss0PmuqeYzb62kh1VTX54qSPfxukuDh0HmoFxB4mpOTsgWVuS2ZmXdNgHLTD5a8ZT9bfDvyvB279x09rx9wlGPlm2/KKlZE5t/xSR7Du1O/zbGn+tzkGnk0SJR5Gcvaa7Z4hRC74tPGMr+kwf3Li6OSH9+wfvvPjaOKCPkGySINKODtHJO4iKOs1n+KxFfVHGV4C7rIwzQBCCj+IprES5Lx1XaaySmDh/IyJojSCgSBIyvfz3F+idA7fevpb6rPIjPxg7km5qPjM+Byp2xfFoMbgyczHanfofHkS+F0GIEkZSz9nhWYbmDUPpjIQqZJNmdSPVZhjxXdKbLr0ysnZk1XS/s+cBj2LeVWYTrEX7Of8r/9q/HQW4vfaJj4z8boIlIwSjoSJveU8MlziwDe9kg9f82aGnUMRnAc18f56hLQCB7HpkuZc5qNA2r2XzcX0KQezSP+3/FWdSbrmh5qvS49TJcYRhYKCVT9eH/Ni+FTvrTkcHjJ9SoCFtfKKZTGPGpuE8nzkDAYnJYNZPWWl+m6OdVRUEGBJ2pK+3rrNMiZ13V5cVe6M8KHc38Mf83ynBiLp73lmMPeMHSGKIR5RA+VQvlBCCLKiCMZqAs/7e7NtXxI7rOqxnVUmVTDZ5VQR2yBuxn7nD5xqh1/z9iMX/u3Tbrt1Y6eqf7x06ph/lG3ltaMVngWe8cTl9tbhYllfEci5AnK1E5fcbuYQF17UG7S6IgKrZK+o4WMSLl4V7xTvoWmF1V2DF506Lo8/cXTy0j37h28/U/2woO3JiGktMKMC3ECaI739IXNSsseCe1pezPaYbtqi7fV1PkPKj5AUFqljNuemW1QIspDoi4QtTxAqrb/vlkxxWlseUbUkf18Dg9QHOQleBNLpvIwUaKZVX9a1zJVNPCzttkhb2Lc2XbbpuZKVPFmT+jxnPqQgn9UsQh0F1xuiOI6J7cWEqwEjuA4mHauPeST2UY/CTadI24a1nR8W+iRgreQC15h+3IEY9LGPZvSERzC+5joGe/agIrgcP5FaWVc+I6M8H/OVMWVANiJFtFmfR1M2F5TxLP2YZNa8yInALIG5ahHkkUi8rsYrmhJdgFe1nGH6pAOL6w4cvKwZjL5YxlOcGYD4nPa23rCQN9hkpFx38fzyJGssKde6oBmxiSnZKIllSQxGSoe85A6XqvdrH+gWdLnNd+n+bc0SWzHIttfFCReKMsHvaRMfLczJS6pfmU99rKN5TmXUHBF/nZu/tDnuta4Rdnb4hTS6zg7Y7KYsDZsXTifuC4Ezcgrq+jF/kQzlN0ZLXHXq1BgRE1ygRmisYPO0jzkCEJCYoa7qwowj6++o+j2rQTp3TwIRZaznu8d7jzPQOc9k6piMN9mzd+nitZOz1xw/uv7svftXZmeiLxa0PamqS/qzUjP3QEnAphiFeY2vWPl0bj30x7nsOAv/hnmQmVAR3vUEyXUID6qXUORi2SqSF2WaalFS+MKcitCu65WeEa/rCYltGFHdjuSqldyi+J0UMJarljGElP6M/ZID0XsxAlTPofT/NtTv50rQRUCVXdxzKClZmMrTtOrG0hHGh0bYicNhGD7uMdAO8LNJORMmViCNqa/rVQ2N82DbESuPfwxH//pNDPack/sgtTbtM5wHS2mXYjm6pd4ErQUcKD2rwpbOrErV3l/lOlUtu2XmwHFfca3GHUExeHVpvm4/YA+BzrgJ5MFIGvPSoZtd4SRkfS/Z1JNZjHioTxSKkkxP5eW1dHTNSAQtwUhCzIgGZYKGl5WknWq0WmglQysRneqgJYov1CkxuMLqwgVKvU1DIQRh8cAjl2Xd/Ho1JgZASa679H4Pde0PYu64qvDwdS+Yqn6+ZigW/q7ATQo0E3U0As4Ih2aTdoR51TuOXHjgAZp12qSi37u0xFXr6xOa1tC0gokHC4Hm9CIhf5nJbdR0PsFpP+jjuFTrz2XpGQPDQci/P5s6vOhTh6OlV5x+yQv6RCivyvQhL4hKgs/fIRIGLK/p+kUlJCRKeOmXTSWM5sBEviy9V+g+c6oaHUS0kddYdj0GJp/D8gyEdOKlXRmoxHqFn0r9Uh0T30xN70GJxJ4kBk5qxbMo1/cBW+y7EsxSBqFWwOZIRcBIVowSgJGat1I206YeTfy+5/+u6pOrkduolD35sf8NOFF02CBHDoIRjNhKQSxyxqcdgDWDUR+0NlWwhvbQoRD9V7mP+rMo9lsPlZWuyuw3DYJQWU0qgFG1T+MvJTBZCqjNI9r/Lo5WUa4oPCwd45aeleSn0+De8ap1MWeEPqnA4vqDhx4pA/tKnCeo4X1mUXh5mWR52qiEV7pE4yJV+oshTrhk1oYCDICY8rdmCnGCS4YpfUt6fn7ap9xH/9KveKYizyUvrC00bwOcL8iaGEou+ZIwWav7ElJN9axe+b60oGWuLjWi1fm7AnASAtMUVYw4xIATw57Bymc1nbxou2Z9PLRxzD2pGZkXdJ1DjGBN2BNvJZ0lIGXsM2AKvVD7lzPzJAXNJehXd1RueO6T/ppS6hMJU09m15eE+WPFYK3BeWX3roHpXPdlD7UfFvSgpBlk94RcWTppFWRBm38tF9ZHWic+k2eU5ouyxp/LkfJBpOID8cbsN68tHnG+hkvKfE1LNhXT12WK0lPkqvZyXBRVLJamFUfoWQviPckqKxUfi9fmtN21TKwFum7to7TzoBSjma+EtlVuqfSqBDKa2hC5mRTNP3EkmeNTvWUqASBF5lR4uFHUSojDMRJyOQTTZ1bSyoDWymD6LvZD6mkRTDMI9TQB+hlyagiSq6t0W5o7ZLkg+fvSGynpYx4HSbi1KDCaxkq24JV4S7GUFCvTXNvwha3HuZlkWP3uVc84DvikAosWefGuzl/mpQl+rW0EcpHTaeEL+ax7geBlL8JWqczheYDCIT9lUkM6pMiXooNDLl9g6ou3r1iPSvBfX6DPBUh6eg/NQKNC8SlgbIspy8adk2IwYgrwoZqs0hef+cmJUcWyK97V66wcxQzlcB8NlhwbR8AIGCtgwbaWKbBXJ7S2/bK3XXjRoW0667RpprzQDri064JFxKI0eCwxZ39eGcnwqNUiLYtT0XSYYs/C0OcaVZ9k5iUZrGRr9TaU/Jipv3onNoq7+NSJ8Z6H0g8LehCStOux2m1BtZTrCV7xEK3WXrYCQF6DEK/1RcCmQhTNgrSvWhaBX7tLkzJTtP9Up/TQqjyKEC5BxFLmbyUDTeQBveLSeSjMC8xi2S0WziwJo3CsHSKxnBQkjkI+6bNsrU1iP21brPuvtjCUukQt3hcLboISSSBSv9eavvTvyDI/AoqM/zIzBGx8iUBrAY/efxQxwRUuGVz0eV0oV/BicGLi50rxOH4MoQk6nkjhiWg8k8WXOUmllIhmgw+Q0YhWKCGcsprgisTRkdI4kTl+1Adf4f9qrlQZFXM709hKuTdN3TwyO+i9D4U+acDiHy84fMGoHb7UdiDY0M9Vx8znH+mByIj8c1dFS0ZehEAuJM86IgOozf8RpRGFsYnlGImvklCqJslDWdVhh3ZK9V9qR9EqUuqE7e7b5jtTm95ieXHC9DQqTVMulVTwfzH3sgW95ju0ukvTe/U5LxwJAaXWMlFlZdA+u/Hyr3boigelY3dMrIp/coPifcWg48toQeU7dVYPAyaXVX4V8Ef/svBe/6dQEttsQ1ot6pwDPT4/6NK7P/4eWNDpkiFkp0k2zPxZythmIVrPcwrwT1TcEWUNJH6S51AGAZWglxSsWUVlVab1bIbIlanAiuS3umo5ZigEnBchkf4Oj63WhWqW+7W2nO6pMARlO6TP60GqOmUdSitAXWnx2uMTxeISTi3NNYp9kGtQD0nmf+VohtR/sX4iVd/J3H31p1LJ0t/58X0FrbEontmHPpLHKMnfwtPIv6X25fkjYKxFfceJt19Hs7KMGAmGD6lARRQbyWpVbi+90ZMVccxy5aX6PYKIHAIQ+7gWZz0+3uukOR6Xp+acC726TaXstdO8ifbM0SfPYiH2BcviHou2NJgI6AKaMpFRFIqif84aEDqiL5jzIpn7G8imKaqOrTV5gegaiQI4722eGwnyHNgeAWypeVlQeQujRC0is5bSgp2K1AI7c+sLByzMccuzpfyd1mMFv8qCqBg1CUBU0w1c/j3vPvGKFWEKnNdNWYEvfNtll1RbQ0+fFDkEeiD1TXiARbF4LL5OdNYTD/Xn0ntbzYUpPmV7YJJ/qxZgDUig/lze0eSaLdzYGFkkzTqLJCI24X9bYHMGFyrJJ61lzdRq6dzaVShjDznEIs8FLSLBSOV+kGrNVMxGpAaeVNy/vobMWhIICD8Xy0AVhZGbUNZ8uj/uzpiHTEmiJ+GZfXixfnW/ZG4UGlsEbVXndE/+IQUvFotdNUDVfZVwrRud7k9MqOLFuYVSBHFpumagVABN4WtBGIf6WjxNE3Zuja99L/6GD2CWl6HrwsFiziXEFOaSKBZHG1/WeywG01hm17+Hk299N6N9e/BEz7QEUJEV42QRzm2u+q0a15pd9TFUnL+Zt0g1pHGW9/ij9O+NQK5YwFP35s4tcyOvE81zRdCzsivkkwIsPnDk4t12MPhqvEGbQfSBRdNeRtFhq09qc3hJ6ve+xJ57ZX6SX3HG+fKuLi40XxiAauwBEwdifp8r1RrIloPq721fWpkgM0TKTKCYFhNt1ajyswWCepKykoZK+9gvaZHl+IP8wGLR6fVT4k1zfZVesbQ8JulaUp96UAzeCJ2xTI2lsUvPaTqe9XFMh7pvB0jYmVSgTXhGGJRovtR6SOZ6Kq/banGWzqn6shqjPCLhv7kQuPxvAW19cJFfCViIuXd51+DeT6QPFnR6ZI2NXiipDcYVftC8RoowroQdUEeFB8u/5Ot6bkaICk+1TvJnqT6T14ao9tdghj6Bit2x55XPfCXM+NCGLPujMEn5Inp++9gsTes390WxSpS1LSUDaOQVFSbKwCW3oXKt1DFIEremanIdpr6rys/9kXugjp8o1gzJ/4Yx0di3KZ4qL2EtEDI8R3r8q9Qx9btHcchgSHfbHRz/pV9CxmNkNMw8IZeoHvEO6x3GO4zrEPXYQYPefQ/3/tjPsqKe1sRsr0LtuSC7tUn8pRrr+lk9OSWlTQn4Vfw7tTn3bfy9BL6WtpZ+n5tddZ2qu7Yj7QGZM0efFGChal+wW3jOVFpoW7A2mvm1zySkfoWBqn8PUa8JIcZBrRZBBV9zZrG8o0MVdXGQfQEYQECEhuijihXZbijmzHXbk5S3BxqwzIjS31s/i/qIsj3qFacabQh1qFN8SYlHyUtHtgY91Z+Ti6M2jPT+rtL0hk8ecAH1toZ1sey13fIA+9kP0inbkyBSImypgVdvHtg+eMu3x4r2Yyp4wH4vmmFhUNstvdq9lJ6rKim3N6rKYGCYdIqx9m8/ofYv6PRJUJ1f84mdZsAxx2IjEy/Gbi2R95VkTe6ANP/Dd6ncynWQH1mZ3ePfye2QBEQRMuQFle+nujU9q9Q6C4dkFSg8rjbXV2C4oIzygNyw8llUclhZKi+DY/qHjlI1L/eHlh/yQVkZrPfHpM8rK+CWvpYCOCr4XilevadX5bNFWUpKT2xSaJOxWDvk+Ov+jLX/+quwsYFZXkaGw1Bf75GuQ2YzdBbeMQ12NMTfex/HfvZXWL/mbazsXkV9F6yZEnbFORGcRHmh1TjMC/k4LxHJlvE0FlokWvgsdk4AmhgnWIAsZPHWsz5J7sSEtEpHadWrGeRWaDluIf70TJDVOP+8JXGcbFdymtliRirass//FoRIRGeZKr9oPfFq/1u6rrolfQInJaLYSMwTIhgVVKJFaBvw0PtG0uhu3968h1yE2qQOSthKlsrRMiEqq0FmeN5B1+Gdw8V4kLR1CCIgSv2hVV+gMV4gofl0Ter49LluUmRW8T6S1ULLOraxJPUKFmYiLDkP2Kdfc9Gllz/zlptv3L5HtqfAn/qmBYlNScwnfJfqXPVx1c/5G61LSVdVuCUWXry9cww7F1XanhlpqrCXsE1NlXbUsjF2H7LIz3887V7QJ0DGtOJKDgCphxiqtRM4bjabS5z9cZ2lqU8EDXleSbnGSJn080tcUrn13Mq/FtdBnROlmnyk2VcSsVUlp/pGAdWbplruQ+eWeymit2bTvE5JvVQkx05Vm6tyfXOXpv6JAKJo4FL4SHpgxjapvRr7X4t1QuLfc+BAM3+sIYakFBp9NpsVANiygjWKUFfu8d5hBy0ymXLvT/wM/p6jrHzVy7GHDsPKcn6aoiWYdXOT6T99hFO/8pvc+2u/z65z9+H8rOxOlKrD6oaUESxfSb9vNHabVuOTTi8tbKhuuFb361w/J/nS65zefMq9qZn7F6SYAUuWC59+wOJ9F1x4UTtc+sJZN43NKz58qaN80Ao25VhlckdXqJA8SbV3R3/Bhyt8jfKRYKmIp/zhNAQjxu+0SsQ0z1G24AhJg5kme/+6gg7LL0nTLcKumNhLVyjqXPjoHNrNUOdwpsETT1SpHqJaHZ0mUehX2CE3Pdcnpgw21TKvf89l1X0df1HyaYTqQuGdN4ysPG7T+ecCHx+wEBAxPvVT0gLTjp4qT2+htDjrwahyh+R8AmkV5c91OXNSiXgSgoZPgSHHcxzV4OPWZu9ih6MsL7esb3Zu2DY/2baycIOcZYqzm+2kvcxPB/pTIG+HzBaAeB/SA/PSW4fEkKv+w7JHshZv6Z6YiC9VIPP8tOU0raF5tJIfWN6TbCqCM92X9E/JylkNIuZdgKmd6T5N96V+khikmnpYw3fpZOR+XRPfjc/0QrKcbOGPVXuC8JTtfipl9ZSe/tOCq6ACbVTvveZW7igArzTDIdYpR1/7y2y++a3sevEX0jzzKsyBA8goHJHhpjP8ffcxueYaTvzW7zL94I3sPnAQ381CWGPKzBkToiZ+WMOlefUou9pSQ/O9xfHqK/bUS2hWu6IzGkjjG9KCB8tFsmfo1r6nPKuMdbwyzzOJ+xZk66R5iHTWgYVp2ifvUn94DRv9aIk5CGoiSjeVcFYNaVmrDqjdQMmfVuPfBPRq8d87qstEQIGUtBDqi3BVsF7RaRDoNdrOtIUbpAGtEGi6Tqq6VdYLEHJSp4TU04zU+J0vgYNWPcYLIgaMxUs6cq2uVp42oT5lJ27Fp6JhUULwkRByRYiWXgxHCKfWE+I4UuBphNsa26NEYCHCpiq7uk2Oz2bP/tuLLv7vz7/lYxNOk+J4lyNlYx1VatBT2OI89ypAslh7NF8W61/jjC3UB6u5vNr6FbmJEUGsYq1BpGUyc2ujYfMTjZVfO932LugTJ5fYcpzIGvfyZaGUJb72hI2W9IdF+yauidqtBnGBkIW/amHc6THpgNFgfa81zjTrJIBSzbimTxUvy/Wn/7xkMUyyVtP6RaMw6i+CcOJoLCvyutKIwoPKCawShVnMCCnFx5+enZla/azqutKfSazFumUrY7g+Af3c0vRsIZzwl6obuZT6KMejZYXKKpuWZxnDCnD1JGj41RF2u5qmZXTe+UxuvJHNH/5R2vP20Vx4GHvuuXhV3L33M/nITfh776fZtczSoSN000nmH8nK2YdPaVRKNxVwUQusMkfKToz+TpDwW2Wz2WKJ1RIsmyKYa0t4Pf9CARHEpvrOq+Fhnlk0yJhPS2CBf66ZzfC2zYs+e3xEotk7SULFatgrbGcd4lwUZAnlpTNQ04BUC7sa1C3oOf8uebGGGayZmdjNdexkozCqPhTumSkLFpKKWWkxT0bqTY8s4DTkjVdF0qa59LiaQQJMO2S2CWML3SAEMlJASiqvNLOe9IUZJUUgRbfbuNDDzpx4h0QA1sRMEqIZVffBD/klClOUgTaYhmfJdHYlcN2WSbAjqSF4WDIzUOI2U7ONda40r/qg6QhSrBGkqbO5PhgVBFauLsdyz88BFDxmHfSDxsiPNVZedxoPWdAZIBezXmcPdgTwObZBPBKVBxsH08fEJiH2CFRMDOwuzDh7mPtovbzltSYxM2O0VEhRPgJrMSQNJ8cHxHWTpnIWh8m/XTH9kudZ8lowCWxHLRUFm+oezeWpH7yCS+vUgIlSTKmFsoKYHF+Sz8ioAHpgy0Uw9rTuagFmIEbY6ZGDFzVYopPVMW8ZT+Aguz7Cc1waCivUbEYAH9uYeG0GJzV4qdewUEBkFavgLSCedv8eDOeg0ymzD93I5H0fhM7TtA0rSyPMJRcycx1dN+7JjAyyJMW3aZYHiVJ7MtuQSpiL9H6vxB3xJDCy7UM0u5yTwSxtCshzQ+KsUd8b32xByeOZnls9NBUQ/01h8pxhOqvA4n2Hj1zuTfP5687TiWJVQ9BMHPPc2UngEYJqdDJlNnNoIygejMnZ1kschlZoPAmkhCwjpQ5OJyHGYK6A+n1O92rwWD/D+PB93qaVGQu4pAUQJr6XlLhGKsHUH58w4OW75K4xwRdD5wQfD0urwW4gx0QNUwvGOWbMYt4Nn6ZgvNZXWCTN2MQsBRO3bIoxGCNxP3bRjBKD8C726cxhjdA0Nixq57MLxkfkVAx1gFjGXlk2/qL7p+Nn8HEAC4m58npfaqw71RjksSzvqmW7p/cSLQlyLzP/Aef8ZObdihgRVVoxRjRuqZIQ1qHGmC4cHS9dMVBohEuqqirqvaCqruusx2vTtLc3o8HfGpVfHwwH7nTbuaCHTp3qLHLgOL+DxcKohkRqvuzi8LMpXj10iovz1rQGsS3SNogJw5z5D2TrpVTrHAJeYObDdsXpDHUenA8KjndRgKQzfRqkbfFNgxpDSp29xSWpKRkftawIYCVUJggD75GZw3cd3rvAw0xZh5LWMxaxhsYakrvFZykdTo2uhV0lJ2O95gF0QUwhB0YEcapotQU8ARMhBJmbrsP4ECHvfeBTThUx0YJjqpiKpKh1PvIoAdsi1qK2weedGIHjoRX+i8AjWDYrCV8YWo93I4o3BtwM72N6g+EAuzTEuTAPxm4GkzWsxBTgPrUh6lOSFNtQfjqILdUldZhGhJOsN4KEs7C6DhP7CO8Dv40W6gAqfbCGxfuMGKRtwArG2DA/bUzwFYPIfWpzrYxqsaTkQST2u90GJEp1WOcZpLMKLBzmSXu8vXRDBYdgtAIEwS6fcZVRMN7TjcfMzj2X5srHMnz4xchwEDKpiUWsBZPyvmteuGGySYkQzgAgDpwGxqPxugDlXdYXrAiuW0Oe9KTsRw+LIE6SWFbTVFEgmpI6QY0Cd6QIK61tmU07nFeGA0sXT8zMGoAItA06cyz/mxczuvLR0DY4a5BuFnaKaFk/qR/ylqtUTtpJYWzYhdPYwFRt+DspIiHewuOmM9zx+5l84INMr3sv7v7jDG0b02qH8pO5NgG5VImpWFZ1AyP6uI9nfkhQaGwuKvRs/HHneKI0rGgYG+c9w2GLn87+zg4HL/146vCpolNrm633fmCtPcdau19E9qr6kXodJLgdbGDaGZFNr6w77+7vnD8uYtZs00x2LZ9dcHPyxKll27QXGGOWVaXtuu6o69y95+xb3fxEyls/ObaoXGxUzsN7ofP3us3N21cv3v+gOUAcaQNDdINoEKqiYH1I2sR0ysxP8SsjOPcC5Jx9NIMBbmMDd/wY7ugx7GzKwLaYgSnaZOJH1X5sYwx0Dh1PcM5DazHn7sasnoMZLWOGFp3N0MkE1jfQtZO4EydgcwJ2gAwGSNsGYeF8VKSiIM4abBQ+UQEyESj5boJ3PmSAXBlh9+zHrO5CR0vosA3gaTLBb6yhp04ha2vIxhgz81hjEDsAEZz6zFO0em621KTPUbCUOIYU/J104Oj2EXIgKCjaddAFXoYojfFoQ9jaubIHs/9cWFmGUUqrHQGRU3Qywa2tofcfQ9dO0W1u4mZjuk2PMS1GLLZtMDbc60UzWDJCf3dLdO9qPixDMshQ0aBAeo+bTpmJYFaG6PIKZmUpyHWnuGNH0bUxdjJj2ITnq9Q794rVPFGxFcTt58lqkxi0c/iZQ71HO4+1StMaZGkFO1rG7t4F7RAZWlx4BM55DA7ZWMetncRtbmCcR2cdjVOsV4y1WNMgtsFbwfl6P01UZ+v4tGjZ0nhQbAI8wYIt5ZysM0hnFViI6x4v0jG1rTeocRGpmrSGPdlM47yyySbDZ1zNBd/+bYyufvrH/8CeVluptgnM5IpJrZTgTVg0TpWJ0+wyyH4thcYajp8Yc9NHj2GscMVl+1lebknbWYPQLYXWWkoB0oa77zzBX77xBk6tT3nq44/wmCsvoG0l+xlRD43BOc+eF38h8kUNVa7qrX1c/ZMmVujTspA/LvJTxn/yl9zxcz/P+kduYKkdoICTeldKirqPFgNAsQxs87i/PHj4YZ935+03nM6jAk8NloStLUvUs8VEa3NA6S6Pc2SM3nQ6ViOjfF7uPws6cWrTqvd7jHCpen2CqHmYqDk8sO3+wZI9aISLpo69rbFmpyFzjpkx3D6bcbv3/k6vesep9cmHEfMh5/wHQO7Zu2twRk5YXTuxtmRN+6XNcPBvmpbHKez1nmbUNndMZvq2E8c3XofIX+/Zs7R+umWur80+z0jz0sGIp/uOw+qxreWO2WD0lvFtx39pdGTv2x7o/i6qi14An6wUQTFAhM3JGLeyxOBZz2TfF34Oy09+GvbcgwFEr5+iu+1WTl3zNk791d+z+e5/ZOCFQWNBHRA0TK8hjkYwuFnHzHrsxQcZPOpKlq96IsPHPJrBkcsxq3vAGNQHYKGnjjO77RY23vt+xte/l/V3XY+/806a2QwzGIJtYnBwjB/LSSUCuFHxWAN+s2MqU1htGVz8GSw95SqWnvJYhlc8jPa8C5CV3dAOYod0+LXjdPfewfSDN7D+jmvZuP6djD96K3JshjGCaZrICnvRAJQEEJK/ry0YRGtmPFM8x6kIIJMO3BRFcYMWOXAOg4suYvSwyxhedJBm317sefsYXHAR7ZFLYM/ukGKA+gEKsxmsn6Q7eg/u7nuY3Hkn41vvZHzLbUxvvoXJjTfgjt6PrHmsbdHWosMgrgIQjHFVUUiG/yNfigBDjWKw4Dsm0wkcPMTys57Fruc9neaSy2j2nwuNgemE6YdvZOPv38GJv/87xh+8hcZ1NE0DztXyufRhLT+ie0lEkc7TuAlMO1xjYc8q7UUXMrj8coYPu5DhBQewhy7A7t1Ps/dcZGUFHQyRpkGsCejZz/AnjjK7+zamd9+Lv/d+prfezvSjNzL72EeZ3XcMf3wD23WIA7UhqWDqE/VxXH1wd9UsJe0ICsp8P0roTNJZwCqB3n3gvNVBs/RnK6599sl2iIjP508YCEzBgIhHnNLNxix97mdz+Bd+HnatBm1ABLouxCQktX4bTXbe8JMDsJSIJINQjsp+uC75/AQ0+uHUtmCaACrSGvQeYwzHjm/wfT/6Rt78jrsYz6Z85Zc8jn/3/zyVpaW2PDsFNvqCdE08VMupMF7b5Ou+6y/5qzffgR0YVpYsv/zDn8NnP/uSYAFJEzeq5NrNyPl7c3AIYTElExhsEcp5oYls6RvJ18dtZzETnQLStIg12NGIybuv47Z/973w7vczWllihssxYR7Bq0nsiM43LMmEe4xjzc1e9tl33H5ax6lv3D25ctr6P9pzzujhGxtT2rbJVm6THNNb7MjBBdJ1HueL33ZpqaXbdH/YYL9MlqU7neefbZqO3UXO6bO91+e1w+ZJYrmsMaxACJb1zuO9ZpdO5WDKAgEkWv0lziUTl0DoHweYjg/MHG/y6J865966utIe+0TrPD45fri1zWuaZfsFoQo+Tz9jys6K8Yb7U1X3Xcurww8+YHkbs8OC/SEzlK8wqJ1MfU5jbRAGQ0G8HHP3nfzOzfvv+Y3dj374thjzrUce/ZeXdqc+dzpaRsXQqAvy2Vom03Umlxzh/O/6Ds75Vy/OHeh9MugIxsb5NN3g7l/4RY7+1u+yOu4YthZVT0c8GBHoZpv43btZ/oIv4NyveDnN5Z+RigxaaOfxhPivFABtxASroCqzm27mxJ/9Ocf+8HX4j9zCsB1i2gEqPgtoX1kRDJ7pZAMnnsHTruLcV7yCXc9+LuzdW56rMedEFXAp88rD8aOsveWt3Ps7f8jkrW9nMJnQDAYlL1gENcXKGt6TaMkiqGSeCnzEW5zr8OMN1DS0hw6z/JhHMXzm1SxddRXtpZfA8hJqQvtVcjVzgGgGN9FSHQqOJ4/EAEdJiQrHY2Yf/Sgb77iWtTdcw+y6dzO7+64wPo3QtgbjS3xesn4T2ykGnPHRpdExnk1ZetbzOPgf/j3t5ZeX/qpdCKkfj93Nfb/8W9zzm7/N8sQxMIL3DucFJ4qvOGjou8gFFZiNkfEEMxyxfNFhRs97Dkuf9RyGVz4KztkLTRPXkvZASnKfZPdetDRv56HQY/ew/v4PcvJNb2dyzTXMPvh+zMYYKxYdDkpfd6FPci6ikGY0bjMO37fe05gx9071JY++7WOv3/q0T5zOGrC4/sCBR47s0t82zhwat4MAIJDKzSOohFMs2ViHSy/h8j/4Q/T8fSEplI0uj3ACFgEpnEZ187hXIlSTuSoJ/WgixOctRBqDY0ItTT68yPmOpeGAn/lv7+Cnf/4d7N23HyvKnffezR/81y/is55VJmpyj3ifQEJkxniapuG1v/UufvK/XMvq3r0sLQ24+aa7+Tf/+uH8+Pc8k9XlAbOpT5scq7NUClLOuyq36wYp2psg8Uy15L4AtsAPqoWVKhtyNOh4SrO6wubrXz++8999/6g5fhxWl+m8xyXrSLX12amlocPoBrd7933PvuuuH3rwgYKNuyePmTb+9Xv2jR62sTmltU1KtlmAxTbkvdI5j3NFExuNWmab09cPlocvOZ1nny3aWO+MFfMUrLxiMODFwCFVZTp1dK5Ep5joVzUmjrWxxYwLc8MV7nPOxa2vwSftnAMMtjEsRW2um/HWrvO/5r173crq4OTHU/fp2vRQu9L+JfDYrvPBlB6tZcYYvPOoKsYIg2FLN9MPTibj56/uWr59u/LcVB9tGn7Xef/YyaQLZue4poNGFcbSNLA0bGfTW+964fDig9smG/v7C6/8i4d1a583Ga4E5usdBks3WcNfdogLf+NXGVxxJW42g26GiM2MGgic3wfNwgyHHP3Zn+Pka/8bywLSGjqC4B5Ppwyuegznfcf3MHrik0M71teCdt9YsE1OPOeSsHchFbS6GahgGkuzssLsYzdz9Kd+gY3/7/UMPbC6zMykkxkUo4K4jslkE3fofA68+pvZ9+Vfjg5adH0dH/udpolByWF9qy/zSL0LcR8+XCujIcwmnPqff8TRn/sl3EduZrSyDOJxqgHQWKA+vIw07UK7jNcQc6ZBAZyNZ0yN0lx+MXte8hJ2fcEXYC6+BGyDzCaocyXRlonxBxLqDQEIl61flYkejzoflBsfYlfSYWzSWMxgiBjobriRtb/4K079yV8w/sAHaEVo2xFqBG9A4xlPimKji1ttOBJ8k469L/0SDv6nHwpxKtNZcQ8bg6oDp6jrgt46WkKMcPI3fp1bv/eH2bM0Ah/mriNaZ1MQZ+wr0zn8+hpdC6PHXMm+l7+U5ee/AHvoUFCQuw6vSogXDPESXgyYJsTm5DjD0DEmMX0NfQLhiPfk2jZNE/KLb57i5JvfzIn/8UeM3/j32FNrNE2LbwcRAKXgzAi6bOorQbzQqtLaTe6d8kVX3vrRPzotJnGadNZcIWrsZY1tDnmXUnVr8DdWvj2jYKZTEMO+l70CDp8P6xvQWPABXIQelxwodFok9QdN9vOi9VdBiMknJhWy1uiM0mhWUuDd/3QXS7v24rWjHQxpRwM+ePNxnvMMDdWMbp78StG+cQEB3HTbGku796DAeOppRkscPT5m1pUFpzFuQyUcIR4rGhaczX/u0O6iURKRKfntQUBZrLhV6IzBbW6y9JznjQZP/zPGf/TntCMNLqPieSCGumAEOjXsAVrcI/73ZRcPPuemj00f+IG5lg9CRTvof6e5Dr02fwppOvaXIPJtKnzjoKVxzuEiAEqWBxtjhAIv8Yi40JR8PGe/LaVJAZRbaUg7iZrGhOAz59ncmGAbw2DQXt205mo3M1/ZzfQ7m1beebr1bwftfwYe65zHGFCX4oti8Lq1YceFesabE4ajwSPamf1pYEtcy2TTXW5aXj+duYfPZg5rDY1USxAQKwwiYPGq7eCC879784M3vH3pEQ9bmy+vU+1c1A/Ttkw/m7KJ56If+M+0VzwKN50Q9vnHoD71QYjE/BIqBt91uMmE/d/6zUzf+35mb3ozy8sjxHk214+x54tezP7/9MPIyhJuOg07MiQGzhkTtT4TFBCNTkExiPoQD0DY9TU9cRKz/3wu+IXXcPyRV3D0R17DYHMTs3s3Hh92ZDnHeO0EzdVP5aIf+1FGj300s7VTMB0HkGAMYmNa+6TVErXPwCwQY4PG7jzqHW5tHYxl10tfytJTruKef/99TN/4JoarKyG7cNxmrxSBlnYShJ1VwaRvaTEzT7dxCg4e4PyvfhW7X/VV2ZrsO4d2XZi2tkGaNFlLPVX6wC5ZUgu4CP0pxhTLpIb+U+/pJhMUxVxyKXu/9dXsefnLOPZrv8Gx3/j/kOPHGa6shNgLklIYwsxFBemUyXST1c/+LA7+5x/BTSYwm+W1l8B6eiaEMVbXgRp2fcVXsP9d17P2h3/Myq5doX/zUowKqAfjPG5zHbn4Qi74t69k7795KX7XMsymzDY34pxJR1hIBl5GTNillHlBAl/x78RoY9+I2tgvHbPNWWAZdsDq8z6H3S94IevXXMN9v/hfGf/tG7BuQjsYoTZa02KX+xRvE5+bo1K387E/RDprKb29ukeMNCQYsT4Ci6r6xnna6ZR2Y4PB3nNY/rzPRTc340kvJvhGjQkIS2NwDGXHh+4sXuPvyVJRCVZJ26LSZ5NfIaVqPEOxPCSyemE4bJiOpziFWeeZjGesLrU7Wg9qwZDW1p49I2bdBIcgtuHUxpjdu5ZorC0XAykNcUljTe9ldngluJRAlM6/6r7Zrs+8z4eM+ckE9u1l6arHo6MW3RjHYK6qcaVb8SJ4Y1G1D7deT+so9RgOJfPf1tam06KCVT9l0KKb6TObgfx1O+DVQtdsTmbMZh4Rw2DQMBo1jIYNTWOwVvKcVLWoNKREXDHbfDzkLB13E47pgwBK0kG8jTUMh5bR0oB21KII6+tT1tYnSKPPsg1/o16/7LTqvzG7gpYv9d5jbTDHGiO0rTAYWNrG0FjJx1A3bUPXedrR4EunG5PPmC+vHZjfms26h6v3DAYNbWMCuGgs1obPNu5qaNsmrNWB+azByvIV29XPG3EhDsLHzKewfv9Rdj3/s1l6/ONzYF/SRtW20A5QawuScV1wcfpg/dv90hcj+/ags47pxil2v+prOfdHfgyWBvjxOLhsbYOMlmA4Qpsm8AjI8RIpFkvEINYGjdJYmuEAROnuP87eb/wG9v3A9zJZXkXHMxrTYhysnbif0Rd8Phf/0n9hdOUjmR07johF2hZtG7RpcCYcuZbnQpQFyYWrxgSzubXIYIhdGmFGA9xsRnP5ZRz8Lz/H0r/6PDbX1jDtCNu0WDHY2CVJ+AvQoDTO0WqIq1ibbMBnPo0jf/B77P62b8KPhkEDVw0WhVhHbQzeGNTY8B75lsl+/Lg7Jil3OcA+8bfA81VM4CG2gbbFtA22bUE9fjJB9+9n3/d8Fxf9/q+hj34Um+vrWCxt52g6h3Uas04ZZpMxZv9eDn3rt6LOBWDYNuQTrE0yjVoYtGGTQNMgTROsGbbh3K99JbNdq6jzWNOEgFIxWIVB5xlMZ3STDQbPfw6Xvv4P2PvKV+KHTYi7QTCDQYiJaeI8tBYRgxGDFaERjUcukk9LTSdaJ6tPGGMb7m8aGI4wS6OQVVQ8bnOT7tQay096Mhf/91/jwH/+QfzefcxOrdN2UcAnhpGsFUn+EeDY2aCzBixsY57UeBcnWFqAybwfrBhGPcZ1DM7ZQ3vovKLO1C8qERPQAhDN/lQWgvTKnn8COkOyvIlhPqQ8/FJN7AAuwoamZIYPTDQI5ec+4xIMEyaTMcdPnOTiI3t4xlMuLFYF6mpHf3je3hmAw8s+/0ouOjLg1Pox7r//Hs49z/LVL3k0u1ZCnIaN9xgb3svCO51X0DSklq5zQFTqdy0Ao4ZsKWtI6urBpUcwu5Zwk0lJeZ76kRSQ5rHiMSK07fCKxulFpzNHgmFGesM7T9uBoPnvciRJP6Tkk0bdTD9fDX8D/uHTWYeI0BgT55HkOdE/qCj8m7YHahmMCGiT9SlZnSTn9sjzN8/hEt3dtobWGibjKZ1ze5zzv6Nev/FB2+Dleep0xTuXYz5MVecQX1EgXwbuohhj/1Vdljr9fuf91d4Hl1ZKRmWMBNBi+vVPE1JVpTP2ydvVz4c8ucGcrB66KTPfsfuFL8SsrqDTKcFzI3gTDsrLyYiixS/tEEsxWCvP+EyagwfZuOdull/51ez+9m8NW0Wns5zvIvV7ek/pnYHM12JnRcZtsnXDNgNYWWJ66hTnvOqrWHrVlzPWCQM3Y7p2L8v/+oVc8MM/hBw+zOzUOmY4KGdKBClDYP1ltudYCcp1GoVGmmMGsG2Dn01h/z72fd930z7nGYzvP0HTDIKMobil4jGfwX0aXQTjtROMXvg5HP7138I84hH46TRqNQZjbbGoROEsldCqsw2HGV6SAtYnBCdwkdqay7MmWppCuSYKZbyjm0xoH/8kLvy936R9zmeyvn4C27R5rNQ0eLV0Hpaf/CTsYx8fnhmFehqjoqXNfU7rUQRzxcNYufpJTNfXMbbJYNuq0KJ0usnul7+MC3/rN+GC8/GTMZoATNMEwJfGJn4Or5zxspwynWJQUh9lRlHmm+Z+JSvGtg1uMtd1uI0Ju7/uK7n4938L98iHM51OaHw4wTUfVZJOUUtpCEJW0zPON8+KK+R9hy+4xA+aq2bj4PfLKYckKpXZ7iOoFXxroWlhFjNfVvZS2bbJtT1+XnhWN8xbeLR/heRFqgmJZKaTtjNZCcFdX/L5V+Jdy3X/dAveG17+osdy+SV7CQwxFx4YcBIUUtwZqsrll+7iv/3oF/BHf/0B7jm+ySte/Bgeefm+XD1jDE2aRgUdbOvK6O9AmeuD05kmNboo1d9K7SgGZcX9znNjElJOhMBcL4ZVw95p5y4B3nQateBBzXDp19Nok/PedJuzpllqP2nBm+OxfwoNvyauG21sekxjCO79IpSVknMjHZiWtvZJEKiZGaeZXYBFoWLlqJIeZfLBJacao+ItXecxxoio/oR6vVmM/OVO7Zh2/hGiIW15Y8pOpzDe6WkxWC0HnIZ6O7Gf7Tb8L9hlM9GpPhLDd1kx4lwMsI1zzdrSnmyJjXNQnUespTOyvcVCVTyKmhj8uDlhsH8fw0d9BrQtOp3EGKEkqBIzjUzbkzW1cEaQQ5ZXmWGQJz+F3a/8WsxwFI4AaJqUXWub6dfv9ZolKyBW8GrzdYbgm+86z3lf8zL0+ms59cd/TvMFn8P53/1dDC46xGxtHYaDKnOl5IL7c0DLeMwHNZu4fTaZumZdcI1MZ7SXXM6+b/p/uPtDH8Mdv592ZUDnuyRDg5CRmDnTNJy67x6Gz30mB3/wB2F3cH2ghO23VsBGy42Q+ykNaGCFcW5UdY5bAOMcyrMg91MvY2eUEQF0R4AXkwoaEdx0ij33PC74pZ/m1q9+JSff/o8s79lDpx1qG3QypbPC8jOeHuokIVA4nJSs9DYA1Jbc6NrCh1gUYweMHvUoTv7RXyF7Ja9LI8JGt8HKS7+E83/2J/Dr62G9RGCi0T1VDpfLTSIpGnUPpHrkuVWPrxICYqFkF47XeGPD/d5jmvDuTq3RPuZKLn7tz3LTl72Cwf0naZtBUBhV6ABnAr72HtT4zJvOJJ0VYOG9uWwo7eVqu6BJRQSoOW8F0ddkwnafxgYXiDMxniIxhx0eUB3wk2HCAwqgyCipysxjWCWwCV/E98Liw2/KK17yCF7xkkeENsZAzbI/sF4k8wwh/K0KFx/Zxbe98qpQhSxg+gx3K5XJ2EsRHhlz71nbgam5e+d/zowg/1wWheJjd0tJNRsFWzrQCEJGQK9wTusZN+bIdq3YhmL2kS01InscHwBQ5KGMt7iO1tgzj753oo1Nv1uR7zOqByYzj7GRuaogtpxOqT65o6AGczmJERI3PYXB8hDSNEuy8sWx0Lm5VY1nGq2g4YQ9/yLQOYdXVoYD+zPTibt2MLT3bNcWFbNbfdmlkqwMpf9j+VrWS/rRo1ekZeOF78friohirKnKmnteYpK+Bl5Kh5y3Xf2MmFHqIQMhYPKcvdilcN5DOPLbVKuwgJaY4IYQsEi2BqLKqWHLwVe9CnveueHSOa0w84OqnzW2p1pa9QWVpSn0lW0adDplcOQiRk98EkffcS1HvvprWH7UI5itb0LbIpL1+mjloT/564ZtJ5h6X4RxMgjSWrx6Vp7xDHZ9yUs48fOvpd21nPLd5oBBFEzTMjt1EnP4IOd8zaswRw6jXReAVtfFyxLgSQNjsqZNfk/zJIICqZTFOAaZtSarVerdnVavGMBHY4PBqdLsO48D3/vd3PSiL2MwnUFrwCvOzdBmQHPJpaH8BOD75sLiHk5LMgvwkivIrq72kiNaDG6yhjz+sRz48Z8IoKttMRlgJQtFkR3hkVr6Jllp4lwKSLnUJQQaaxlzLXWrB7rg/ThPjUWGBt/NGD7x8Zz7FV/K+i/+Kq0XaErG1XRshI/j47w/4zzzrLhCBL1w18zhjQ2L2MbgJ5EQQhEXt8RYCjAltiKZjCozbI90h8/9cdxSo3S59ga4OAASGo1zvbgyYj0UGE9mbGzO2NiYMZ2U3ETFFbH1vbhpFK+e6czFMqZMJi6gxopZ92MqihBKE0xSLfP8nGt4NRll7t55Sgu/LK6KJac6eY+6EiOTnUtaA5HAPLwaWqc0yvk7jcR8BSSk9K+H6UFJIOYDIJqGQ0VMY2fD1TOTy+F0SFWuHg35V855msZi4lHH+RA1gpBOfVliXVIQopb5QTl7Qgmgwzmft6RWCkx6eFWP5LqKMRpe8gsE7xzTmb9EMN+6U1uEMFe9hsC5sMPJx1fZ7VSDigR28LpilszYd3qFaXixicHW2bWXIt+p+kDrvolMLgQRbOv0NZhGMXH7XPBBpwj9UP/qlTo1uT40XmGC20AhWEc21jjwjV/LyjOfGspI5uhkFk9m8kpTrNn7Vt1H8ror6yW6lOJ21+EznsB5/+FbWHriY8Ouksj3fDL9R2tA6t85Pej0KNXfhmyguJC9eOW5n4m5+CI2Tm7i2zYk4FJFnA/JCz249VOMnvokVj/rswIoSDEqtonl2Z7FpFarSv9T+pyYBwODpGOB4tgEHtLnvWmd1F0anh93mUR3rGjYQTf8jEdy4CUvZOOeu7BO4jEI0Qm2tBSuTVkut/Ri4n9aCXCC4HVBpTd5TOPc6Dq65SkH/8O/h4FBU1xGjs3ouzzSK7mJ6jHKsiJumzeULeUmRNHmQNZ0DER+VXJMstCS8Py2Rb1y3ld8Of7885g6FzPBEspxYSdRWtvOb7vkHhKdFYvFrqXhpcMZTEwMlgHyKqOgXUXQJlgtxABtU/1Y4Pn8tqhy8Ao7rrjt3e1hAtXp74tmILFGfayVNBOrgjWmBIkxp91Uj+gp4Zn7hjo1Fqwtx2PMWzpjheo/qnL6jC0hgl4t6uOa2eb6LBD6HTf3tKpucY9+7h/t9V2ubnQBjdRjsQfe+Zgrm6e8958e2CWh6gVTZnV6qFT1rsBLXTsxUg4ZiW1pjF7gN7svU7E2ph9xSDkSRYghIUF+qWI6wHvVxoesMifU642q/oO7dg8fdFeL8/oU1SCQrZWoAQg5r3/Vh6n+yfwvRJ992O7sDOLESMiADKiotUrT2DDLkrWyHDK0tVdqbVLyegsMrDEy9J1/2eaG+8mlZXtsy1CE+LEwztuh+aQZlSHKH4yRkDjQ8q+911Gy4kVel/si9UMNttM09DF7oKjet21nCy7G/IfHGotRF58jpVKpzanmqb8lQ3IQg1dPs7zMvmc/t8zo3D7p+bM1FUQpdJ7tJCA5Dz7y79biVVl++tNYfvIT8YMVvPNh62BqQyRTlVhGNWkSoGVoq3UcfhOh5HWgxOWoCKNHPZzRk65k4w9uYLBnFe18cHF6QgDmeAzSMLr8iuBa6bqQPTRVJ8dYhb7SStApZDAm1obEUtNpyMXTufAygrQtMhgEhTKCLzWeBC2SkMxQbjv+riDe4zuP3XMOK1/0Eu76ndcznMwwjQnZk7vQUerDVtK0bUXnytG5xwTLRmyvA4wijQRNxivddIOlq57O6JlPR70vwZZxXiTAUJ5RKQBmbmRPncBddz3TWz+KXz8VgMmuFdqDh7FHLkHOPx/TDoO1X6vapwdUlre0sybtXMJ7uOgwzYFzcffcFw7ZRAOIUcCbmBZccO7TJMbCCIesSG+7kSJxu2lJTCWYDCyAsDCsDVpymrRJEPY0hx0mHIWlbFnchbf3QYfUf8d7lSwckohI5rzGJBSetk9VJqxK6M7jC0gYq0LtRCamiR1JX8KrFu1ApNemLe2rscy8CTW2pMZj5bm9y6pOiZqdRE28ekz6bFLfRf9sOEfA4r2cK47dwP08ACnqdAcNdZ4DhLqX3rXJpxzJe48dNFch8rspc+oDPjsexawoJkbci4D6ZlOE68fr+l9HK/LbD1yI3ydi+8JMqnGsJ11FYUwFI3Kr8/5/I/JmEXOzOI6FxjJEudD77qp1333x0tLoiuCy6wOU0haylSs9U+J6C5gvJGHqRA81tnkSsCVXRNp6mKfOdoA3zvl0bZrvqpyK131RnTo0aWT9fk9FlpBh9cFCI0YYKP+0XVcbREWT5SPuHmBrpHuP3xDdUqXXKEBUwpkb6koZ1Wgla6PEBibBMZ9dN8Wf9FeS9spJ7853yHAZBkv5SpHiDMym7aq25K6W/FNSdmqEIUlpKh2f6xjwrsfu3c/gMx7NKf+n6MYEJOXACGXodIptBzS794KEnDbWhcykGZrH8tPzJVmbkoUZ0PVTzN75Hjbe8HdMP/Rh3H33021soI1Fjhxm+VlPZdezn0N76eXh4EMXLFxqU/BkHy6n2EKFYOlwLliEnMNbS3P5wxg89jMYv+vDrB46gPebOA9+6kKODefC7o8eyK36Kva39P6VcqkVsAbtZky0Y9+LvigPTi4tKacV784yDCoFO/D+7m/+jvt+9KeY3nxzOB/LO9B4hsjAIqu7aB91Bbtf9HmsfP4XYnbvJm/gSIlBxJSZ1pMb6UkmnGml0QKDL8kbfZjfzgj+0yF480OHDhjXuT1CGyZLYixShHWW1OKLyRHqVf3AD8nCNhacb5aqU+duqTllNQjbWTakIJ/erzvFQkj/n6yRJq6bHzvPNKgARvy2F5hV/d5fbH0hq6WAquwy4WqB0wdlsY0VgMuIKK2TZM6WBLOKuVhSYGr6rIKKRRp7yHg5lwcBFqg6gRSxW55frZXe5ZTNrttphaoa8jpUSlzNLua1oHxybtRsgjXKj5pGrm4GzdXTTX3BdHP6ytV9w22Pgld0o/6rZlApPsx78E6jhV8ZDBpmM3dSVH/KT/nJ4XK70zkZ1wF/AvyHbtN9pYzMT0+n3X6RauyTLE1tzO0NW/1i7rfgjhSPFTvwMz6HbYAFybhQN2duaVTFJ1EGgFX5iKo+ynkebaV/R/+Aq7qPagYfckGAWR8g123XGUZME7zsACXKvpxBEe0RUaim+s0bD2uQFPLY9Bm+JFdNVePUcC2Trypv6/qrqSzbwBMSGElWwCwyiyuIeh6VjHHzsR49DLJ1rST0obGOMwejAcOHX0xzzm66tQ1k1wjnfQ7AVq+o72A6jX0ueXtmPsesapTE33MPqjJ54//h2I//LOP334BsbMa04A1OodMOf+0/ceL3/4i79+3h3H/7NZz3bd+KHy3HoNwCUKC2LmyNL8hxLl2H3b2L5ac8geNvuR7XWJzEU7DjtuTUB7HSNT7KH5IKKWgIAo7tExPPV2oMTBU5cJDBM5+Bqg9npSS3h5RMoHngVWOEZPxsLGKE7s3/m3u+/psZScNoMEAplvCQ6daj6xO6t1/LfW95O2t/8r849wd/kPYRV1ZKi2ZglxJpKcncGUML7ruPyX3HGEqwpjrSHCvWJg94v4Ny9xDojAML9dqgrKZUtz3UXbGjIJRM2YPao/rvrRwuRcn2Vla8tuIbvaJqBNpjapUaL6WY6neydi/JaqBQ1Ia6jvVSmOsX3fk3iUxL4nWy4z1JK6bUZY5Fl1b0+yw1M1S9fwdSBWYKWYMByvYoo0h1IqRGJp6MUl6EcEyz4M3woobmPODDPBCpOkRm+bkVNy8fa+DVx0S9olL/mIBXt3MWJECUpI2JjF5j/5vwXPHOMfWO5aXhy31nG7ZJAAXQtPYf0yNSngEIOxBcmtaZvyiDoWU6c2uN2m+yQ/PfH7Bv6ucs2d9yY51aY393MpuKzdsfJYOYBCpqN6PEQU/f2YAOH7XdM8TmozV3kpH933pSTjeZyYsxulz/qPMTnVS3xGsTqPO0rUU33Ftm65s3bftcX4zBIoLGkzzzCZuZsZOtF3lXwQ51IPDYsBEsCQGCsOopLkIo2FSKUpb/4ffeY2qQnrujxG+BhCROhSXFcue03GhyMgDza1aL8pIDYatn+lS4D5E76l2ISdi/n8G+c5jec5R21wiH4jCYTjHNgNn9Jxh/4AZ2AzQ2CCuVmFlTexk2MZYUlCndjBO/8t+484d/nJXWMhjuQpsh2mnuqjbWe8mfz/T4/dzxYz/HdOI48mM/SLc2hkFTuaEkB43n+UQf4CixfaMRo8svZcYsxt0QLCE1p63dZVWxpVeT1SeC1NTfMeupxJiH5oIDmEOHwXUZNCgEQS59K2ofWMQ1aSz3//4f0cw6zMoyMzcDbA/wIoJpGwaDhoEo43dez21f9bUces2PM3zmswO/clVEVjI4qOKdQ8Rj2hEn//iPcHfejRGLk2Rt03oBpt1+O6zUT5zORvBmYzC7QuVzOGT8qaBxoGgX0hcefZqXIH30Ktu88l3z+GQLxUVBXc/MnaLFNArY9J4m3Txy2Qol6irn6/p1LzrL/J1J4PcWA9pr09Z7dxYJCQfN37Ol9lWzEiMMe+MNhpD90YiGfGIxq4svF9IJDHCrjWfb6P65dnqULnyOjJXgBktuilzJChRua2WK42Ik5AHJSZjmXybEymThLOEsF2s9TaM0jYazCCTsyfKNfu7mqe7F29XfKm/eHHNd21qm047OebrOM3WebhZeYXeGMhw2oAbx5lc/HlCRaDqZvm683l2fkknVOUy2mfll7OJ7FkzCge3KF1KM2fycq5Q+Aub0ESipD6cxzlRfsOH8d4kkPloxsVS+SJyDElOyx7TsPhwDPhg0jpNrPzv8jIu3ZN0EMDBAU2aKuPW5d1ZGsWaVce3nk8mBdGnnWd4KXtVZNQffmXgUe7Iu+BxIpwWQxvvLVK1inuaGpSTkI+w8iGb6PJ62wbQDZDCMrxaJR7D3xqpSPuq+zTKjHqsIPMLKAruyQpPzfghODV7j7h2FgRkwu+aNTN/4tyGr52SCn07R6QQdj9HxZnyNcbNpsFYCJ//g97nrR3+cvXvOYbC0GyXEKvgsM4PVzinMrGLPO5d2sMLxv/pbNq5/H2bQwnQWNG9X93PPaVa9ohwWwbQtg3POQaQNOTxMOLHapJTZdf99PCJUqHJ8GFQ97f59yMDGtOqxwOQifMDCNCyczqFTxWOqDHiaFYWwS1LwjeBt2Em5tLyb0f3HuOObvo2Tv/s/wvlVMZCWpg0AsLFhd0rTYNoGd+313PaaX2XQeVxjmBEPkhTBGyVF2Oa4ljNMZ9xi4b22GFbVl4XXq/e8qkARIOVa7d2wreZRo3SixjL325wU3v7zvNlT6Xd0ZercOnW0/7i5VmwBF5Vw7H1O7dT+PXWFdzLqPOh0rsrcNth0R8oPCIzQBndIyPgnMcI+ga6ivKmHgZ8ydu2u03iIItJPGEAY8RLTIb2dvznwsa9u9OsM1AGU21EdhJvulciEPUHKTmaepVGzZ/3U9GuAP54vY7Rk7vBT/+rOy580jdk/mQUtwneKmmBKbiRklgRh/eT4Dbv2Ln37afTLFlJrOhHzrqaRJ3azrqq4zL1vXRf17xIVx+0ekcFKr7x6PUh5hJC1q0HLLghgY86T13PD1aVIvF9VWF5qYM2/1hzcu2OeDVCvkna/EE9x1BzVqtVKyFhrrh2lqGh5i0BC1QdhbQQ9tc76X/0lm9dcg7/7bszSgNGjrmD5i/4N9tKHhV06QIitiR0R2yjx4ZIr0afQ5ORKhHz4Vry+u+tONq95A93HbgYH9sBBlp/1LJpLH9bnbT6cBJGSUgXNXbP7Kx1wlsbBx3WLKtZapGnRLu3+KRaCznua3XsY33QH9/3cL3LgyEWYh12BbqwHlu3jhlgJliLTtghw9HW/x70/+qPs2rULBLxzmAD/4jk46TjwkLdoGgWbDEe49THjm29i+XGPphu7uHNEABvjCLYOn9TTScJOQoYhG6WJadDFWqRJWxCD0O7z4ND/O7GIIhN82VEBsLxcxqG6sG9d1noBVvMhcK89L34Rt//Nm/HjDYbLK1gJ1jcfXdAa30XCuHqUwdIQxhPu+6EfZuPNb2Dvi7+I4dOvRvbsye4YVcWfPMH661/P7T/5SzT33YsZNnTzAJcge6W0/4xDi7MRvDlSYdlnM43Gya/F3A5EfZUc5FK+7dOctM9BnHHA6jwQeb5l7vbAwiXDGNWclwLImk5R8vqMcbtichzzXBxMT7D3xFj8RurryBNYo1k2ZSxMn7eUnZ5dPzd/TDEb/cDPXhnbfRM1VoUAHuLEFClMcT5yPjFYFQknT6LDbR+45eH9Nm3lJTlipU81gyC1rx7vB14r/ftMzjmR5oFW89LjHnnq2OT8XecMt+SAMAPzFj/1z/E0P29t92wjYuqswdYK483JKTr5lVbM9z9gpR6AlldbXT/VSa0lhyqnsdcs4Mj2n35rAcRg2YbCkEZgEc/WyHfW45Q5ruYfa/d1DfiTpU7V55ExJiSNa5q4p0fUscnP+FNr/+mB2m9SrCUxTsFrFIzJPdxXS+ZHP/dH9EtL2nanIM4jS0P8e97Dnd/z/Wy87R+w7QDxHvGe9f/5l9z/K7/N+T/2w4y+8EVhNmqXBTtItH6YHp6oM1CmN0kn2VqDNhKi9I1w7Ld/l2M//8u0d99Gg0M1WEhO7N7FOd/yjay+8mvQwXI4oNG5svZyHapG92UekA5XJG7bNGS/v3pUDM5avAStdnDOPjbeeh23f+M3c/Dbv532ec9FB4Peyuruu5fNd7yZ4//zDxm/6W2sygBtDdPOhXwuxB0ZMYeIs4ojuAi9ELILNwbxHc7Xm8dSf4Z1mSRsbzx9nOMmuD5pLHY0imm5BRlYaMM2UMkZUee5bwGENRjfwj2yHAn9tZOFucz71K+U8ekNhjL67Odz5Ld/lTt/4mdYu/7dDL2jGQxpV5eRpsE0iRe5ML/VMfMOu2RYccLsb97AXX/xd7QXHKK96ELMkYO4BvyJ+9h8zweZffRjNGYJRkNmUtZp2vESSjcYCblO+rP2zNAZBxZizEiMXdF4rLFmDpMGB8qZ6RoWinf9Qrbxi5ZYCMnAIYGIfHWtLvVX+JaySrR2KNJqDFaKE85sJ8S3E8Px+/4vWv0mWwBBzQFq44qRkvcCa3rzM/cBqcwSDKZAcZPJnJUigTDpldFLG1vVKFc8Ix6ot+qJeEKG++ryuDbTUJsQgLStANvaS/0/5pWIbS0TvQukXJfBRRStGtqvBHS+7TbAbPZP8yGUkczjsaxdjTEHgG2TS5mBeR/wPDfRq2fOP7tz7ohqd47Aqca072oZ/s9mt3ngQNYHofG6e5wKnz+bupgnI00OgQewzmwD1HdgImr6XhDZhvfWcKWsO6ksCWiZW94l5m9prXjJOaD8Jq7bZGbeqZhfMss7ZwRN1IixW92qhbZrVBj3+Kme6wk0ioSDtBqL3Hk7t7z6+5m96x0Mzj2HzrY45zDqaNhNd/wkt33b93BkdQ/Ln/MC3HiKEHeUhO1uRQ7WtUl/a4hzCHEcIXmLAKax3PMzv8CxH/9Zdg0t7eoqnQ8pxVssbjrlvh/5CZSWXf/26/HGQNf1ecp2FtrcBxKyakawi7XBvULJI5HAqZHQNx4YLq3QveeD3PJ138ToykcyfNQlsDRiur5Jd+8xZh+7g+7uO2m1Y7SyEnZeOIckZdFBcmsWl25gCVbAONg4dRJz2SPZ/ZQn4ycTxDYhs2cc5+yWSwqYELdvaYy1qJSb4RAaixgNLtrgEwl9kPhfzgsU10uZIHNU+lFnHeo61GnIb7F+amsfJ+tZD81rrneK/UlDJbZh+MyrufiJj2f2/vey9rZ3cOrt1zK95UY4dhSzGdZNMxhibItpDGiDx6GuwwyXaExHd+cdTG/8KH7WoT5kP6ZtscsrOGmiVdbEWHyN8YyxXqSYZ4MxZrtOeEh05oGFmIExdqiawELUqBLvS+ZHXPit68KhQom8L8GZiSIQ0NRBacJtc12/LqcHxCSClbW1TTY3Peefv/Kg92i2qz3wmGyvwdQgIVABMuEUzPVTM4y1jJYswXed9xqRsoUWhSiZ+Uqeie1q1eut0+iaCEXKHxlA6FxpCRUoiEdE8d6fRvxOMbMkh5goMfMkVQOLm+LBalz6oXwnc7XNv0h673dGYENFWCupQg9MdihvBd76oBd+HLR+Ynp+Y+2LVfR7jNVD3ivW1kdeh3oWu86DzEez/cgHY0UfjM8Nwdb+z8BXahAWvvMh82bb2jHwZu/5O4T34DmGN6fozAmzJLedbj+YyAlLnTQIkQcbloKP+20zgkYWJMMhR3/zd+jeey3t8hJeDM65IPzFMFNPu2c/09tu4dhv/g+Gj3w0cuQQOp303C5SzeYsDNOzNQgmnA996R12OGTt79/A2m//Fru6TZZ2nUM3mdBITF5kPDJcxm6MWXvdHzK4+mkMH/e4mFTLzkGsvpLQg2BCONlUCFmOm7ZcE3myQTFO89EhaoR2ZRVxHveP72f9H98d4qyaFtu2tMMGGQ0RGQAejSnUMTGUoAXjw+m7vnO4ztPNJvhZ2HXSmYbdz30OF3znN9MePBzyXaQ8RvEldb/OKQCFL0UYPGigSTt3NJ+pkvs+KXGV4E/Zi/P49bsxpD2YTNGZC6e5ehjffRdMunxtsKBJPCyQzH+TwlKkRAzWzZZRkJUVBlc9nX1PvopzvtGjJ07S3fARJh/+MOMPfBD3kRtwH/4I/v6TqHrs0hLSDBDrMN5ghi3aDOKJ8z5ML1UcJfA1A+vMjWOQsxJzcBjsvBZ9BujMu0JUnaa9QMRxymo4xYLqFPBoSp4CISGLtXFSSJHb1XsPm8+byHagNH8o1egxJAXuP7rBy7/+97nz2Jif+r7P5fnPvrRCmTvFP8xrCrrNNXXXKPPgwqfj1aPWY63whjfdxI/9zF+wPvH86Pe9mM98+kWISLy2mOOKvzZZKdLuFaL/LE71XKUieGSuP7fptayF+tyJoX1la1bVCwn5azCnhmX4IBQeYOe/MmnPfLXocxXofz2fpW9O3vbv3aax21uTYrhYdlL7E2r8xx60PQ+B1k5N9llj9hsxh1Eu8CqXITzeG3e14g7bxoYU8jale+73QYJC4e8CpOZbtxM2k8xl6y+3XNMvQ4jaf6lHOoOgbQ3SyZ8B3yMD2TY3xcdDVlTSzlJDEjzz7rgHqL72+yMcfe7CCZTHjrL212/ATqewd5Wuc3gjFUgSOudpdu3h1N+/lXM++jGWL7sIP5sUYZQYd8335p6d1ETvPaZpQYRTf/E3yC13Mti9G9dNQV22zqoPh63J8hKTGz7C9P0fCMAibz+tGBtk4Va3vqzV+J810JpgGTAxYVLgPgghWVbYJpN4iaVpW8S04RTmpkGHwxCYqYrvZmg3Q7spdB06g06VzoFa0KUhsrqMrCxjdy/RnrOPpSuuYPczn8nSE5+IrK4GS07sj7RLMFkqs8WywhVz6mN8s/kY+8Do/ZzrPa7sCvxlV3KUNSqVICbO565DO4/vOvAwvekOZjd8lOZhF4acE7biqRXv6fOovtVao3KI9xm8Smsx5+5ncO5+Blddxar3MBnT3XkHk/d/gPV/eAuza9/L7CM3wqmTWLvEYGkFJy6c+CtKF0YwtMtpiIMjuB9zULFAcNml49QN0js85czQ2Yix8OpdV+2AoQxUmCgJZ4gqdD7ssdaA4rOQkpjqO46bVOCiXrQSe2tOv6z+LhXJ5u0eMwpM+f+8/Rbe+6E1pup5y7tu53mfeUlJDpfuq0re3tNSJ53aqmXX21ZTf2RgoSEgy1rL37/tI3z0ro6TJ9f4X3/9fh73mAPsXh3gNfjEtHqmQi8PRd6/nvqlWlu9jKU8MCjT3odkhK7/KzxN0DKhFToxeOVBM1fS25WUGL+kYx0y0u/XKCCE/FfPnSNki8oWiVrNlapTtO67qkwRyb5OVXnPyu7BydNoz460cWLaipjLjJELVTnfi1yAcgjD5bbhYmPlAOp3ea/LgG1ifIaIDam9fdytELug9In0znDxdVeRsFsBoP1fe1Q4eCyrXmw9MZWK0QQzNbnr8R4aa9Sq+SmzJN/1UPqsJqtIQwyKheASqHPgzI13D/JXiKvG2CqKtC0b7/wA3cdup0m+GhVyEpDUF11HszRics+9zO64K2RfkRQ8KaSDXXpgr3LTZhAU56tpGzY//CE233UtA9VwTPrEZYDo43O988igxd99H5Obb2EVYtbKtNZTuur4nBQQmhUQQ23PwtroMqDSoEsOGY1l4EOTHF3YZdU0dCK46YzZximc62A0gj27MYfPx+zbg9mzG7NrhdHqCs2557N06aW0hw5hVveE+IdBOEJcRsMIJKIBJ6Uwj5GePTc1FaBNY7EDSdIcNWUU1ZxefH6bqmocfw2uopqn5U/eBwuL8zFLqcEcO87G//4rdj3sGwLPjoUaqedWH0jMK7GJD4lIcCpHAJNiu1JrzGiJ5mFX0F7+cFY+7/Nwa2vMPvxhTrzxb1n7qzcwuf79NN2YZu9+sA3dlpCCMofT7o/MxyVJEj49XCGoOvV+mpGfFtHgJYGLyNCTrSrmZg9beGKGMCMhN30tRWVeoG8jPcIvDyg0E8hIC1+AEyentIMluskG01lHZpxzwCLMCWWniOJ5ra4ognGGR8FWtlRCloPx0lPrjqYZMRg4BqNB2PoIvYky99Tc9lrgb9/2eFHKEPkglM+zkPolveLDDiCPj1rONGR823zQskP5aZlFML0V+G29q1+/pNX09vNvc2LfvNUpWTE0bvny8TtjiUcbG9Y2u/sGg+FrHqwt87R5wu0ReNrMd88Xw6NpzeVe/bkOXUVoTdz62tgSnFtwVmQ2qjEjqGDKgZkVxbk2x7nqZtaRJXFuznGfrfRA06zWwohWnXTaqfMeayyo+WMzPHOgIjw6bv1Ee+cPlYyGNcAsQqi8a5Eo8RrfOWhhestH0bVTIU+FxtgDKQGsJgpwsQbjOji1Dt6FQxUzWNEMRtKR2KBZoIWHSqhvnJubH/og3e23MRg04YwWjTkn4toMfMeDKH7W4Y8fC4eBNU3Q8oOPND69IMD0PFP9Iho0VGNMdIc0GGNpJAZOqmRtPgXDYCzGGtysY/Pkcbw6zMEDDJ7wdFauegrDxz6GweEjDM7Zh4wGYBo0HyIZjzvPiyxaOAh7zNN4hLCLEk/Rc3+wHY/fgXwU8oVhk+dnz6pZaWSRr1GmRYw7CdvETQqUjWlNvDGYZsB9f/A6dn31V2KG4SxqkzXeuJ8t+ccyjpTe2skDVUEdMRZJMSlpBL2idOF06abF7j2H5glPYvioR3PeK17J5ruu49j/+D1O/dX/wW6cYrDvPDyWznu8NSW2o2IIlb079M+OguKh0VmxWIjqONrKIirWuJaKdpMPqonmqxJIRNYE6FkXyja4vtypBWTGo+FZ84Mp+Z/yVRzb3buHNOJAO46fWKfrPDSBgfa0H9gRVEAEK3W1s5UgMuKiPs3dWDTS+45v4I3Qieeiw3sYDsO+aZ0vLjdpPlq5lF1Sh+cKFoa7czPm6hf7uHYoU6ZqBoiROU5o8UYeFFj0HpMYSywquUPC30Xjkv5ND171B3p0Xr9xJ4jXqASHg7MUoTXNa0cjefvplDcd65IqL3KOl9Dok92sO18altvGYhsBbAEyhGfOUtAXlVYRNZ6KPxXgWbWtBgA95tmzyIQbVRVr+vfXNIcVt/YVZMtYuF7LsBNniBFGI3sPE77jdPrr4yGL+uwKMRoSZDVzOQrmKhyB65ywIYM27YKF1B29H51NybFgRDAX2YmgGJWYyUVDwHkFYoPlkWxlSyt9fnaKEdQLEo/H8fcdg/UxNOEE0ggn6mrmPAfGO5hMgnU3nsWRgFCscHkOZb6kz9mNHg/K0niitO0k87MSXSvhpNNZx8bR+2B1F6vPfR57P/ezWXnm1dgLD4UzP9qyczkfLOZDO/CKiwH8oAU4ELepp8RmkBP9ln/LzJ53H1e9SZl9hA0A1Z/xqVtv22aWawJVGg4SSgd+qaasd2HeeyPYpWWmH/0op177c+z53v8XXV8PB5BFC19Ys5FXJpVpRyY7h6Lqc7VCxULfpEPIvA8HhjUN7NvP8mc9l9HVT+O8936A+3/5lzn5+j9DmobmnHPoNATshgws2gM4eXeVC7E1pwndPi46GxaLCfgNvA1e9szMKuGvwXyYTsisDe1Ek2GO1t8iz+b1qVqkbl1k9K6kf6US/dZwYP8SyBQjcMNNRxlPHSvG5jMkcrm9OTMHUnaa/3VdtWxtrXmdc57WGu64Z5Pb7lpn1gliDJccOYe2MXSzrjAvkS27Vh6cooGvdtXsqJqWr03d3kg5RLRIlfDyIdp7amXm0K3h09uQzhmXVIS+rNiGEyThltZfLKGOWTl9ChWwQZ2LwMIw63DG8t2jkfz0g5Uw2dRB5/kGD18709kV1tpBYxUvglPFS0dSMEVtfKbB2AII502nmRHEPihnxqQ5kxjCPCKYBxWQtsCF09dkW4uF5gEt/bL9ddq7pGzLDmBsOuHPhyO5+QE77BMgizhUqn4JfGLeWtOvbB9YJGtEQgNpS7ffGIezFMRW4NVjNOxcs1GLFIlJp2LhmhSY/Gglbe3uVSUPo9ALLJ52YaurLV2fgsK9VjttnMfHRFpoBDY+aWdz3E/prZ/0MRvwjCBNsEQYUwSqxpxCIhYxDRtHjzIdDdj78pdy7pe/jNEjH4ZZXkWGwzgHNYOJuvMDrwj5KnLNJAXdBuBSbEFUcRCFydRTMbuTYxlbEHCe5C4qNqnDJTIveoy5jI3k232FUTxky4fR6v748o2hMUPu+bXfZvnKR9C86IthfQM1cdOm1UpmbQdsokCJQ1erSBp/L+/R4hXvSYnSQr+7MJ1WVhhe9UQuuPJn2PeyL+GW//QTrL/vPazs3YfXFsTHA8oKI9e4icnHEBFJx86eQToLKb39uPPupEiw3apWrK9CCFJPgGrgAsLrWwnKBN3mgZnfau+arfAjfieJz4SB8xoCzg4dXGX3Kkw6w00fO8q9922wfHh3XujVvJ8TAlsr1U/O1BfJiuQTH51X0jZR1ymI4fp/uot77p8wnnbs27vCpRftBWDWaQjGUSq2VRZHafU2XbRdHftmle01LAqjKEXnJTBHYWU2eMR1x721x7etzPxd0k/80RvvUPkegwo3hef7VOc4sCYCg4dCHdw86/gz4LcGRq59sOsnE32G8/oTnu7pA2ulsULnHF0XfbexghKD7STuHYeY0bGK1k7Uj+dJn8rnJFxr863mq/p+2sCkhKR8iTyYK2SHObTD1WW3hoQTXh1/9sDlf6KkXkyZkzEPN5VIr+ZOEvjlt1hGFM5JoMXf43a95G+Ko5ORa2ZbEtEznqx95+fGtZktOVrxjLLOeuRdFIhNBj5BuEVBkoSLV+hmZcdcbS6veEG9PNI5VYFBVnHUIqi1+Xyf0Kch/W0zaHGzGSfvuZ/Bcz6LC7/j1Sw9/pHI8jLaNGFn2mya+0TiOSbbWY0k1aPGfVGRhGKdLttRCzCqQYrGtS3JMr2Tyc056t1q6YC6XibZqtsUagNVkRdzJmGxTdjeLeSzkWw7xE7H3Pof/iNH1DN48ZegG+MYq0EBB7HkHFgdJ6+kWu7QlGwKzJ2Z5hb5VFjxnhTU5BRkdReD538Wlz3+Cdzz46/hvt/8LVaXd0EbE7kJAYjnbT+hWwyKer9T0rxPmM48sECnzrvj3itefASOimqKFqoAQAZvWhZuxhphQtSmpa0iuv67kPR+k97zcsxA1OLUK97BBftXOXffiHvu3+Cee09x/Xvv5sLDu0ngKDGqfmDRPLtNOkyGMXM1LBqXGM05YLzTfBz02975UdY2DKc2N3jK4w6xZ9cgJAIiCqSebK0FyNZZmtlZMidWmCCz3IKbttQ411xi+oGM901mHLEb80K14hE/vQ27dHSbouZ6C6TYHbZUPoGGPoyKKaXVx9iOsE6axuA7/zZjzWui5bgRo11YlTVn1zRIHmJuhRAwMFWR273TW0bD08s5MZvqN25OJr+wujI00DDtXHT/xUC0PN7Rd59AsxLdg0pIhZB0uAIUU3xFar13PiSXsra2stZDmOdeFqhaCdiste8EEdIi3IHm5049KKrJl7sp8KBg7BMhEZymUzjj43uB0ZS6VU5T6nlVNmIXAKaETJEkxp0ppJRKmEIjgMoPS9bL/Hcc9wdpRJl+xJNFXUhQ5ZP8l3DOBzWP8tHNkKwW1cFWsdwswE3VF9uNaPInqUZsFpKADYZDNsdj1u2M87//29j3qm/ErKygRkKiJt+F/ouHjoU+Kcxo/vyhDACJ/AcKKIqnV0t8N00bYmaq0dK6/qoxF8XW8Q6LJKYBd2GMFUENISV57h9DdjXlmVFmjVTveQWZkC7cWAkWHnWIATWKWRkhG2Nu/t4f4OAtN7P71d+GMkBns3CIW2RMYm2wZqS9uFUbey7LuXeEsrMvYy+prBfpdN/Yjy5Ya+wFBzj4I/+R4f7d3PqLv8Qeu4KNDg+P4I0hnTouaWLvBHAeAp1xYPGo+45OP3zw/NscivMOY23eJpn8UGGBCYgJiyhtMQpRc3OCpFrAsN3UmkPFDwQEE0gIdUnbs5xXRkPLFY84zPtv/AimGfBXb/owL3z+ZbSN4GLSF4xU2xjmlmxC1pntzS/pbVhOxllK0wj3n5jwD++5nc5Ypn7MEx93kOXlAZ3zZeEm5l4t5uJnrTqBskykvma+z7ZUK/V6YVph6fqcPCet+rTok19WEDpj0dnsozTyoMAiVGt7FWS7se/d6MKebYHMiL3KzdbI607juQ+ZplP9us67/7JrdYjzDjRYTFJ9k6IU+H9i/KlPk+AHkLjjI/0c3DnJXRYsAYbhsI33VBqVhrISmEhJwFJ6X6ppkaChKJX62qNsydgWM9fgdQ7MBMZnQORW1N/1CXTnaZD6tIMBqGKy5ppTWW+25QRZ+GtRZF3J/Kho6at8JeHCtAslJZ2L58lAyrtCBiI5GHlrBcov3qEzh0oT11HlVlHwGsqXnFw0dnysYBKaYTn6kM66fmrFNGuxHwJFNQZie5q2ZbaxxmTJcv73/kf2fflXQBuFpAOs9M4rUV82zfQBHRXvKZ9Tv6eZGECFYkbDbL3TBDbm5lYGBgmQJQ2GCLBEgk3fdeS5IAUICoS6F/NHBop1LEeqYwBAMT7PWExKE25MiO0REBvWdLuyihnPuO8Xfo2Nt1zH+d/y9Zirn4e2Lbq5WQE/U/qj7pPeXK2pkm09tKuZceevo4tDRDDe47spsrTE/u/9LtZuuJG1v30Du6TBJmuFpB0hQaXzRvDKVpPTQ6QzXiDAzMvdiAmCKMYSeC0+yfwSA9LEd0KnVcfQFtWMMlny4q0HY3sokV0eyUoRV2wGGHmShrn5zKddgrWO1ZW9vPnNN3HnHafiZIu+uwxMtiGZ/7D1wlQHHxFNXjzeMWgNb3zbzdx6xxoex+6llmc97VJWlgd0TqM5Tqoukd48LeCq9HFG+5ELaR6DWE+pxqJiSX0znWam5+IrWAvi3sIquVkwqQoe7rz6Ax/a9jCprZ2yA/+du2j+r7TDqF6Y3nurY33QjJ8PlSYb+rnT2ey1bStsbM7oujCnwi6PcNhZsELMjVnWNuPRyBqCsabTGePxjMlsQucdxsKgbRgNW4bDBlW/Pp10rxtvTN8vIlkw1Mihl6Uw/mdihH6ylCRxtkOzegbcB6W8rhQXgxm7Tj9mluy2R8w/VJIyk3M/mnKkbBH+lVVgO3Yt1XXZIhENAPmAtajVpniKwCYkHuBUR/2n8RUs8YA+Ux0HkF7zFUmLtuvQzoXzRzx0SHipoUtJlzQkYNLU7AwIUq/0mv2AlAALLqxbFUGbIZ3AhnbsfuWr2PcVX4k0A5h1GVYZH18KxkeIWfHUwhujRcI5mE7RyRjdHAdXU9cF4GAb7GCAGQ2Z/sM7OfaTP876G98cwHDXIeoxabvogzGHhC/iskqZ9UJ/GIyJrKDnau/PDIlrJ+V1yPcmq2PbgLXx0K/wAhvAlip2NKBpllh/+7Xc/P98G3e98lW4v/oTzEAwS0shwFU1ZCadTNHJJBwAN+vybrTCF2KcSJl19GdyAaU1eJUEclNWVefQpWWO/MgPIAePMJ10OVg3bMMJfaGmtyLOKJ2NXSFMZnpXN2rQaQe2ySbHQNEgGSVhiPKuDleo/P7bkVAvoJ3BxZZrdJtr4itpQi949mW89qI93HK3cOzYCf7wLz/Ed3zDU0Omw5Tydi4DYwkFistQd65TqlfdHxI5gxX44794H5s6YHPzJM947BEefuF+JJlYTU849CwW2Re8Xb9UwKzWZmTLVJLy1lt7MUguaVRKtlpIpbqqQIswFYPH3L2l4dtQNExuD25rtaVux7aXpjHQ+Zw4Z5zWjk/OA75tZbk16xvTsPVRleQe6vdraIBUdYQELqHrPB7DoGkYDAoemjl352QyvkFVP4DnvXjebFtzAzr4GeBRvtNgAq1N4BQmOd8HQdPLKGyn4E1fUiLItuxmW+FVLa/O+eM7dNtDJh9NW14pkfvOBSEJeQd4kjR1NeczimatIgW41IInvnIAeQ+8xbwVURtO/F+KtpMu7XVW35cfni2QT/H0LgBFp6BiogtA4pj5rPwkzaoE/EIKpiin3G5HyQFAqJPz4BRRg5iG9fvvonnhCznvm78dadtwJHcbBJT4YBWwUQiFaaRVW/txTokSiJClQamGm7LxD+9i/Zq30L3r3eh176bbXGfPDxyB5xDGs7YsWIOK9FrVYwvpj/i8HqufH4/tekVSETU/FmrsbWw6ScNHqJn4PMGNjccMGgbNKn59xubfX8Nd73onw1/6dVae8wyGz3kO9glPQKQNuzmmIaEY6mMKeNNX7xNYklQbzRwks/t6Iab+MWFWiVikAT+bYS99GPu/7EUc/fn/ysApDNotScPCX+bBkxl+nHRWgIVXc8txhKF4XM9SUX9O81ACQoYQPGWieXEbAVFkZJ9x9KKGVcu1VeeX4aGamfFnExbxObtHvORFj+VnfunNnHPufn7nD97Fiz/7Cq54+D4aU81UtAcgdt5r3ZeKYdcCeXEaAec6RqMh/+v/3Mg73nM/mBF+NuYrXvJ4DpwXsgDaOLnrp1RLOJrLtHpmPzFP7opqU32Ju6iAXK8dZZUm/xwILp2LEMszuUPBAps0iNV7d+iQeZJ4W++pNY9KPHW+7VLfEMmrerO0/a6HM0VtO/hM0+oLus7TNKYwt22nQJyL0Q0oQsz1Ac4po9EAFcNs6t45nbh3NNZcLyIfkc7eYFTvHa222Ubfbeho0/khxCyQEkyZSTtOa6k8N/lj43SXSvBuX1W3xaW2bWu2llC5DM54EFgir1464jHr3seMiF0QRrlWCVRVXCaa0bcg6WgdDR8lHq9dgJpU3CYIoAQoQjaNflm9KoSPOq9tx3gOgptrABEcBYbgvdIls3YsykAwy6dhiWVKPGcpAZ3wW3i29h9ZqhQVAuOrbMcK3cmTsHcPu7/ghZjVZXTWIW3cPpksx6a4p0NgRji7NAEAUv9Gi4VpwgFgfjZh4z3XM37vPzJ+7/voPvhh3K23MDhxguFU0fU1Zqu7cPFAOo291NvWDFkJTX1adXOvrRFTpsMitruqN2CpX2t9rI7AILpmststvUyJlVJA1YER7NISjVdkPGXyvg8x+9ANyO/8Ie1lF9M+5kqGT3gs7WMfh73kMnK8RTdDp7NsQYonF24DeCIczdOyuIfCuMTyJELPGOh/3iu+jHt+73V0963TjBKm9oiXoN0IqMhsh476hOmsAAtr5PapG390Gb1kpq4sbhW8VAOVhH2cyAF0p62MOzBA+osnM8PtDLm9uIQyyYKGkSIQIrAgmAe/6osfz5/++fu49W7HZFP4yV95G7/+mn+Fcz5n4nRJS5I6uVEpO0fmxxWQD7YiBR6G62bdDNu23Hf/Jq/9nXcyllXGG/fxnKsu5llXXYy1gpuleCvZwhtrlJRwQ5IkZVnWXSE7r7XSoeQVA4gPJufUzz62sFJaSHqURZlo68zAnE58BRCOH0h9uU1lKOFzZaxrN4BSpor3ZxdUrK+pcZ7nDxphMvGYeFBcqP/Wrk1M0FfCQRUaY2hGxnVT/WuL/shAzQeNlWPS7lx/5/zAO99UuaNPq85JuJp4dPTcJpxMGkKNciVrzTBljN0K6VPD0wzQs8JPAHzcJ9sRLBbiNCYviltG47wtMyOug3kFIApMIMR0hQ8RaIS2xIzWqRSScSNZVvPJ3qntScN+gCFJ9QrhWnHuekVdfPUwXZr1mp+jEK0opjy3ArQ5tc48yPExUBUNsRqRAakLmSknJ07SPPX57H7Wc0gmeY2Wg3q3R6VSxYyfkutlCMHU1jYYYPrWN3PiT/+U8YdvxN9xJ7K+hsattQNVGtPAaoMacEsrMIh4NO5W6M2wCmj1+U19XZqbMTA6mojqhHnbZCNKnKwqJcqjeBqvxtw23oddVUTQigJOMW2DbZuSWC0CMTNoaVyHmXr0xCbu2n9i9u4PsPk//xT27MVceJj2YZcyfOQjGTz6kTSXXg6ru8ArfjxGJ5OYHTUkGEtJCYFilZbSN6GbqsmnwXXuncMcuoTR4x5D97+vofFJbw/KqGgcSzFnnG+eFUbQNNwx9tMPi9pL1Clq41nzCVJWgk8JvrU0SXtUc+0elWlVT7D5y3Qbdbc+7dBCNiOGQCzYvdry77/lBXzDv3sdy7v2cc1bb+Lnf/VaXv21T6LrPDlXAiHl8jx6zvEJ1cSW9OCUrRCYTaeYpmXJGH7s59/EjbdOaQcW2ynf/nXP5MB5q0ynMRI7FrLlELMErKneSWxp6+eg0fRNl1vBWOpUDdvbptMQZEaov0aQKEmzgLiwhEYUvLvNt/Zj88VuR4pY9cViEcBRAmTzEdQxe4DGhV9VPO2m053jB84IdZ2/sG3MM4vdTebm8vxciHFlPk17pW0N3otnyq8MRuYbT/fZXl0nkjpFIyM7TXAR544Rwen2wj+76LRY4ypFtO8WKJi5x9hOO0viJ0BelU4CsGhUQ3xFOnEyAd8MLKSMxrwUqoSyxNMvaSQeuWkQK8H8X+8KqYV4AhVbqOi6D0YZ/CSkkRh9NGen02uTslAL0BCcW7VnjvkVYdl3P6MJXhATtIHbnNIZy8oTHoe54AB+YyP0gRJOV459lUFFj5+Z7NLtvMM2Le7EcY7+7M+y9vu/x9J4SjsL9dLBAD9s0VEDorjOhWaLwbcNsjSMTUiWAM3jJJB5Tl5fvfGse7Wax77s+kliJ7vASABGc78VTB2uSeUwHwcB4MAOBrhuyvje+0KGTiSAgbZhsGuVwdIyVjQcjObAT2bo8Q3c0TW6m29j9uZ3stE26J5V5NBBBo+4nOWrnszSZz4De+hC/HgSAlKbBtmOT+dhn1Nsk5sQCXK1sex60uM5/tfXEA4GlJjzq4DZPjc9M3RWgMVj7r7z2HX7z32/iH2BGI37Z+cEo4Aag28aJvccpbvrKM3552QGkYMCt90jXS0a2Xkx78zn4iI09CaeqtJNHM97xmG+/Iufwq//zts4Z99+/ttvvpXh0PD1r3gCzvlovYgmUu1vC8xHSKdvPHR5SYetba5TlldG6NTxfT/xZv78mnsYLK9w97238x//7TN4xpOPIKR0zsTg575KnNeWRGZSSbUaYMyvP6H/oSyrjF5zkhg1hu5jt6LH1qAZ9CwForF0I3iKJqfTzfe4ds9NO/X83DgY6jmYsudQscWeSlFcZEVexG2bgOqDp6t+KGRbc8QMeFg3cXmxZ8V1h3s0VgyNEeVi2NzYfO9yM/zWj+fZqt4I5nxXJVarx3znGlTCMbzvWNV5YJHqH4L1UjxC/jKCXbIL4QG64SGTV8WL4oipvTVssxN17Mh15ylhjSS0IjAT24BtwArGSmEc0fSeNwOnNXMaAKrnBw+PzSF5pT4xj01K5JTWO+m5CdCkNadly2aeAKWCms6SSQAgVzrmmpAAlTRar7rxGLvvHJYfcUXo41mHHbQFzfSWYFUHqnnt4gFi62vc+6u/wv0//fOcs3c3ZriCRsCmJuz+c97nthhjUSy6vIQ5Z1d4UDwDpV5beVJtQRT06hj+Dltn8dHqkg63dB2CrYBnWTiqhV+jgZck5SYpkYoWw5yCNQ1r9x/D7d3Nnhe/iOXLL0aMxZ+4n8nNN7P5oQ+zeeudLO/bw9AIqh5aENvSeBNceVOHbkxxJ+6lu/UeJte/j1N/9tfYQxew68mPZ++rvhK5/BEhdbsGi2MGrg/EcNK4FxMLo4uOoK3NySglKvSpN3XnnWKfMJ0106ViP6y2CXnXjZASQWUlS4JO0LQD/N13sfHHf8Sub3gVjCcBLevOeSr6zHRnrrKl75UsuJLWHvzeinMl0rnrHN/y9U/h5o/exxvfcjOru/fyS//tnRy/9xTf9upnMBq1OOfpOocqOQZiu+RMTj3OwawLqHY4MKyuttx443385Gvfxt9ee4J2ZTd33XMrr/yix/JVX/w4rAlmrJCCWbNm3GtKxeBVU8dWzIYqYKvSYrL2UfdPBeQRAdchoxFy68dY//M3wIkN7LnnMI11kcgQg8Ui+JzFwASHE/tPV7//vacXYyHSIPUcrCTW3LCmPf7gq/rKHLc+48B7rrrsbxuWxjMXzsRIVarGRpkbqsijvSrDxjD9/9t780BbrqpM/FtrV9U5507v5WUOCSEEQhiDgrMiCDSKigo22g12O3X7k1axnaXbAQcQh3ZAZGptBBS0aWRQFASZZJ4SSAIkZHyZkzfe4Zyq2nut3x97qF3n3vum3JeQWB+cvHPPqVO1965de317jY1FacybzYI5liJt3bVNccqoNI9q2hZe5dsRjCMLOg0MWmPDtnvmKSfYob+h/d1ztpU2LD3S2+bXvnv45AMeTKrC3a4x+GFRbEPewiNh090BAK/CDp7/IB/dQam//ndCBsmR+qjEYi56TNF34OytX36Z700jRVovvY0/rlddHotELsLJCX4Hokml0jn7QSPJgN9VFwwuGXAWvOd0lGefnRGn2OM4GeYaFgRvfIltwVWF9ktXw/7t32KFS5jdu9DOXBRaXsXPBASToAbHYwsHOvN0LF1yiV/njIlVyUJBstCT0K7kLA7t30al5AsB51/qQghqyhXizxHvatLeRDMT4nMUblbKkCpAjBIBgU2BjdldGH/DN2PPz/0URg99CHhpybenbSDr62jvuhPTd70H+1/+KlhpMRqNvB+FAnB+B0ZGQFSCqlEyOblpC/f5G7D2xRsx+9Anccbv/SrM13wjYnISDu3t7yXipjKSoTA+3QHgxTHUhGiQ9FXHyraJ+L9bOGnEYlyUn2mKqi3btpyCvLYRnbhLO+WiAGYN9v/VG7Hy9KcDDzzHq+TiJBD1hXeySd/9u/VCgezbHqj3TyeUw+RX9qGCThUrSyV+6388Ff/j1/8R7//wdVhZ2Y2/fssX8dkv3IHvf+Yl+M5veyiM8UlX2tqG7D2xd5oeTAWDyGBxoUJhGPvvWserX/cp/N07r8KNdxpUkwp33Ho9fuC7H4lf+K9fj6XFMoToEshZkPOOQeqAtDWh+WXPdyKLgs/+8UuWf7BingVCVI2m4yQUQGpbwBRgFhx62aux8b6PoBpPPJMXCQ5d/iGOOyoHYJEEh2BaVxaXHXVydDekBHWmkC3vZP6M6BZ/ZyvyHBfdcSiwi+OF4gMehzDuOGOzsqkadwlsCKTYYDZXHf/V6SllhTPqNeeTZG1qnM49I3Mtj2OErZ0sNIa1xKvFxTyec5u1Z+6SJ2k9URIIu040h/AQYNOaGH2R5gjfEWHC4hSj39sY2N9NKCJvgjBGe/c2zslOyREX69TSJGCFkELmAXQVRjNyweFkkSjMdQ4phWrIEa+hqJmv1NnZSIjmVsf4xhi/ey0KX2hveRFml9cYkOHemqgpv3XWgmiGiyQv5uTfvw+Tu+4EFpfR1A3YKgQGYIUWvs6KQkNWUU8MnWEsfsVXwKzshrYtuCyhlA0muj5o7FS6sf2xiQSG4tgIe0LhnCcZnEa3N2kpnLdbSihph/14+E2TL0qoqGeHMHniE3Dqi34fxTlnpzZCFahGoMVljM44C6MLL0J50UW49b//NMzqBqrxGBLJBQTkNNwjAaQAVQWknAALBHKC5qov4fY/einOfs3jwQtL3VMrkj2KneN2otaUj1c8LphqKFgPgpSSoF139yViQSrXGm0/uwB6XB3Yc6ySoHOdN5Mxmmuvwc0//XM46zd+BeZRD0/EFPm/8cGcv9YR2rFp3UnnzJ78sEvh1hstmAj1tMUDzprgN3/lKXj5n38Yb37rFZi6Ch+99BC+dONH8JZ/+gKe+s0X4Enf+CCcecbSEcdiNq1x6eduw3s/uhcf+PANuOamGSyNQCpY238Hnv/cS/DffvBrseeUEZyNt51QjEfb9qdHrcJgUUw5nPcNFBZb7wfRq5+WVrzodyHghQlw683Y9yevxME//yvv5j+uICogGPhSwVGL0jk3jNHioNMvajm5/IiDkffF64tNagoinczuqGb3sGfvyXaF3eEnlViETQMY8OF3hE6jtB3HzSay32TSiICzjue6a4ftChf8s01jkRyGs/uYoqK2bEP/A90ud80cKdt0qvyZ3XT6tE04KTlEAhmKrk3ZfEcnCPOjc6GRSNERFs8Y6GHCTpm7dSKFU5KmM6c07N3ERBRa6dHTGAUSHS/nfoJwvVRJF6kmSWo7IbDlaBgMCaRCHhxFJDLsTbDS+d2oZtrheUJeGFBhvOAsC2hV9u5t54oQkuZrfqJ5hG0NA2ADowxuAWe9ptrvPAgahJspS6AcYXrnnaALz8eZP/xD/qzGTx3i4NsR/SyyZiOO46aJ6DdxKX2pE5Dz2SihAhUHEvZCnLtIrjxXUqTqDF8WQMJ9JmOghgA2sLZBc86ZOOtXX4LinLMhdYOoQY3rliLkOikqLH7bt+Gseg23/8TPwBxqMdq1G3ZWe1MITJhIXptvxAIW3kxVlRg98GzMvvQluIOr4MU5+TI3Npr91w9WGKDwkTtwGCQWIJP5VYToGfKO0Vvc2LuFk0YsHnHHLXd86axz/2VUFY8bqUDJJDbY64UowIyqKjH91w9i7/P+G075nu/Gwtd+Ffi0UwHyyXdSFEkgArnKp89d87hveAabdhjso1KC9xOpZ7gkntXS+Q+CjBZ9yVwwpus1zj1nGT/zk0/Aox91Nl7zpsvx2c/diRtuKXDn/hqf++JB/N+3X42HPuRUnHvOAk7dU2FhUoLZ1/Y4cHgDe286iOuuP4zrb17HXQcEdasQMKazVVx8wS4877lPxLc/5WIsLBSwrU1EhwqG23cn3KFDPg0rAxAHYyWFPpFzPnTMWaC1gG28diescPHBUSKfHCVUNnRkkBI1Wed3IbaBrK5i4/NX4fC734/6o5fCKMHtXoKFIqrOIqmIO1kloHC+LSJ6GcrjKUAVpSH6W5P0Pl89ettC5D9Ktm+c5ORYYb1jQz6PRLYt3l47HoQCKaxzKIvSbFj7XQD+6Fgva5h+vyj1kbOZRVGYsDZujkLY3nmwW4nz6iSbDumfzAvTNOzbOZBlq/yx+S4eN2K0riHAZgJfY2K9uWbn7/tfE7bsBCGZHuIWsKMnweQUhNemPACEcDwl+Zbb7VMURXcpdE6JBiDjiSJTqnqbUQt0+2jMFV2j7hGhoOFk7YjGJvITEK7FxoCLIiRUcV3fNWo+g+/U3EnmN7cKBURgzjsf7cMfjuk/vA+jix8OaVvvFMucItoMG9jaYu22m2AefD7O+dUXoDj/fEjbekIR/eqSQwNtnpdboNukhsiQ+FIEx1j0JwP1f5vWM4064bB2MnuNemFAhqBK2PXtz0Lx4PMgs1nYjCE4ugb1kwgYAmlmcCAsffsz4KY1bnvBr2B8+y1Y3HU6zMJC55RLXTgzl+RNFkWJ2eE1FOeeBl5e6jV5syNncFXOP+ycgQARtNff7IlWvIFZ/6X3z87hpBELALDEH62rCpNZgxZh8OO+L3M+8sLfoJoswl7xRRy49k+wesYeFIsLUEgI+/HG9NxWFn0P0kOc1o1uYDkSEAqMFQSjPryUQGBVlG2NevUQln/x17D0vd/tuXWQxbONGntWKnzvdz0Gl1xyHt77wWvwzvddi8uvvAPX37SBvbet4nNXHcDCYoHxmFAwB+0A0DYWG1OLaW0xbSyEgNIozj17Gd/1lEfj259yER71sNMAAGItWAFV318uDW57+avQvvtdoKKAVQVJ68cqLnRWAOvJgVgHtRbiog9CZnAiBCcqhNLsQRiqeCc4QnJ2sgfXoKsz8MIysDiGDU+cQcyGBxBHyu93aRUcDiljZttPPv4LV2wc+wwhEBmXblm+ZXLdEttbCNJOozu+C444eeGOAGAY+4iCT436nWbcRm9NLGIjg7I7+KYYQ9/cNvozZUX/60jXWztkT2FDL6ZC/0tbWxgOQiguhD2eNS9BcmEQSCERZLtiIZQNY2x6Tl6o4w3zC1v29qQQi3h50m5R9c97NDLFRdq3sVsDjtyc/Ns+Cdm0Je7Wq+iwOPdbjYcEduGtBJT2OD2aEE8dyr973w5FERb9PO9i3FlHQpJ3q2thWAeD4xUfoWxxZ4ohUFlBpzPI6uG5/oT1IadX84wiTEAyDK1rmPPOx66f+WncfssdOPTpyzHavQJUlSdOKuC2hrgWsryMxW/9Zpz+48/D+Gu+DmJtl8G3KOaSJG66MXMd6Q7wWkMv/L3PRbiHRFueqKtFlRyP04gmwxR7IUDG+PNOFjF5wpOShrAzS3iTVPR/UPHyRkQglrDyrGcDu3bjwMtehgMfvhTV/gblaBHFeJKiPggKNxM412LWttAzzsTZP/OzMCvLvT1Xf/yzZz9X3xLgTfAAmLHxuc+hYElpzLtbSZuI8k7hpC7EpeHPtKxfWIJe7NUungVromvZgATNRbmyCzKbwd5wc1eRF4FokXqNA9gvH73VXBNz72YKwWXZ9bwanzrPX/LEQuCwse92TG71CSMNFBTUgGwYbSMAKx5x4R489EGn4FufdCE+e+Ud+Pgnb8HnrroNe286gIP7WzQOcGJAMGFnL6gKYHHF4LzzlnDxhaficY86E4+/5AF4+EPPwKgysCH7HiuSx3W0rdKXroH5/FUw5QhsLVSCQxTY28ckpP0Vn3grhqnHsc1VxmE4ejsxqM8lB/ZjwmRAZQVz2i6vIlMXfCm8QOTw22R3J7/LGpHDIef2UlV+7HjmhypihDiSrVZDjgIgU9pz5DHZ9TuBngm/kzqfBbipcdhfmWKPyHwSt6ghQm9aGxO0YxSqDIIwrgxZwQubRh/oWvkLgG4AaE1EC+fkVCI+nxlPdmS/bzIpHwUIWut3fvO7ruixnmys4brdetGFzpk8m9lmUFpkvRONvyfpOv2f9f/y/VKA69WGRsvVTq9WBICFogYAAGmWnTg6VFLSIORD1Z1Ct+59VL1HihAIRD9gM+6DBSoNshFPPo4+hBLdblTD0xY2PMGNIztn+CDmP6Ao0AFHWXvi570cFtTtXknRxa5s4z/bI4jhvOMR7OGDaG6/HeMwn/tm6py5ztFJ8sJb2YCcX3fH3/AEnPmKl+HAW96OjU99DNh/CASgWFoC79mD6qILMfmqr8HC130NirPO8bMmVkfdUr0f323JLALHCuMRcpAka2n01cjMHd1poh9FnDe9OJFuvBReUxxDb6sR+IzTuu+DI0vinACEjDcBEcDsHUcFhF3f/h0YX/QwTD/0YUw/8iHUV1+D9sBBoLag4N+nkzHozNMxueQS7PrOp2Ph677et8a5RKSB7rrI2xwfePILpXeuB/S6q9Fcejkq9dFAIt2vENZ2bJf9+G7gpC7EhaEb0DQfmhAurp1Da8owpaMQiYzJD4oGBkjjMXgy7k20OBGirjsJGI3rQsjwr9rtZKKKMlvwo0xKTBOAM8GBZddKWlDiTggEGPYOnXXToiwMLjx/Dy48fw+e9HXn4/Z9q7j9znVcf8NB3HzHKvYdaFE3fpnZtVjg7DOX8KAH7cI5Z63grFOXcNYZS2kyN60L/fALG/VnC3g0AlZ2oajGYOt8lUEQHBvEhEV+EYsEyTtFh+1Lp2GIz1VwLycg+QZEvu9TJfs9ioiAxXmfmLDL9s5rcWKH+xUW0VId2MqnZTy68njmh6rUUA61JcLMSJVUQ7sCMSRkPgTJTb43XD4T1cmE6C0C+pQwPdUXDstzPlBfcRzU4V7oRX+Abt9RMC2B8Xzn9JmicrtzPiuRsiyD+IzRQnWq4RKqCusUhWGfmE3J51pAnNKa7d7iEtnx9vS5qp8jLvuwD82JRa+6cHwWupPN/dI3hhR6EkgFACX/fAchHetnhARCEbEuSoqxoK7dNKcCjs0G0OUqCAmrKPjvdHcr7IRtyJ1hww47kjaKNUYQdswAqSQhjbApSkXi0pwJiZhiBELmKBn/zqmgBmfC7IFGR0U6JqUIac/TuTrCSSFBlnMOGFVwt9yB6ZVfxMp3M6gou914ZEPhjJ1WjDozSzyuAOAEQoTxV301znzYw9Ds3QusT31isdEYtLgIc+oemF27Q9/DdaIJJGpANt37zflh4rX9iuH/G+u7xDXJEELOkTgPOP0mn9/daGvvfecr45CccJwFuVlYPzE3Ppn5K5jalTjk/FK4xqJ66EUYPeQhWPq2p8Hu2wdZXweaYLo2BpiMwMtLKM84C2bZayqiNseT0Li1iw3I1/IwhymQFOtAVYkDr38d5I59oPGS12ZHWhkmVriD9y1icf4N18m15zzwE2SqH2HnIDBeWxEfV+2eJd/PLuNZFLKd8Yd6Tj0Z+UwbDgUgYZISfKa8JIDTRRQkSFVVlbzTlLQzUDHHy5MK0i/sgM+62Vpfwnr37jF2757gYRcCT/haYH2jxbS2cM73cVQZLC2MUBTdY9FagaoDkY9AIcQdJ0AS3LRiHhZr4aYzkDJaJxD4xdWRC+y1CzuUTL0TQ9GIEFSy4W9GWnb7u4NgMiIvvAvEhS2MbUghnHJMRP8NAUai2ABDmD76+GuvPnQc0wOAPaRSHUjtiHMjpq7PiLSGB7WTzf3FwC/wWxskdgoLE75jbV0/wBWe2joBK/k7EsZOo8k/LjIaiEdco+MOFl6oiAjG4+I8AOf1H0WFE0Hbekdiw96jvih8cbP8XkcTC7JP+hlK/f0VgXdXglpshSioiNPCm48mxd1ZWMC7PnaLvihcs1ZTtTTaUXIRXD0kbToDgRAyybxKmdDgJDQoEJ4eS0izJo2OdWAnIFKo1ZRAStL23Z+bHUJSLoI68YUV1Y+zkK+lEzcIif+S15Kq02CnjxWCFcZp0FQmWo3euyhRDUELk2qUUFEEsjLPrinNtVxM9t45gbEO0jqADLh1aD7+Ecje60DnnAeyAjXeSTumTtK5syVen1+/YJBTyHQKGk8weeSjeldWwNv5m8b/zhj/qYSOmi4hXrrP/Q50ZDmfeATEjWqpigKebLrCgMqxHyPjHVUpyJAulNXLks3hlpSuSK31c8MCvLoKd9WVwMMv6uqaxLUnbiSgMGm4gs8EAKhA6hogRnHm2SjOPBtHgrYtUr2aFMUdTS1ByYuYwydEw8QJo75GFz5/Ge56w5tReRu410CD4F3RgkzwJ95x37STSiwAAMqfXDcTjOQwpgLvCQ10av90nJ8g0a6oSr1wsvmFGVEQxvfx76QSiw962EolctFNXR8lERbIUKGxk/LhOrmaFb42A8ObDurGR2AwE4qCsLhQYnFhc7kE5xxa5wUQM8GwSeteelhJoRyiyGKfrU9Z7BxC1VBODlyd5pBSn+K4xnnNSt6OG76lIASjxiTRs7gGa4z26B7wqHbuiuVoCAYhiFNMyOI2opunqh85jlnh20dyq3VyI4Bv8CG23g8nPebpvSI63KaHWLtdRachpmMqfnZ3ULC+3Sn9GBs+t22dd+SMBE/i9FH0HK2zdTm3b6oSZrN2kwIAQFd0LpBBKEDM1jVun6nMmXGXt52JdD6DZtxiqbjJVseLT2yJuWU9NCabJ+FcijjXgjA1gDhZm+wwqQBCDjZl558A9nGxpghrhfoNQtbqfDeaHrHEJrTbAToHlCVweBVci18LfCUwL+/iAxCEq8/bQHAz60MZlb3WwXtWx+z0Id9VeB5Dvpfoe9EJRQLWN7wgBwAncPHZ1LjaAErkk0lxCV1bBeopaHHsBTMRKIakps7H7nb2c0VHerVuoOszkBNIU6NYWsL0o5/C4bf/A3Y/7yeg9dQL4cDmEDWbcaEN45rGOycXJqyVKnDTKVJCO1+90ZOi4IMWSzyA4MuQz2bAeOLn1tyk3jrzZLjHxFA2PjigYF8GAQziyufiKbyjOrHpzZF4itzc1a394TsRyMYUsA4qDlI3OPTG/4eF73qmX5uLIjl45b4LefBqPCFRJISeXGlns0aYYF0baK7CdzxTxqyiPIwRwSkI1VpPWgvG7b/1EuhNd4FXluHiXBaAIVDxrgFhPu64xuKkJLTJIaqf33Czf2yNAYsNCzHSvIiIOzwokmoyJQ9ThAc80vFsYGNZ9kgUlJOqNPkdgNMzHYKSE9sk+MqlfqcDdJVEk6gGItMlSmWRi4IxqgyqyqAoGCI+CZa1AtsK2tbBhiydRIxRaVBVBcrSwHSZCn3fVfsPTlRztX5nYZ34PC8I6VhTvDaS13OMmCNCKt8c1dqGCIYBDrs5Jvg+x96lHQg8EQknU467go5spJun8DVEoLCN/Xut+F+Pd27sPndFDZmP11ZRFFHrwBA1/tUVMt4k62JjRARsCM5hjYEPHW8bjhfjCV82m7lXlGWBprUpQawX5JKVCJVu7UMUNF0niAjGGIxGJcbj/qsaFUGb5ZO1EQFs2BHhh01h/p+/XiSIveHYhP6OU2FKs7R6qJ4fTUBxeFtGoN3vuzW/01g4F59Dd/XRxu9EwERaMDujDKOEQkNivfWNsAPuyERnzklmdwDINhWBWFhfuwK2QX3VdUDTAvCaBadeODllOLB/7iRQc2nhbrkFbn0DaqJ7o8LAwaCF8WX6/BrC8EKUw3OnChbntYPNFPbGvWkX65yEEMBQrj1PeMEMHi+gve1m2DtvQ9RGpoyd4X4kMxaiWS7+HohqXd2/H+6Ou3z45KzxBSDXWhz86/+L9vLPAQsT6HQKEoRS6d4Oz8h8RNK146YoPqOEWESLQiEyKgtIWcGVJWxZwpnC99Na71syPYz1V/wp2k99xrfWRV/ubuO5iRAkrU40aQC8OIEslkABsPGaPdjWzwljul2/5gRvbqKpprHyv3dwt9wBUUVrW2hRYf39H8HqG/4WZmUZ0tqgIfft5VQBNc456XzUABCzL9BWluBRBR6NwmsMHvsXjUagyldCjeSiI8xJGG5yuhQQxDoIGGZhjEO/8WIcevt7MRovQLjwa6kAJAhVdcPmzJOrzevB3cRJJxYPue2Gjbpp/6ox4zbl9w+1Hrq87H1HqaSUCOOYuRtmuw+ae2UcZJ7xbtrWdZOWPbXwC31pAqvuhFkUDKlkOvVJQVQbMxOMYU88jH9PgYTkqmUNdrDY4NRHPyzZh/Dss/VllZ10NSeiJjzKMEJ4HtDl3YsOl9HUko7Jd3LIw9f87kgyFXIkFRR3KxnEKRag2Cfl1BrznsfdcN0JpdMu0L5XrV5VFjHGOraUk6DwRChGXjsQOZhCURYKgs+C2bb2sxD3TyfShuNFSfSytQ33nt27FtDU1pMJv4yEe+PnSVp7Q26E2DsvADQ5wHe3QBEzzvokkIrxqPRLVo0fJ6LXuQZfSOr0DBqfo0hKqf8SVV9ljFAS0675PhHkssJQcMzfXFwvX94V3vQmztvqrSiYSUvCP9790d2MS26+XhkkJYDS+1HDjMfAoTW4629MmgeKi3FqaexboEGKkJnRQZsWzAbtlVdi7bNXQojhigoWFIS714+IsjfhKgFCKIoxpp/9DNxdd8EURRAcIYAgZGj0RQMRsjUGEh8FWuvAVYX6s5/D9LNXAFzAmTIlz/LTJydJBIhDsbSM5vprUd94Q39HlvmH9Doc71TciDmfA2V27fWor74WNBrDtQ6udTCnnIqNz3wWd77oRaDbbgMWF4HptBf+SfCRD7GuUqL81N/1+z4ErSqz/01ItW1cqD1U1yhGI5C1OPD7f4ZDf/BSuKuu8v4EziGVgEYkSlm3MrYRzdysimJpGVwVIFiUpDD1BuyN16eCasmMHn+c9SsbrbRBIFVgYw2rH/kMDFdomhbWMOAIN//2i3H4n96Nctey/3Vbg6wFi4+y42wDGjdz3SaAOq1zuM/5+6QhJ3SfhYWiX7tFfYFIa31Wz2kNmkxQksO+X3sxbv+TV8OYMVw1ggNDhfzyGXbbJJ4Se83cNiHodwMnnVgAAJfVexTFVaZVsHWIhYMkLJBJ7RgmafwM1IVexWME8AlIqMtkl9z9SL06k7rz9V999RNHwcvwZifTVZTzh4RjMw1DmteBDOX+DHEhiXHbPQ+BXDUt6Gyt6P7tdoFpOw5k7DKWXI5KHZCkMUN0EPR61E5gxT6HVcArf3zj4kgIR0IREJ7gaG/vOt4tIKyCkgBt6n/W0rzvqJNgGyyfvnBZPbPvKAoDQjZGqSsZcVQF1C/7hhQiDUYjAwc9RIJXLKws3HWi7TgejCbmIIv7r2vr7ad37554LVVUj6EfEpmLOIoSCNkaF96L+LTyKVW8AGVZwIkcsrX+YDGmVwOAs/YyBWlUi8bfqmjvnP7bPjkQVZiimC4tVwfn+0Rw/wDFHaqElNMBndxKGj/E6yHs5ByKktG08q/atu89zqE8ZhRKKAGUweDAbFAUFQ6+7e2b1dlAMm32N6Y+d4s4B53V4MkIt7/+/6G56XZgYQktG1g2vjhW2KcrYmI5glhFdcqpmH7yM7Cfv6q/o49hjlEWRIfnuJqpb5NaCy4M9v/dOzD7wjUodu2Go5BUCZTWjjwyn6xDtTiB3rkfs49/AqjrcA+8AE7/5q8YwgmBtBYgBm2sYf1970ez9zYUozGcdXDiHaSLxV04+NZ34M4X/ir40D7Qyi5gNkNXs6kb322X1LApymY8ombTNA14YwPGORQLC2ivvQ63/MILsPrnr4Mc3MD06qs6R07JdtTpHnZrbTfRfbVshDHSuvV+FoZgpjMcet8HQcb4/gPxQQuLp2Ra8vh5eDkLbVusf/BfsX7plSjNCG3j0Aqg4wXoLXfhlp/7eRx45atR2BmKpWX/7Lc+dJYQNg0ZyY0amBT6jfzB0nT/aG7GJm12IhyBaKj66zUNTFGg3L0CfPYzuP35P4O7XvoKaDGGW1lBwwWEfPRe52Hck4LoXXCHcI8QiwffdNVts/XZ31bK4NY7SiF4RMciL94RxR+fL2LzAi3+JZs+2byLy0SS34Nkm2EA+dLhbZamgJbGe5unU2tPiRA/SpedvyZTf6Gbb2WnrEDH9cPDQ+jtPDQyLOlO0IndEJKq0j3dmk1YdH3MNzC9sWIk22k6Zn6jGs5CcY+iXi1cEWG/KaQ25h1fceO1x1YbZBuMQC+b1rh8PC7RNhZ13aJtrM/eFx4EUYK1XmM9qwVr6w0KU4G4hJu5V44Xy9fdnTYcLxaXR9cWxN+3seHetbw0xmhkYJ2DE4ETrx2wzm/AOk1Mb+8FER/xYa3AOoembeFEUFUFTMFYX28+amfu+0YT/st0YWs/qg4fLAvGdNrAWos2+OH4++vvU9z8OQGs9YR0VJWoa7x7q/4sL1V3NY37jaLwIdC2dagbi7p2aFoHaz3xSRtk8QRoNCpRGHMrO33+ePfi/CO4YzAgFOLNIIYYJILJnlNw+J3vxuwd/+wTLDmB1E0qPS11DTRNGgh13mFWa4vy9FOx/v4P4sCb3oqRg4+QSObWQBJUky8YEcOKAouLoJnDgde9AfbOu8CLi77MdWtBtgU512lIgyZBrYM0DTBrUezejY13vQdrb3obKiLwZARV8TvbRKMJ8TllwEdoicNovIjVN70NGx/5JLgsvINfU3vNpnP+X2uBtgWaBlo3kI0ptLUoqgob7/sgDr/pH1As7YJlgkVQoYuAxxOU1Qr2vf5NuPPnfwm690aYU07xralnQF2DmwZoW5/aPxPuSesbVwkNArptvT9BMDOZlRVwYbD25jfjpuf9FDb+z2tRqIWywcZHPg699RafyyL4CcC61Bc01v/twjYsaGGM8QEBB/7mTahM6fPyGEZVGKy/9wOYfebT4FHl50TTQpoW2oYaImHMtLW+nbMZ3HQDVBSQ/Xdh7/96OcpqhJbIk78g9qvl3aAbb8Xtv/Yi7P3ZX8b0n98JMzIwy0vgySS03WsSNI5BvEdZVV6Eu5wTNYRNQt6+bhwbaF1D2xZEDLO0CLNrF/iuO3D4pS/DHT/x37H62v+LYjIBLy3AhQ1lLrv8dSTJEl9Ec5NK/27j5DtvBjiSt8+o/Emy9Wka7F0SQkRjviwgPNOalJceUYGQn1CR8mEk5x5veN5aNob1wtvlvCxmjbsLb5dDwR0jhHZsHZmjY37CvG3RppE3cf5+hWMTgeq60mOqOZuUuZ9nSglE5kvoyBhRz3CE+GVk/UDY1GXJhmjLAet23J04DMueCCYqONTIx1xl/nnrXx87JqdUX5odbH943eJli4ujr3LOYX3DC1kjftEVEVgnEPVJyJaXJxDFejOzfwTrXnx323BC7V4svjRbl+fO1uUnyjH/yGRSPQCA391Yz4i8CY0700IYdK+h8Fo7IkZVMkahfHRr5Yv1tH2Lqr5yvGtyXX7N0SmTpl6bvdAUo7+dTKpTV9dqWOsncmkIxlAi7C7UI6hKg/G4AoBPwcqvbdeftpZXMPNji9L8KAxQr1tY58ffBa0dgmq3rApMDEMVN9Qb7c+NF6vP7PT45ggVakIGG/8AGy4xaSz2/faLcaYByqd/G7QwwOFV+OI6BBShQpF3VAEmCygWgPWPfgx7X/AbqG67A+XiAtpAIDitKTHax19fyZtIFIrq9DOx9i//gv1/8Ic44wW/CHPKbrhDh30qacNQw/5fVZ9WWhRU+VDC9n3vx/5ffTH4lltR7FqGiIWJvUqaojn1v/hS49XSEtwdd2DfH/whzNIYo8c/DiIVsL4BRRBaRIFI+QKJtLAIUxVoPvgh7PudP4buOwyzewWNcyGiBoAqnBWUKyvg6QgH/+atsDffhlP+v/+K8bc+DVhY8bv+pgG1wXE1qe7RbVhS+frQA8Pg8QRsGHr4IOr3fQhr//hOHH7rP8DeeDvGu0/x5gVTwH7hKtz5Z6/GGb/5a5CyBKZT7wOjkq1TlO4FmGGWlgAV7P/TV2D97f+IlZVdcK2FAuDxCMVd+3Hrr/0azv2d30H5iEfCzWqgrqEuCHmGb3O4RygrFMsr0Juvw20v/APYyz6PhV27UIuv1+Q3bT6MuDzldLiNdRz+qzej/dTHsPjEJ2HlyU/E+Ku/Fnz6GWneah1IRfBnoGTWQKddiwdnC3mnSQnfsgHKCqbqdAHtF7+AjQ9/HNN/+HvUH/gosDrF6IwzYU0BJzbkRaH4APl3zl+RSbqq0PMFYXYA24iUncfnz3zQaAR++cjwD9WqXj0TRB0ROntT/EGukt10A2IiFP/kx7k9ny7cC+EQfhoSpsRwNFKFgbeDc0lYPXAXzv2TP8Hke5/ty5Xb1j+o0RmplxFO8yt0pCZ+G0wjm1TTudYj/xya7JDqPNstlpdw8/c+B8073g1aWYEtTCg9H3+twfSS7Y6oIykxJDRbG5OJoxvSnDJkDFq7yQhQ6guRH5KxdWB1uGsmv/rIu274TewQ6oPNRc7gp8cL5TOI8YDtjpvOrHWt/SQTXr64PHntTl3/7qDZ0CcJyQ8UBZ5iCj5v8xFhfAN/pDkfBmt1tWnsFVB6DwH/d2GpvOxI15utzb6fS/MCU5hHb/aH2KJ9tX4AIj8/Wig+fqTjNg63K6OKf4oM/TAVdMF2x7VWN5pZ835S/aPFlcm7jtqAu4HPn/NgqrT6uyV236VFAWWCGoIogcsK7aEDKM47Hcs/+INY/p5vB8564Lbnkmu+gAPv+RDu+ovXQq68GuOFRTgT0ldTjJyKJCr8SAFhvwVSEpTMoI0ptJ1h6ZnfhT0/+kMoHveVQFnOrQwZ9t6I9X9+D1Zf+irUV10DXtkVzqneURAdkYk5HjgKHyKAFVQwUFZoDq2iuPginPIj/wlL/+5pwKmnb9tfd/NebLzzXVj989ehveIa0K5ltOIg2vkdqHpCxVAUxQhkG7h9d6I4+zQsfuuTsfiUp2D0+McCD7xw0/nj+pKvZ2nYDh1Ge8N1qC+/Es2/fhjNR/4VzbU3QM0Yumu3z6WhgpINdDZDszTBaT/549jzQ/8JCPkujoT2i1/Aob95E9Zf89conMKUxmfyZPj5AcJ0Yw3VVzwCe37kx7DypG8Cdp+2/QkP7kP9oX/Fwdf+DQ6+/V8wOuUUtKSp5kkyaRBAqihNAajCHtoHsYLxg85AecljUX31V2P82EejuvgimDO2XsaS8jj+FWTLkZ5kbaaw112N+ovXYvqpz6L95CfRXvF54MABmMUV8GQRbdvCKSG6jErif36byi7kXwF5jXgpuHl9/TlP2HfrXx91wI8D9xixAIDLTnvQ9yxNqlfyzJ4uBlAmuKiGj0wuTtOerTd8FgV7JrWFKCVZ0/DeK/g6JF/M3CkKc8Ti4D6c+ycvxeSZ3+uTfdvGq6MCsUAMEQWwSTORqRWSniUK7pxMZDaUqA1I2oqcWDiHYmkRN//756D5p/fALC8nYpF+5VcDcJe4smO6ID8GlIelZowfWxGL0K7MQTgtGMHuqwDUOpwiigON/cyGof/8qFuv/xx2EO3hZqTE39yo/bbWuscAchaACbNpnLhDqnptweZ9UHnHrj3Le3fy2ncXdqZjUXmcQr9JgEtU5TxiPpsIe4gwIYURJwSmdRFdE+cOAHSDIb4Cik85Zz+2tHvh+mO93vrhjUcL8Xc7ka8E05mkmJBiTETCzApQDcIdhvh94uybF5ZHxxy10Wzo11lx32PFPg4qZ4jqIoFmSnq7YXM5Ae93bfveXXuW953QYB0HPn/Og6mU6i0rxj5DigLK7ItXhoqVbArY1QNgNph80+Mx/oZvQPWQC0C79wBVBZ1uoL3tNtSXX4n6ox/GwU9+HtwKquUVOPicIYy+cI+ho6nsEAUzEHunuYpLYH0NdjrF+JEXYelbn4zq0Y9BcdZpoMnEu1U0NdzBA2iuuh71Rz6C2b9+FLI2Ay0vIS7vHHbCis4unZ45dLvzGK1FRQnDBHdwFVicYOFrHo/x13wtygseBDplt+9va2H37UN79dWYfeyjaD7+aWCthllaRuMcJNYsgIaMu6HvUXtbGBRUwB48CF1fRfWAMzB6zEUoHvEolA99GIoHngfs2QNaGPmkhsHUo7MZZHUVbt9BtHtvR33ttWiu/gL0huuBW/eBuICu7IJUFdpQnZUV3vnSMFBPYRlY+danYPKVj0d19pnAZCGEaTqgrSHTKezqKtprb8TGJz6B+jOX+3sxHsNJ6zXSDAipjwYBoz54F3jPHix/09ehevhjUJ5/DrCwBC4LiBXo2hrsTTej+dxlmH34o6ivvR3F7l2QooSFzz9CUYsFSlrh6FdnTAmoQDZW4WYNsLiI4uwzUFz4IJQXXIDy3AfCnH4azCkroKVFmF1LoMkCqCy96TzKM2bvVNlauMMH/VgeXoMcPgx7862w112L9uovwu69FXLnYe84vDiBmUzgmhZiLUR8ZGSgQF6rT3Gld12JCxfiVwqHm9c3nvuEfbf+1U4+s/cosfjs6Q881RXFK091/CxLLRwXPsEQA1CChCQmKRU14kMW8lBk+sFYNyBqB9LOOh3id+wUd+6km4gFq0+ixSVhbROxaIO6bCtigaTy838Eswy6dvhjsOk3udNd1NCk/BKxJLJz4IUJbnn2c9G881/Ay8sQJihHN08K9QCiTYRSe1K1zaTZQCIYQYMMkL9MFyESVZpxy9QdGxc5ryVyWNAGTgusbjQ/f/Fde3//ROfCsWB6cHaGFVkGaKy+esgqM+9f2j2enszr7gRsLUttY3eD+HTDdCoTLROpUVFVxboTPexE9qnIXUunTO6WcD58aOMUcboEUMXEpV+riAC0IKwurozuONFzT1ftmc7JIqATUa0BPbRyyuRu+dScCK4+6+K3rJjmu1xRQI2BEHlioV7QF1xCmxrt6mGwAfiMFWDpFFDh1epy6ACaOw4CzsKccipovADnnA8XRJz+3nTlHytOOW7iAUox740CAhgqQE5h9+8Ds6I6/RQUp+wGlWO/nrkW7cYqmrv2Qddm4KVlXz3YufAA+vIBuVU16V/DP8IAwKHCJnkhxwYlGejaOtyBA15Anb4HumsFKCugtZDDhyH7DwB1A7OyAowXYK3PmULSrUUEhEyaCiX2eapCltCiGIGVYFcPA+uHQIbAS7uAU/dA96wA41HYCAmkbb1/y8Y67Poa2tUppG58wr2Fie+3KeFabxbwa05wdod3pC/YgFqL9vAqzKSC2bUILSeefIn3H5G6hrRTtKs+ysXs3gViA+saxBwg/tQaAssYBRewa6twa2s+adbKBDIaQ8sS6hQym8EdOuxJ33iCcs9uTzjCTfF7f42KIx9KDE2O2AiOmqYIrsWNhayuQpqZv5Wjic+quTgGJhPwrmXQwgJoNPJyjeHNZURQB5BtYFcPQDbW4NZnwGwKXd0A1S2IS5ilMWiyCC1LiLMQ531GfDi035QjpqjING+UCnQGWSEAjODmjelzvmnfLTuqsbjHfCwA4DF33rjv0tMf+GfTonpi2cqpAm8SgYYwSdGeeSMhqiajZiLTAsSwJ4GAlOFTQneK/Z5gx2YmtZ1/wTxoy1/H83YN6ltLtvtNXD4yphS9KSIVBoIWJ+2dgvmt65Pf5VB3qfj7pLUg9C6R63Y3tatjSQQ/MaMJNXrCOAXIGBycuQ+6kt605WDsICa7x3cAOGGheG+iGPEagDUAN53sa63sWjgA4MDJOPdkuTjpSceOCRQWQg3aPZAPoRNPyK2dAcbAnHYqbF2juXMdcvNhkPMLNo8r8KmngcsK4ixc04DIO4UqvP07pYVQeOmbntO4JnlCAfIq5lacFyhnngVtW9SH19DcfhjU+ofHFQYyKkCLS6CVU+Gcg7OtzwnBFIh7t/tN6pHwDOvc4uU3HgYiFo22KMYVyjPPgjQN7IFVuDsPIrbaVCXM0jJod+mv29bwqwWgsW9peYi/CpFNQYNh25kfu+VF8K5liDjYuoW75S7IjbcEH5JuyfGaJIZWBrywDLO78nlpnINzFtR6J84uh06MnPFwYsFVgerM0+GaBvV6DbVTnzUwkRH2ocV7VgAyaKX1VZ3DhjRuNIkCgYKDJQdeWIRZXIazLWTWQA4fDCUQyG8cF5ZgTjkNqoQmhObGNsYbwHEOxPkg4v1UQs4kbZtus7p7Gcy7vKBvLFzdoFk7AG3v8GQmeqVruEZav32aAmUCqgIoCvDIwCyuwOwug5++wjkLtW02RzrBSDGHDnIZE8mqlzNR02+Sbm5ncY8SCwAgyPtndvrGykz+GzuLtuDAJRQsWeKXWEwM6AJiosaIEDypMadGDCaCqLJKWoE44Bky2eoXkxieBXi6p9jm8N4uZjOScSPs8rX3VTpHYETpFCFOvu/Cy0ENygBJp8FB0JgkEpFfO45fxzRiryhcgjo60kGQnS/2No6bgahFSTqrHfYz6OWPvPXG67fq/YABJwMSszyIj/DSMI8VISQWCrUtID7KgHetILp8IoQuwjrYugHgU/L76S09AaJA0qCm5ymaECXsbATBcAK/yNsabBi0sgu0mxM58VrREFpfN4kQgXxUlo+apyBf/HMXr6qcThJ+x4HvhNBSAqy1cCIgY0ArSz6PRjdgsGqhzSwI8rhFBWIe8dDSzlHQ52QExxomgc05DeV8iEEjA54s+RWEota4e5FqKoyojfVnCdfluD4DSKqh2Mcwxk6sTz1tGKYcBd87pE0VgrJHRbwTZlxT43qIOKZeBjCF7DfWIjIOWlwAL3T5JaKTrdg2zC/qooHCYFJ3U5O53ZOZsHCGc0uQTda52BJfxGxhDF1aRBBJWQKzOMfijYuJHkMMStAsOfG5V/xnXnVC2s3bcCPBSd4F8pNp0qNMAkIqeTBYBRm32zHc48Tikjtvcpeefu4rNwp92qLVh7Qi0IIh4aGLhCAy+UQYAOSSnIBUaCdNAJJM8vqMlxp9EbKzpHOoP87n0kZHLLYKmst3D6LY7laEBLjBLJOrCzZdPZu42yFOWITfh51aEvihUmv6vjthR0D6TY/d47xNHSlHznzjZ35BUxQFmbqx/6Clz/44YMA9CCvQUC+HeymRJS2v/nkXsYgJDtITqOHZJOqck/NnJts09h7bhEA8MsLeKQGjcLIgG/dEFHIxRKGa/SacL76XXOgTpw1RuiYhaRNiLqN4uM9RIICGKJCwW5HsudfUzfkNVjADhYVINWp75zdVgYBAAWeB1nXrjGZnkhDtkPpJWcG1xABSYa4+NKxuPj8KxAJOe0uTX8tCht6U+EjhU/9nJq2sk168x9U/DIxrEXOTIApqZHIE3XglEwiOgMSq/Hqt3cTw4c3hfxIygcZLRrLY9bDb6apIplEKY6z+/nttTJB9aYMZp0yuaZs7L7wsVDBYMksO0QklNzwS7pE8FvN47J03fW5juvFyOxqh1CynRdxEaFRLCnLPSFIJDMvnxUuZJrUjITHJYXwUEFLdxPd+1xOfykBEYlKWWJ5206TPbk24obFpmyOAde6/8ZeZ9oFDkh/EGHBPkjZnCN0K/cUQlHoVZlacrIxUhlAJUO5Kqmv8Tdwtxc8JPaNc+MxZwQIs6qb+Ug1+7SNuuK45hoYOGLCTYFUJzpZelSwxvDHY7TqqEecxQtbLfHnWrjJAt1D0IPDOf4jnwvzbbnXxi3vG/SnkdFB0WRcjofEPejpD2oVnG6dccalgRI/toIhFTMtMgpQYq2M4obx3WFcQ+t5l3KWundrJw6il9IqD/g64u3jsddjshLIJcaw5mKs5XC/ms4jCMa3TnezsDb03cwliesS4jUr/ajpL6EcYpJiTiMgr9dMuKm5Jua9VASGWdKCgtUk+d+kKoZgAIWVQRbrjabXtEZjUiZDUMCXbSgONFE3C5E1wrOrTpGt0Yg29U80zB2VbUL/Yx8SSwNweWOL8yJJtdYt7N0mjtpwBJUVpzDp2GPcKsQCASVm8pkXz9xURqM11MZ7hdfaiONjZBA1/A0D0z/Dv43/8XUyTN5CXmLsiTvI02eJDGrIZeXVjX20Ri0z1LtVDmAIpuQ6lsLX0yvpzROeO5GOR2Quz3U4Ww9FvTFqj+ueOj2s3TX3HO/9TRT59u1MRnACFKBoCZrV9zSNuuf64a4IMGHB34byGHqICB0niJ6yl6b+xyF6ML9u0qOafoVMkJ1s1dct5/n0Sq1n24049njH2uDWJhY4oUn3t/y6zjftdaBFW+vz64VcSBSn5VOraPdHdQXHHml8pXDeYVXKNxbwpNLllAXPLx1zfwhrbS+PdE7Safh9jE+IfPZKBLFdhWrezS6U/qNc/zdY3CiQuF5bdQOTbuq7fSa6ENTU2gPP7FBrH/YsmjtCNfMfQ8vkWr5NHAcbx2BrZ/AybXW/Cy1/ZGIc7GFNcJAv+llvigJjHIqqn2OtLCgKqsppt27QTxL1GLB51+979rbN/Mi3prkUhFM6BE7Pzd481aC7CjeNAm1m7By2x9bk1Iz0bGctHcv5COl7Ep8pWEZ/ZLTHN7jAJ9ztQnnyDkDDPwPvIxfXWX201IajPRxHphX8OPePoEnVGnt0bho5nhAe+v8ShG7retgvw9lavcl40DnWr76wm5V9s28UBA04iWmnusgjEQhWOghkA6DaS2QLO2dIQd9ubFrtYHj3+zZyfodufhqUmPayJGFCStRo/CnTHy6MgiYLsQ/as+lOEfWncQafVP3tkNWwFlHL5lrUzW3WiRkCD4I+q+e6yvcPjn5q0m7GjcdC6a3bK49hhSoI2qf+pex/DHHOhS7EOE29xLyi7LjjwtTwltl+rU2fIEwu/895q9c2SGkbnf0QHzDhHqJsr2c4v5UPackGPOo0wXB3Xyq6cEQCfFStpjDhoe7IJ4w+b0373N7HhjzkTdf5vakfeh9SvqKKgYP8I+nJVVFSgMIXdqqd3B/casQCAQt27pa1fPioNRk5QQlGQz83g8+9rIgmJeYa76CerdJ+HWd6RAUEs6NQRcc8QNKRNFZCvyxKJYsxYF00kCX1xnIt7InhHsHTvqP9CfN4y7UNYMZINdH5g4mQRvzilNO9RDZb66WmOLzVOYR6HUUnMtL8D8uMQF7asE/EpyWEdVuAwU91LRH/80L033CO1OAYMmMfMNVc3zIhhCJv3ZpRx47BuKFJa7rTrRacdzc/gnxskWRCLaYFiQTJvoug0f+F8hExhIRmj97QkPWLZjh35OSjjRdR9l0hTzjC4+zOsZuhtisMD7UXHZs1kNC1oWCeCbSb9frOQzKR4rlHojcD8ZxrIRAeO7e53MQ3IJkfy1HEkopOfMdeQ9PaTcY2duz71upJfK9MOhAPT/IlX0Y4HaO8GhjaFGxuN81v0tJt/87u6cG86h3n0yEb/vaaxoswcky/16CVx7MYwfq2xKmJwKSxA2C9VI3AHsMO4V4nFI+64VRn0ymnBn1gqChQgFASYkAI52b4i0Qroy/zEDbNvddNfKdFNuJEpZTsoFFxV7ywUY8znKWj4cedBjU2Tl3oH+/f5tbekwFv6VYQHJ9mSPRFyUN9WDdqT1Cn0J1RalOauJ9m0JwrkLUw6oqCFlcAxHEbUojbiNlr78ofccv1JqVw5YMCxwBX4+MzwDJIVLsT8k55/0JX7jnkINlH4SB7QPUc9A8r845ppRfqIJbN7MiCZAmKV4W6XpB2Byc+ic+sFUWp5Eo4EdNVFe2I1vWiTAOyWmZwzbCfvujNSduF+31PipTR83VmiUEmaAHSkqk8ROnNR/9xIC1XerrjZ90crNBADDQwgH6PY86jtzpvZmwuRM6kmXxwCOjNGRjriddP6nPd6fo3fxLwiWYk0UrKzIG04U1uzdnc1ZNSvz+nu9AlUvM/x37zgbWTLPnmWj9RZKATTjcP/3Lr2Zuww7lViAQAX33HLzbZtf7sZj+5cbgWFKph9ITDH7B8iVZBophr0SGlLkd06DeYBzXkwZX9ny0wU0lELkMq6a2CyGV3JCADNC+zui8BqfUM7hpvNdszttbY6VzogOAI5yRZTv5sRpU3TNe6wUs81bnS8o1AMf4uOov0FUNLCBhEYFZQlsNHYN/DI/PE2t2/AgHsEynTZTNvPqPOFDCl/gMOLQohenNv5yh82/Nl35FXtmQOiV8EHR0FlhPSe4HBcjFhLxclUQ4VTZP5bmtJjJ1+C7DmLx0YGEU0c/lkMPhZJCHTHdSwkSELtzkXK3nExHYtwztztL5gXorSO8i0cx9kiqvn6EB0z4/nSNeNOPD8WQcus3XehrUlQZr/NxyG2Fek+Ze/TOHZaqc7Rsjsva/d3IpWcj32fZFAmp5OmYm7e+HsQ70t8H1kGoX9/MsoS13BFmE/dPEy5DdPY+TLt3dos3fwK85kVvbGPm8L8vJ1qau4eZyWKSQG1gCHCwcJASN/02Juv3/GEd/c6sQCAh95x/Vuna/XvoljAghAK8alu4esHAQBSBEj4q8cMw83Lp42mX1F3/xMJyWKwERlv70323z46Bp7R6ow0dI3KqO781iT7tv/J3HkE3jQDBwdNKtm0+4gMO21QOvVdvjtI/6YnuSNo3fe+wFcrBqLAkgFWbfExKcrffujeGza2GIoBA+4xfMOtN+2bzdZft8FVUzmH0jnvzZlMDv7F2nn3A2F+E/Xmfvy8kyi9Dzc91d15YpSDf144GBfS2kTBPEtBS0HiSQblgjAX+HGVilfrzKNprcuERvebKGG8Vne+VEzqpVAIu/ULRHQI7KI50LPr5mtC94GG31Iy5yYzbjhnfHWrbCAdiGSvG6fchN2tPd196Jkl5pZ5UNSCAKB8nMPaFu4PpzZ1wjmVsc+1AunknR6iq19FHflIbc3CheemTmxkv151uuHdGCWTRjhJiHJM2T1D5CMjRD9KnGcSvd460kpdNGS8XQBCFuhwhbBh7l4OIr6A36FG3mIWzFvnu7ETuMfzWGwHHplXzax7WFmVP1qKhXAMIUtUIHhae1WOJ+/RzhWFbWAZcVB9SC86h8eYw6EjdNAomGNoWAY/w9KDlWyYm2ZURkR67tXx4c+PpU0TMj40KSdPNLWE8CVx0b5LwYyWn6PLZZFYN1EKa+qRpbTiaI9RJjrECnKKBUNYU/2SFX3Bxbdc/4X53g4YcG/AlKO3rcN+14IxTyuthRYliDuy0A8zDw9T5ryoyLPAoL8PyP/OkmPFXHPzZoekOQ3PWAxuVMCH++UCMT1v1IWYKkGiUI3fZbtphJ0q8jWBusc5ZipIflrZxmV+fVHxgl4onj+ugKE/6Zyahi4uHRR7pVuse5uOjUQp+036dx7ZOhlOEHqU36HuTm61y8vbFYkX5f1J/CskN/Okru9nEU6T2Q3i+Guv3VsMcDZ/NP3NcRbEUcjmZE4ouvWaCCHrdNfRXIqw+o+3cgfIx7VTalGIP4gkTwA14SCHigudWnetg/zBo2+89sCmYd0BfFloLADggluuPbxh3G8dAv8jc4nKCkqrMEG4C4WsZtm0i89bNAF44Rw4sGb7de1x6Y5UUP99FMrxdnW+M1362/RZxtR7eyHKX/5Lr4XSzS/Mh8xFhLPFCBWn6cFKS0/4Z9PzRr6Hud9PjMmOhIQj9Y/bKF/bGySKXQw0rHfNrLzwYbdc+y/HdRMHDDiJ+Ibbb70ZZF9yuMClMGMUIXKMBN4UgAJgBrGvRkxsOoc29qmSiUIZ9fzEcVOS7zZ632U76mRC7Pa8HcHw5hUfBeBf6YCQnh8xXTMDMdlR/DmHNsRr+CrMFIRmjITL2qT+mlHV3pknwmdhPYzJwaBdZeeQ+sOvCeG33F0FXauyZFeJHnXrSh6HRsEvLi3HFPtIiNoV/4pjwSAy2fm6HCBxjBno+TZ2t8P3J7U13GNQHP+YO6RbkGle3G1BVlIofxizni8PdTKlM1VR8urldB8o5BohsHhTEkv4PJhz0jhSN+JEDI5zlzjMYUrzKfZN05wGvMk9GyMl75sXghecAqIM5xSwDpU6NMAN687+1qP3XnPSUgd82WgsAOAht157w1VnX/Tr61Q8cE/rHjkTh7ZUtCX7MvKE6MjbrQORscN/mJaM3ufoUcAUTRHVF+F7TYnvs0ZR5BqdQO8vS4qUrCW7bnx7hMjiXnRHZ2/rrs/OgTQnUhn31TgpYxrX8CDHXUS+IAYmDWiKw/PHhwktDHKCkTKUqd3YmP3Bxbff+PptGz5gwL2Er7vt1vd+7MxzXrhmql/ZpfSVY2fRMsERwZEJwk3TpiHugZMvht/eQoLGINtcdrtARdr5Ri1Cn3CEp3buN2n3ztF5WjthFq4R0/Vx2oJTd/0oPOPuPaYiDztZ/xhTujbihgW9SyDqZWWeJAFQB/h8lPEX3YajW0+j+dh/mrJ9Ih3gr03ZGpd2y0jnjpsugLP33Qh27c2EeeqY74eGE3ddoTQelBZnhFBhf7eIunP21n2NN8rnJKLQidTvcL+TS2QS2JmTpIbv4z2KDjKgTuvRkwGZwJqTBl3uFASSFWcrZ5tG7Y1VxysVCL4YKbokODb7FPBeGpLAF3hTwQazblBxuZD8zmP2Xr2jRcfm8WVFLADgoluv+vgXTr/wN5VHf3iK1mc7afxzwICCs8ncTco0ORWdw2R2N/JJ7T+m9FfMb+bPItn2A0jv5swZcbJ38887avoFKDxkc7q7TX8jTqIs5ChoMpKmTrJwtfRKrMB/HhbK7vvsOuGYXlQKZWsDqXdecooFaeG4cE1tX16O+KRWLR0w4O7ga26/5S2fOuu8daD6mZGZPGkXpiO2DRw7/yRQTHUUl2ZJ/gUgCs7agMuFAyisBjmRiDtnbHq+wpMLZGYFCrllKKW2RneurTY62i1S3Y4zfiKd+r4XjZKtCNrFFgCd1rPL1NBtRtLv1UewxFMQEHb18Xfd+bp3nJllMmKRjXEcK6WYnCxfQ/tn7tEzDWOpAEmoMxIWwH7Uf39N7pw6w5Uckq0gfa750HdEMM0LiSG4mkhYNLznfcwTeeUkM20CqWtdtLRQOr5bm9OcyGQJELIv56SJyW+gw1KfSGhiV4FAiKbgA0+WFE4pOMpGh1DBhilwmMo7C6a31uRe85U3XvMhnGR82RELALj4zmv+5vJTH1RiPP7tFTt7YNsqpDAQg26XEDQIfhOSMcz5k23xWeSAFMwfDJ9iVRTw6iZJrDj+okvGlQnv9KznVCX/Xf6Wen936wh1jDPuqhBIBocFinLigMyBrCMZ0TM60SZC1t64OlG3lgU1KzuHsTbQApg2zWu11BdceOPeHU+YMmDATuJxt+3958vOfdDlzbR5VltUT0NRflUJnLkgDRgCxwRH6vPUhI2BYU8GWhAcMSQsvJ1VPz5vXSI6AnfkgnLiHn4V1olSYwl0ChqLzkzC4bgo1CQ8oDFSIl07aFG8oCuCkNIukVcmOBlIO1QXosSiFPRLSUjvrd064Z3+KAnu6GyashFz911cXzsBSdmaomlJTM6OmeAHBed46gR8JB2AJw5pY6gAYpZSQ11Ag/q06lEhwKHjhBh9M+8A69vvU3THZnakTeFzFkUfl6RlUcCSz3sUiYgQ4BAi/BQwSjBQb4JAFAUxHbf/kQM6YhPJhYYidOHeRp/Z5Mgb2lmE80eTu4R5qGGDymFt98u7pkSNYHiHTFY4VR/IpAQh74jfwLTs7PUq+vG6kHeMKvzdV1534/QYHq+7jS9LYgEAj9p3/esvO+1cN50svHxPO9tlRSCc28iCs1PmnBUlaTfFNT88c8Yhf8P8bPSThAigYJPNmUiYOMo566b8Iv2rR1+NdGzHJNJpM0KCMIFIwvXJIWbVTHUG4O2t8fjuIQuTUTVjwdljTsG/hMjbm6N6l70NUpzDArUQJqw37RupoJ+64Mabdjxv/IABJwOX3HT9rQD+9NIHPvhV6uqHW+WHWeAiIiyoauOCH7zP+EIGQAmi1qpzoq4RX025hGpBRKoQB8B5nQMJCNIFryeXBFZVbyn3GkYFQAXx2IDHXtKpVagF4L0OgoxWqFNVB6iQz99tQMqqEF9FXSEq/qykol7MGzIM9YHnbdj1GoCMEowSiag4iaoa/+CrwDqoX0wIxEwhNVBYMlXFAQoGCiJi9jLSEcjBS2OBAuwHBgTS0ONsA6+qqqSAMjhyCAHIwUfwO/hGpWWXAEoBfApSFSNeRgMh2B+k5M3EybjBYSWMOqFuK9nxIDXKzExERBwtXn5cIEqqIr66jEADx1ISVXIqftiDzBdVUaBV9V4cBXPBYFIv0xuFOgKYiQwBJizuDkKhdgTKbrUO1JPQqB9bB1DBfrEngJiZCiY2zBwJmcs0K5E/CQAnUKcqAlVSEQNCCX/vfGCpT/duHUSUcRcVfLkp6aqvvWbvPUIoIr5siQUAXHLXTW/45ClnjWnX4u9P7GxPUVs0pQFRsB9SFrvcyfOEjghgTo2FjNU6xLSntL4Gqkpo0/oMnegUibkN9ajoNaZHR/rajHhsYAue8DJQFUA7gz10GGQYZDiEUEV1A8IjFndS/hpz3CLsUvx7n+5boERgYkAUFVm0Fc/qqb5OjP7ahTfevHYs3Rsw4MsJj73x2gbAZeE1YMCAexlf1sQCAEzFrzl0+LCZTUbPP5fsow45gvM8L0SABL1AFKJAJ6w1V11m0jZI4BQ7TAxaWMLaRz+CpcOHwLt2QzY2usQiop78H41V5Ewm+VyE/2Q8IzpncVLTIXkxAwCPR2jf9jbU190AMxkDZZG0Ep0Zx5+XgKRqTH0jeGtO1JkSQOpg1Xhi4QSLatEQHWpb+jMt5YUXXntLfQK3Z8CAAQMGDOjhmDbgXw745J6znrE4WXrJWOuLTa2wBcMxw8WwIkQ7YB6+k9k/krnAG8CijooAUOHfzTamOP2//wRWnvfjoKVlaGsBcZl64yjDlbxEo1okfN5TXmQfuqyKKjN4VAEgtFd9Ebf8l5+Cu/wKVAsTKDOi/iQaOjwZ0Y5LpKiUGJoW+sshO6khOBgYEVRkIdDbVlv3iqLQFz3k2uvbE7srAwYMGDBgQB/3GWIBAJ857axLUBUvWkb59HEzQwMDa3xcryafhCw2PJn2gJ6pIOMJBAIZApOBkqKebeCUn/hxLD/3uSjOPAMwBQBJ2otECzR/ExysUiZATb4Z4SBPKGKGk9xXJDteZlPYL12PW3/5hdDLr8R4XKXiRylTaHSkiudFp63wCpPomOXDjEgpFRwq4TU4M9bPtqS/c+E1X3rD3bwlAwYMGDBgQA/3KWIBAJeedsYDmPh/jnn83AVbL7UgWFPCFVFzQcm7liJxoCyEMzh8AojuWClpi2EDhWLj8EEsfvXjsPzkJ4D27PKFyVrn81yIhlwa3pNZBT4uyjpAmhQjFSvaJQVGID9gBhdFujzE6yGkrWGvvwH73/kRFLMao9EYKs67L1EoER00InmYE9BpK1IMeNLK+HDSghSVWjiU67UpPzGl5hcuuuG6T9wT92vAgAEDBvzbwn2OWADApaefMXYz+1+Xl5Z/unTtBaoMa3zGMu+sGKIqureZi4UC88SCuygMJkZBDHtgH2R91fuUAz6bGSV3XSR1RGbakCjxM7eO6DwZ9QlAKAim8E6UUO8vYrwppDhlD4hLWOcCefG/StaUfkYwhNMnk4rGBDDBRbtyFswWjsr9lvhNbaG/euF1192+IzdiwIABAwYMmMN9klhEfOa0M5/IZfE/x1Q9edG2Pk6ZfVpfjSlzVUM0BYLjpH+jMelVrrUIuW6MKgoyIU2wJyIxbLMrdjsXhhLJQy80I/pxdLHVMfYI4fMUzhqIgXMWLlYRCC4bKUy2c6NARjW8iSYEfMeK7wxFQQ1aZjjQB1vw/+FCXvuQ626IafcGDBgwYMCAHcd9mlgAwGVnn32qAf2yocXnnWrXJ0IF2sLAFgZKDFJfApyCm0MiFgDyxFq9vP7BhODz1HdaiI5M9NOsxnPko5n7a6b8+XnDc1+JLp9sctD0Hwcik5LV5M6a/j8inb3FF5shGHEgtJiZcrWm5nWmKF580fV7b9qRAR8wYMCAAQOOgPs8sQCAz55zHrmZPHdpceHXF6h9cKUCC4OWDCSmQVMBhEGQlNoXQBeeCYISI3PG8D/bZPbIw1czxJGM2eV6H23WZOSMpFdrROPJugqJSjGVeSAWSZXhnUUZChIBkYWQQ6u0bmE+3hK/kkv3dxdft7c5gWEdMGDAgAEDjhv3C2IR8dmzHnjxQqH/H1eTH1gW2VNawRoDM2ao+hRl5LwloJPrXUbNWDBItxqVzAyR1wGI2T/TIfOaifnv0S/HS3mFvtSk0KJgqkkRIXm0ifhc8IUKKmuxQA32F+Wag/l0LfoGKum1D73+xo3jGsABAwbcZ7Hvyr106iPO031X7OVTH3meHP0XAwacHNyviAUAXHneg0ha+cYR038elYvPrqheVmt9Llxln19dxbtFks/x0Hk89MNTN+WliNjEBDa/py0O1DltRV4+NwVzhA+IKHl+xkqDSiEnvCpKFVTOoZAaTgnC5d5VtW9Qo3900Y233np8ozZgwID7Ig7v3V+QMaeCiouUigcDOB0qLcTeDJEvuba54ZQHn37g3m7ngOPDHV+8eRFcLpMxhoiJCBZQhbpGxAk5t3raRQ/4siWP9ztikeOKc857Ihv6+bKsnr7cziAtQkJ1gmMDMYFYxDDV5FSpvX898miS6HvRYxH9YxDIgXaaiqjj2OSIGfwlvBeFhtLP0bXCm0FiqSRSQSkOlbNwBDihq63at9VMr75w781f3NkRHDBgwJcrNu7aOBfF5LmTXfh+BS6ZX8xbh0bW8M5muv4qdfadu87dPSTC+zLHwev3T7Qo/5OZjJ5VLZRnA6hAME5AUGV1MmPmO+q1jQ/a2cYbTn/QGVfc223eCvdrYgEAV5x73lga9xRy8ixTlk+tiB6w0LZQZVguIMaEBFuh0FfkBikZVm63QPxk65EjSvRhLodVchrNtR+RYHT5NOEjU4K2wruH+Mp3LILCWTA51GwAx1cdsu07YNxLH3rTrdfu0HANGDDgPoDZwfabiuXipYZxiTrnq3dFx/JgMSVmVKVBa4F2rX2RNPVvLp+5PLu32z5gaxy+ZW0XFhb+eHEX/WexDuJC2oCkOPc6byZGVTFsg5vXD679zO4zl//2Xm76JtzviUWOS0898yJj7dOLavTckszjFq2DskLIwJkyVP1EX+sAIFYkoSykNJk1aG4IKXpeBGhPTxEe/u7seWXSaP7gYAphVRTiUKhFIRYNTVqFu2JN7dvFmD9/8PU33LDTYzRgwIAvb0z3T7+bF0avriqcdmi1RmEIRVnAhMy+ThTOCcQJVBXjkUFZldg4ZF8K1z5/8dQFPcolBtzDWLtjY5dOxn89nujTZ3ULcQJm43Mrsd96xnsKUhhmjMcljGFMD9ufXNhV/um93Ycc/6aIRcRlp55xrm3cM4qyeKaUxTedCq0KAWB8RWDHBZQJ2ksPDoBC5m4AgKYM3eGIQDjQV0xk/3Y5KVK4SdCQeFMMqwqzgFjZkA11jCsY4Eu1ymdaca9Hof/yoOtuGqqQDhjwbxD1YfdwB/t346XyYdNZ7UsRAGDDMOyrposqVPyOxjBBRGCMQWtpTWb2vyzsKt94b/djQIeNfbNFW5VvXFig73DOQsRrJQgA2CdujJtVzeSGis+JUJUl6nX9wfES/+W914s+/k0Si4jPnnXmctu4i41rn7hgRk/WqnrCMvGkVP+wSki0pcan43ZQOO0SVkSTSZ79KqtIEtJ6R01FjOqAT2ClDqTexMHwuTZKUoABawyagg42bC9Vy28zbN56wbXXDeaOAQPuBg7dtTYiphGgTqFOVa1P5x/cpYnIbxaIQiLe6NCtoZqwektD/L9CPfy/gE8nAxCIjHrVdXCwC2frFJcapUT4KZ1y+tF9IFYPy+8sLdMvinOeQCilJagoOEWUSXZVwO92i8JgfbV+O1r7fUunLk13bGDvI9DDDYkKOxWjKgJVjPYs23uzTdP9zUpr+K9HC/h2iIKZkxN/mJtdvqUAVZ+/SFSDBoNgTCHU4pnFhN567/Skj3/TxCLHZ884syTBQ1Xp0Ub5kvF48mQtzFfv1hkMAKtASwQL8o6URODg+OnDQQngWPDL33xfzjxkxRSFC4kxSAQsCgMHJkFDBuL01pLoUxsil5Lhz1Khl6Lg6x96zY2Dw9WAASeI2cFmLFw8w4G+pzB4MAyWIJ5UKNSCSEAUHluKvtyIvtMa1vakqKSUyDdSA4VCRVWgor6CEJSUIKqs6giAJRjV4N4PVfLWcwgRK6myJxd6SFQ+XxXmTeOFYlMtn/VDskdI37i4xE91zoGJYm1EMBOYI5Hwy7pIZ/Gw1qGqCjS1XqdN8x/GK+OPneSh/7KBrNk9CvPVVvF1CjxEgNP9Hs/tY7WXloQPqLOfKU9Zukf9T5rDcm4Deq2p7JNENNzDqKHw9/RIxMIF9bmqwhiCtISC+WlmTO+6J/uxFQZisQ0uP+e8Xap8Ial9qGG90JCebYvRY1n5bIBOU+KVMSmVwSeDQDAkyEt5sHYEQ5WwAUwVcsAQ9qvIAYjdq8C1FvR5Bj750L17r7o3+zxgwP0Jbs09SEv+c1PhW+Iu3msX4hGaQrvzHeLxLot+oe/OrcmBMlwrq080LyR8TaMu1rwsCNZSq05+1zb2JYu7Rqvx0I3D+hhA3jhZ5oeLCIgY4jfeSQiFkybP8Ki5sNahLAitI1Br/7/R4uiVx9XJ+yh0qs/AGL8ys/iKktXwFoIagGLNvUfV/g6vjN9zT7SrXdXzLOONSu7rnXMwoYhmbB+lf7v7mvIhBWIR5xgRQUXBBUDWrBHwJB7RJ++JfmyHgVgcIz599jkMwjKIdzHRHqd6voIeoCJ7mGiRiSoAY/WbFQeFY1BBgGMip0SrBLmUGZ8HcADQ1UfdcNOQwGrAgJMAmcq5VNHbwPiKtm2h2qkiVLzDtHbyPCGZP7ZdGTMHqqTGCH9mpCJYTYCMyOSkhRlATMgXBYUAooKiYIzHFer19s+so/++tKtsAGDjsH6DKfG6aowLcmLRtSxEk8X2hDaJKJxzMASUVYlm2r5gtFC9+MRG9r4BbZVU8LNa4UWzaVvGqAqmbnSYCYYJpjBRaG9g5r6PJsXfn8y2yVQfTAXeMKvdV4sI2BDI+DQDcbJEUhHfA/BpCMLf0dciJ7DOOu9rY8wdLPgWKuleC0Ut7q0L39fwlbfeIgAOhdeNAC69Vxs0YMCAbeGIfqdgfIV1FqI+lJxC1Bfx5rx3mqXK6yGT0lEmpSMT/+iHkXdakWgr6f8evZ0oea0CCYQUJRswBCoO5aR8XtXiY7NVfcN4mVoiLAA66q7XCRd/Xu3ITtrdZv7j6TgeH9dg3gehwNO0wu9M1xvDDBjmEMuPLl9QSkIIeI9JXsDYvEpr91gamTtORrvcVM+nMd4825BLVCWYPpCiCVNKgzR//L/EBDjvg8HRKpfNR1UBGU802dAZavidavXbqaDLTkY/jgY++iEDBgwYcN/BbEMfiQJPBgDbenOACNKONdqxuyR0MZS8E9aABu2FLwsY/ReIctt33Flq9h7JVk7EXhCEa0YPbw4q7/hvwUBhCGXJKAtCWZVw4n0mGtHvVsUDAYAJAlULAM51u9UuTs1HrUn43Dt3SuiD3/H6aEXad0/ej3saYmUkwPPEigEAUzCMYZRFeJWMqmQUhSeIrRXUrcC2LayVs1rnfu5ktEtnyrbAq+pWLlFyXp9tAGFA8tkX/iPSfTadOSgA6wQ2Om4G81teZdsYDloyfUDt8KG2kcefjL4cDQOxGDBgwP0KTvFYdW5XbrJA2KHm4eNJxRx+1+krsuR4m0DeKTtpHTQjGfEsnUYihpdQJDSbHPKip2h3HBBNJQAMPY4LTyyowEErcgDwoYbJpyOZYOIf6kMRwzEI4adlQahrt59w76nI7xEwnWkKfG3TOJDJDUN9h0gOCQ1Ffe4P6xRFwdQKvuVkNKtRPBWQpxIEpmBvAuF8LlLSOEkwpTEDpRa/tFSVX+Ec/yMUcCJwTuFEkq8FwZt1mD2JIghGFRYt6BVrG3qPWyYGYjFgwID7FRTYpUQGyG3VWzlNdMnp5r+P/gnzL/+dYm6jmHIMECliycB07URCtvLynyMvPbu6ggqcXRQ4BQCKCl9kU3wEoW3OCRCvNkcqVEIui0AqnHMAGbS1/ZyKfvw4h/S+BcVuACsuqHVEgqBWzTQ8/n3SIwW/Be9/Q6OT0SwreGhpmEzw7eB8XqCrVaUStRFwxhXfY8b0EjPiSyeE7yTgr9UFzYX1ZEgyv4ykGWNvFilKXFwYLJ+M/hwJg4/FgAED7l8gjPIYiYi4w8+d4jRmvg2OnPEE2yHm1I1p+DUrhTynhMicNvNdc3ZuAnwYWZZ9d669FVMJYAkAmGnN1fq69XX5joWJOXd9o0URV3DqEvYpAEhHWZyEHBYzaRbGo9dUE1rF/RsjAKV/m3npJp+FXDeVg3xqdKKTUtyLjLuDyIDgiYET71ibm9fEKZQYVWn2FUTPoII+nH4/YgfgObNpbcD0fRrDTQWwUMABbAiVYfg5xQDwRSUcOhn9ORIGjcWAAQPubxCiXKHQfxd3rlni/Z6JpHOM7MwcMXxTNeYOiP4NvTNnf8bfxxfmNBdxh9oXbZ23v3cRtQ4AkKLHzIg+PCn5N+qWpkXJaBoL61xKmBTbJfDq/cYKRAnlqAJZvKKa0GtOYDzvU1Av1/rcMtc4qUBVfERNz0claaKak9GuMfO7AFzBzLBO0NQt6rpF21rY1qfxNkWBhXFxAwk9NScVvfNMRt8vrf3LsiCUBcE5QVM71DOLempRNxbW+TnnGrxqUp0conQkDBqLAQMG3K+gikZElaPvgf/UCw1vPUCsPJyj02TE83QEhKLvxOar5ddNf3vikMIwtmvpfLt71wcBdePqojIH8uPMiF4tjRxqtfijxcXi7I1ZC1GCOp+eS8LJVAmjiuGU0dTyosVl8z+2acj9CvmdTbqiQLpEtKNz2vEKQuf06pyclA03V3zQqT6Xid6wMKku1nE3t2L4c13TOxurPzla4KuPdK6FpYUftDN3hRr+1fEYSzbce2M6E8vM4o9J9S9ORl+OhoFYDBgw4H4FJdwiiqkqRiKZFiJJk0zkZ7vaPD9AdjbvrwAFswnWjHnVevh9lv8iN7loUsVnppSkBolJtdD5morCOQV5O/mXrDXXzPeRK/5bmckHbYsfL4ryB4zRBzGZICEBMGE2dc1spu8uCvqdyaL54ImM5X0Uczan+Gm49zF1atJiUO8HKrK9LexuwhBd6px8I0DfW7f0DSoYOdV1Yr6BFP+8tLC1lmIrFGPze02tb2qsPkuUHuNETyeoVabbqhJvnZR0UvNxHAknbQAHDBgw4N7A4Q13TmH4/WWhD6lnFoYBZgWzwvi4S/ilj/vqgR6CySOaP5JmfWsn0HiOeEinr+hISI7c70IEwd4uKfuiiKKqDGZT+d+TBfNfjtTfptGJYTzcOX2wtbpbRJiZbiHiz00W+IZjGLL7FUT0a4nwkbX1BsZEXZO/7QwKxBBJYyHwqdFFHMqyxGzaXrZr1/ix92IX7vMYNBYDBgy4X2FlwdxyeN39FVR/2RhUzoZIDYr6gmQPSY59m1094Xe2mbNfburYGur9KLTTTADoBFl+ZJY5EaopXwZC/omiKGCBvVXFR1VlVxVNAXw6vAbMe2fmjrFJqUSdzSSaoOBJnaqae7Ct90sMxGLAgAH3P1j324BeWFTlcwkO1rqQ4TI6YyqIXNJC9CM3/GfMlIhFrMmwFXp69+iTEbxH/TUDnZn39YxEJPh8GON/UxQMAQ4Yxc9wQR/ZsTH5twMfahz+UACUma8QHGfj7Ygkj8gnLYPq/T4z6cnGQCwGDBhwv8PKrqpdX7M/JFY/Z0rzE9WoOC//PoqZI9mCnfjMlR3ZyJnBXMRBjC/NyAcbApsjXWEzBLiztvgnw/hfpaFLj+vHAyKSUiJpKGIkTlZvIzptUtRMhQRmVVkOFaXvJgZiMWDAgPslFpcKC+B360b/moALiDCGtzS0FFIWhDQShjw1IAgxDFoiPEgcfqsszflNY0PiIfT9LDTuhlMsCBQ+cdWoKuEcrjCM3wJwowqWiL0NRlU5/t5r370RhAgHVXDruKTj9ouYbmhFwNkARqponXU3L+0qTkrY5HY4vFo/SBUPFegFROYcYjqdiSaBbq0rdD+BrmPGlVC9ZnFS3HVSGqLYDepSqwOxVgz176O3joGVIAzE3FKmIntS2nUMmE5liYgeZVv3SAUeqNAzQLQEH8zSENFBIrqNma4h4Err7HXLS+U9Wu79WDAQiwEDBtyvMaroJgA3Hc9vpJYvWSe/UJaml+hqKwfOlNsCXlA5l/wnDorDR8wJEIVjgTZqnOA/tw7fR4wLwJj4xJ/CZWHWplO9xrb6Lqft3+7eNbr5ZLRhY10e2Vh9JpN+i2G6UFR2QdyiYTVFwWCOmUH9uChkRmRWQXx4barXE+G9hdE3j0r+/Im2QUTPtsDzreAbWTFunZ5akqIsOLE+nzq7Tw6J4At6GQZJNF8JxOmjreqnaosRnLBhWCKqfbkZtUp8BwN/OSnpzTsxhrZRFsV3t4L/QAaPVrFnE7mVsjRgw6kiq3fyFVjrAPAGGIcN8x3TqfskMf0/VXn3ZHzPkskBAwYMGHCMaKe6Z22tvVxVdTZrtW2dOicqIppDRNQ5p23rtGmsttbqxrRRVdWm0Q/U6+4BJ6N9Wus32Vo/vrFhfTtUtW6tzmaN1nWt1jbatI2ubcy03tArZhv6/Tt5/Waq3zBdkzfNar11NrW+Aaratq3WTaN102rTtFrX4dU02jRWm7pV56yqOLVWdWPa2qaR622tf9HU7uuPtx3i9Os3pu1ds9qle+LEadO0aq3bfL/U30MRSW3O72X6Trf/rm1FrdU72lZfcXfGsG1lVzPVX2hq98W6dtO8lW1rtW7aMI5WmzSefhzb1o+hH3PRurar9dR9ZrZhf3F92uy5O+3aCQzhpgMGDBgwB1vLslX9wGjEj60bCxN2jvO1PmISLXHBTM+AtQ6jUQlx+KBa/b5izLfuZNvatfY7TFX8GZU4z4nAWelqYYRjGAqmkMLclCjZ7G+m9lfGy+Wf3Z1rz6ZyjhC9iEm+xxheKUL8hLWSxiI6r3pHSOqyagMIwZ0ps6gqgY2BdVCC3Gad/N+yNL9VVcWdR2uLtPIgNfROJlzknAVAPgFacNBk5mT6yNHlKtkcDdQVdothxpKSaGn2vWGCwLQE+rPRiH/6eMexbvSnAPlvKnLhaORH0WcD9aHGIp2zMOXpuqJmLH4eusJMADGcdRvMfFXb6u9OJuYNx9uuAQMGDBhwktBO7eJsaj+jqjqrrba201jk+9mosfC7Shfet37nbPX9zXRnNRa2lrM2DtUfUlXdmNa6tjbT9Y1aN+pW69ZqY602rdcSTKe1rm/Uunp4quqc1lN7/cZq840nem3X6tOaWi+vGz8GdeO0qa3ve2u1bZ1a68dA3GZtgVcRiKpYFddo2zY6C22cTmfaWqdNozqr3afaVv/d0dqzdnj2YlXV9fWZbkwbnc1ata1T5+YvK+EV3sd2ZF9paKukn8RjnIo4tc730Y9rq+sbjdZ1q7Parja1vfg4xvDCjan+0/qGnamqP2/Tatv4OWbjHNusNNkSzok2jdWNjUbX12ut61r9nG2ns3X5q/V1e69EuAy1QgYMGDBgDs6LGABd9EjYuPawKfVVlnFTAHJOd3SNbSy+u1osv97b2SnTpGRVXKOjomGUBaOsCmxMG1Rjc7649sdO5Lp1rf9z1ri3stFHQi2axvrd+5Y6b0IqPK/INADhPRggA2ZGUTKqkoKmpwW0xajir1TgdU0jP7dde6aH29PEyfemjCFZmA9tyhsS681qalcHzf7bV+Fr8O71GossQyt7DYETBaBLTs1/PPLohfOJfpMy3laWeFpZ6GhWtz7DKhGU+unit4ls3gQfpswoS4OiMAAITdOiKmhcjPAfFyrzjmaqpx3b2XYOA7EYMGDAgDmQ9+wL6IebRpPDZqLRDzcN6aJ31NzciP0KYwjWOhj2QsUYhmEkchHDKk2IgigKhjEGgIIK83XrB6cPP55rTtflZSD9zWpEo7ppoeCUITSGblJuVphL/tWZHrLPwSBiGCYUhlAWjIIZThTTWYuy0DOsc7/b1PJrW7WJ2JxCBV0oojCGjzzMlI9NP9B4y1L22U3NqtGHvoYXA2TCH4xHH20Mneh31q17I5M8om0bOFEY9uMYc5kgJxdHyMPWUSGfVC3e46o0KIoCbAyaVmGthRCeVFb4p9lUzzhaG3cSA7EYMGDAgDkwkSZhQ5mQjBUxu0ITm5H9bKfd2Ih4BADWxRojWZE09X4VTARDBCYvvDttBsCmOI2ZLzjW603X3SvKEZ6n6itnGg6G/ZRUKo+0QMbB4jFe+EWNRXesZhLaazBADDYGhgnWCibjghzcr9pGf2rzONCoKA1pzu6OlBS1++URv011W9C/vZF8EHekzRBQMIN8mfZtIaLfxsDLy4LO2Zi2IcY5Jug6wizZSkXW60EgNom8dc4gFGJnZ3UNAI8bjfF39VQmR+z8DmIgFgMGDBhwJKTFndDbGecJmNIH+Q4dQCg2uoON6aWbzvffPvlTtuvN2xZXeuKqKIpjEjDTNfviYkQ/1liLthWYguNpN0vCQLy6svMhsVhGKObRZbHy5ILIm3W8FoagEIyrgh3wK/VMn5j/VgBx1mU5RLZGcig9xhe0T4KAcMsTWfROqYYZBftsqThCE5zTR4niz0F4QN04GOaQNC1oUNBNqZQLVI+l3dkxcUxSKzRpktgYrG3MAODrWekvp7OTV2Atx0AsBgwYMGAO3nug84+IO9bcn4HQSbXcByMTShJeOwYikuw9WKNunsCKnnYiNQxI7VQRpi0iJebRzPR5MPilGO5SVQWYs74Txc128l8gCAgOBAcNmchcT7lDvZwgPajPVGpMOLcSxAJt61CVOE3U/d7qql2Jh4voIajZ6xU1ce+/KcSjf4Et0BPW4tvct3N1fjaRwaXoIOZQah1bRrDYVncz442GcbZzFlXJMIWBYQ7lzTvTStfcPoFw6ivdOpdF/mRjOq88C6VvwnkVhhVlyVhbm8KM8e+rgn546zu+sxiIxYABAwbMQVVJRbIteocta4ZQzJ8JqEvCyPXVF3cflO3z0UVzpm+B5M64qX0AoHT0BtlaniwqLxmNCdYpqoKTPwcbApk+ucidW71gBJwVNK1D0zrU1qJtHUQktU4zARqbl3bZ7NOiOvEC1TqH0YgfT7b5jdjGwtBdxMUHCQQVTVqFzc6iW+zwtX/tzoKgfW0B+kLch4KG+i9hvK110G2KvzmLVwJ4pHPOh74GnxKv8YhjmN+eELqsCqeC1jnUTYtZ06JuHGa1d5oVkW37EzVY3TmjIy+hbVuwwQvbRk8/yhS42xiIxYABAwbMQaGU/Acwb+7eXjSrdippUahCd7buRCaIY+M6Z7700ba/UwVvdwgA1DM5vbbyq6MxL61vtGDDYZfuc3REAcnRbBF33OQV8K0DaqsoqhILkxEWJhUWxhXG4xLMhNYKRAXqfK6GKCD7TQ0midDRtnUgIojBc5p1eQQAjBaoHhf4361TEIXqsNz93ukW2odMpaSJMeQX7nxW5rUD1ila69C2Ds75onbWCtQYawhvmR9HafR7igrPbhoLaxWtVbhAgLxWZs7fNGkcBKoO1loQAYuTEZYWRlhcqLA4qTAeV55s2TYz2+hcV7oIIVHAOQKRQVM7AHhAUeAnt7v/O4UhpfeAAQMGzEEVzIY6mR1X7S0dDHKtexBo/jNHBLeT7eoCBwi97WmiP339wVanOFIEhVP6gaoyT5jVbXLUlCCoOItaUPide6/foihMgapiTDfqq6Vt36ug/cRgMF1YjkZPGVXFrumsRVF4YuK1FNbTeAAAIKRJREFUBF7bs6nFFDQ0Smitw8Li+DQ3sz8OeMFoRvxe27jfrhbG/2M6a+FqSWaAouAt6VNPszL3Xfxc1Cc5oyx6xAv80G8iH33BDGfxP0YV3ZifRxoZCfB7JhAdUQUJegXpiLr75QlWp0GxDpiMS8xqe6ie1X9H4C8BWCWGccDjqeL/YBTUNILCdNOBtNNSxA9TDwgoSkbbWpRl8ZOq+udEJyfVPDAQiwEDBgzYAtQlYwDmhPhWhyP6KkIkMhFyOLJv4Qm0iuJGPhXS6vTOcw4ViDvwDkws2/k7zmZ6ARH+Y1EA1iqIGM55IZE7MObX8GYBgYhiPC6wsd6gYPMCOH6t4dGtgGKyMhIAqDeax2w07n8uLFT/fjazSkXoAlHazXf9BDi4MzIzxCnKglCTPK3ZkFOrBd4HAEVl/me91nJj5Zd37eqCM2zrAPWes8nckPnDxLEJuqneqPnQzSOLxmkjKuJ+b2lS/O6mL4mebQpcKOJDQUWxDZfraI4ooOL/nYwrNFP3rxWNftpM6FPzv7Kt/Flt5dWF4Yc7keDz0Z+gnYmFwN75BobZRzUBuwE8G8DvHbGTdwMDsRgwYMCAOQRnzWN2vCR4L80tYgR2Nipkk4diDi9cNBNYW23adRuKRMBTiPA45wRlyWhd1H/kevtO7U4EFCVBHKMwwLSW9YXJ6MfJ0Ou2Ov9oofrsbK354bqWW8fj4qfWNxotC07D3EVHRBOUJxtKAETh03bzeTD6XQD+Ip13qXxBvSH/vHHIfRUbBhk6H4wfg7fU5P3r80ONibOin6aCDaOp3d5RyS9pHXY76yYFS6GihVMpCDxV4gNc8KcXJsW7t+qnKH6c4U1Hqp3Zo5cqo9NqgYhQGK8JKZlQ1/jIqDDPooru2Or8RckfambynWrxVrA8UlTBElQWoB6pIA4aoWCCEfKF1oj4P1mrf1gUJ6eS60AsBgwYMGAztPemJxiOoL7IdvZJtbCzOOoJE62IDd/8603nmG7IkiqeWpVeW2EMwwTbPTF1Pg8Iqn0K9SlAoMJHe2jjXkfjrUlFxHipWmun8tutxcMm4/Jp69MGpTFdnojIzHr+Bz5Ph20Fo6oYT2fNdyMjFgAwWuD3AngvALSNPgZs/pO1dkk0+Id4z9Du3NHrVTVpChSAKRhEdAMX9LKjjfNWcFYuVtKvyQkmcwwrjWaV3Lckhqz6vteNdWMufmg7UhFRjfkaafVnHRV/KyIr4gQgCr4wXZ0RjhazoHJiBpwTMONRxuCrAHzkRPp5NAzOmwMGDBiwNTpucDRxnmsp4g+OqF04MfQ9/uO1KWx956Idtmo3BZ/SOTDTY0yJbwYUzAyAwaAQYtqdSwQ+LNOFCAbx+pHZzN5cGPOnx9KHcsJ3kMNLVWlGRN4nJetQ30lWexEjxgAEelQz0zO3O78onHU66nU9RLGwCUnDOEa1bPagbNoTr69hW/p2w2AbCsMB0fG1n+EzRn9Euhbv2bgo3kAVffFYrsUlvdPW+HTuuNlFsnROnXn0ib9W+vtJJ9rPo7btZJ14wIABA+6zoExjofA5IuLfyaGvO3wbHUaUiTvYruCel5OGTK2eJzUIHgTIxQ55S8gmYqHQrysMzvC72SAEY04J+Gsl58Us7DLW5WApPgbBlcfcD8UXmkavnlSFF37I+pMPWdC6UEj64J0o+TQifMV2py5LlMZQmZ+CAIAJxBxeGbGY0yqJcydMLETwLdYJRCKx0LnuaAxMySqZeiMaeXva3x7P9Zjo76Ha8pyfTZcvJD86ErV0+7/q+Hp3HO06WSceMGDAgPsusvyLW+z884REXqMdD+1yX4a4hB1dYxNRoe46oSXpv0lrIdrp+LPDCJsjVRT6MAAQpfljMwtC57uBcB0ixvq0RVXgLaPlzYRlO5QTuqYw+gmfzdMlU1O3uyb4/GTsfSFCGmwRBQjLTvDIbceI4DUb1G9vdwCid+iWlipT8AlF8kw33Lga42IR8VEuIeGWigKhVLxPmZalNw/OvkTA2vr0Ngg+cDzXLAu8ryjMqmEOvjCbj+mIRNRiSNSQXKSqJ6X66eBjMWDAgAHz0P5WU5PTQgiNjKb6SCy6tRuMTgUuO+xkQeSzNaTkmZk/B/VUKOKjVIAetREv2nqC09ay4IjOyk7XS1yVrqM+6yQ4Oh36Y5wTKOMxrtWnimCP8T93Il6MEqBs0BDBQmEAtCCcUrv2HFUKvhqBlMX+JB+I1KFgegGqysC2ePB2Y6SK8phGPSMeUatBAJj5hMggMT3UWfcA1S5hFwXSKZL5jwQEF5WkWWLmKQy+Qxp1KhgRgVsLIwIighoDaxiWfLZzhh/PS6yVpbKkNEd7vkBhHDUQnS5qSVAU5nQFVgDMTqS/R8JALAYMGDBgDv3oge6PTo9BnXZg/pd9sbSzWuGgpojOkyLR2EEpJiQYLDKZbPJ2WgLmk3adScADAISsjow5t4egsfBsKhGBcMDSQoXZzP6UOvyoQgsmltZKKU6NMdwwkyMVZaaWQY78EBoHrDgrKIxJ5+pnouyu3SUdU5iC4Vp39nZDpFBV6TJjbKO3SB+mkaHgUwIyWx1+NChwAZhGcMF0A3jzC/pmMz+G2R+hgWVRXjCz9pUKFhFXimJMWWrVVgB1AJFKsGhoURmuKhOISf8iKfIklm2BIpaBd07AhVkkYAnAER1FTwQDsRgwYMCAzVBCjIMMHyAjG/GD/F/0D9hEMXaiUarGCyPOI0AzZ44gpdRTDVECqUAggJDPO8FFT2NBTGdZ685n4x0pnQh8aizqfFA7V4tNOhhmwsJCUQGoUoPCVlxBVfxlshgRBbLghR+HCqy93Xa8LjQ4jAYtiqYebltITYE2ZA/f1vmla2f3Ph7GvO0PjgyiU4kJcA7JtoNo4tE4Hl0/szH1xIJQlsViaMWRrpRKyiF7owwoOJEIUiTNFYI2I7nhiMBajAqDctPZdwADsRgwYMCATegZFvwnmw7BllvhjG9ERcLOtQqZ5J0Hh3olwa9CVEGqEIa3gYgASl6dkbeX9PSC6dSmsYAPG0kb6SMFtsTaGgBS9sjso7BLl+z4aH2gpHFh5pTcaasaLJtuQvqbj5AfhFowWrV6QkJzy1owx4ZdTEBUyRB1BcsAQnJfiQRDfWIrDdPEO3IiDDwfeb71iF64U5TnLyWANaRo6+qIpGgUVXCn3tpxDMRiwIABAzbDb9oRdnjkd4AxS+NmW0GEFxgnC1u75wHd1rxHa/w7ga/PoQzBFiEhwLisGM1GUNGLQohgSMMumDp+FB05t9BazDctuaVs0wFKTghHV+xw8OsQ8eYfBm1sd6wqJMjpI2grss7kfwKgrKrt8UAVCxxPmf/bP70/Fpv/8OGw8chtGt7T6GwGwzu1+LxYDLDruF3urwLAGKxDMSTIGjBgwIB7BH7756Gd90JvyxjqR8x9Or/g7yjL2I6zeK13X4oTtkj7uTmFBbwSvStp7jUdPhMkNBT5SgItOgN2JhLd5ryU/nMs0P7bzNeiO7UnIo1VMNMt257JZ+m2qhglvnPUdnQkg+jYo1vmelD5M21/sY5vKJBpeJI3CEUll2aak6MPYtdk8oyYvM5NiSEctUkCUoCdv4IBDoOweiJ9PRqGcNMBAwYM2AxC3LkmP4Ot0zNv9csAg+MQrUfDrJ6LBd3iolEmbyfUfR6LPt+grdKOR4fJWFlkfvcfmpJHxGxltYhRM9rJ0fSS4D8RTQAq2THh+rHQmX8JDCuapnEl4eNbj5KX1Rz6pNkFo29BR1TmHG872Xxi5gGnJvy+6/8RGoltvk9Nnhu3IyHPLRL73CMsICAUtnWqKEtC43AVE915rN07HgwaiwEDBgw4EjQ6MQK5dPWRnzH0tFv6T5YhZDwinTWZRDqKtAmRoUm7QJT6MafaoDa37PjiX5T63fkHdA6O84mXvPCbz+mZR6qEI7doczyVxP+QPzCaUkQV4gQiDouLI4xEPw3C24/QdQXNkSWBd2AlrxVg0sysNfdj2aqVR4emMN4T4yWqknwtM52QB9Gm+be1OUR7WjTvU4HgZwE45+BEsVhVsA5/eUINPQYMxGLAgAEDNoHYV3DCNkzhCDbwzrFOQ2anncMRtsAxZZYqgcCIqTiYGSwKZhNV5j1NNYFW28Y5Npx23JutAdrZYXLZRvHKCD4o8ZD895Qde2x9jFnKo1ahqgoYU6Fu9UtG8YvVmA5v+3uCEnl+UATyICogYQh5045QqAgqm5U14vSECsexyduUF13v9y1cJdK3wBG9NiGSqvhrCg4tUQNF6X1HPLYfU6+7iWGmBIBHIwAEK3i9Kl5/Iv08FgzEYsCAAQO2AOXhAZpt4IFOAMRN7xaru/rjdrS6aXcZgWRii5MYI39JSgGjANgXpvKpupNsyrqyD6B9VclntK3LciwEwUdJjnkxH8NEOf4+DEzvxFvzqWNiWcH0JKLBHKJoW7eqaj9UGvOS8aR431F+r8n1I2mUgJQeLMXm9m0MqXIHnVjFTza4vfOVyPqaaxAkptQONo6MQJEqDDNgONQRgfpQn5zQ+cgPQhc1ckSPjjCWKoJp3QKKLxRF9fdE+LWq4mPieSeCgVgMGDBgwDx8lijO1dHeSh3MAupl9xYb3hykemyy9FiwMZNugxo8JTQ2LDgWxHDOnho984/wOSP6674K9hnmWwzjDAfAcNB2ZELZyz4NJhKffMsJUBYGbdOulYb/EsZ8RlucLoAwQawTM+fGoGH4UkJSz0dI4nGqiNmwgocHORISUtyqqu8dLxVHdTbsaM4cNPvX55hKnYvHqihAPJ9A7JhgGDepqoDAnk+yN2907QLgs3D6vkZtisIYgqtnnxxVo1dBygKiTCRwzrGIGiJSEMDEQhQ8OwnEvvQscRfsQ5GvxEuKANbBqcVUoJ9YXOTLTqR/x4OBWAwYMGDAZpBmOgoFch+F9J9oMki1H4AeEdlpaCaA5yVnFxLatUJV4SMNgBCMaBTUX/dVD6jQrQAeS+SzRvoIkxRx6/MtBKEf3TtEFIVRgKgB+E1E9L6T0OXjBmdClSjmx9AsznZrn49YGAzQ+kSuS9BriWgDwJIPJJJcMRHmULwWQ+L11ZOQshrfRaPy1Sdy7S83DFEhAwYMGLAJ22uJ+yVLN/sdxPdepO8cv1gYs0rI0yzqAzYSUkGtLRIrZZZ49dGIPWLBFa8q4dq87YlEpb4E2sJIRS6IgaZ1KMpiT9voD+xUP+8uev1PhM93JlY0VQYkmiQytYovGiYnJBdF6LZ6JrfrfIRGrz39u8MEsAnl6oriiVrrSas4ek9iIBYDBgwYMAcf6JH75+fohFQKP+19m7QcjBNMtrQV1medwOsVPott0pDmOxXXynbm6SiOqogeFLgcAIzpiNKmMEfq9B69WiUqsGqfbFebR9zNLu4kNvWxr0nyN00zFZMG1qXsC7IdL6qSWtvqhwkE57QrUJcuF8cvZB4ln/jLGAaTghljVHj+iVz7yw2DKWTAgAEDtsaxaxuigx51vnZMYLez1U2zcx0pFmD773ibHA1K+LQV3Fkwne6seHNIrHCaXdy7cHSOI8YAbWsxGhfno5Xf1No9h0bmhKplqurXq+AbWovzCNhvCnygbfG+8ZiO1wE2c+Dof5r6EglYOHNMKiXeLHFeq/rLJdGLj7cPRcF/T0Z+ADbGzc5fPDatI6WxPSIKZvoPqvo+Ivrfx3ttAFDViwE83Vk8RixmUFwpjH8dj+nTJ3K+E8VALAYMGDBgh5B7DeoOJ8jCXNxFd8WIGIJI25CLqIHZKrOkft5Z+kBR0bPa1qIoTcpNwblGJhOEKeBRfH4EU5TPgOL10uhv1K1+frJ4dCdI28qZrPKEWeO+a22tec7SUoUqlC2ra2yw4HXra/ZPF5eKy492rghRbEBwmJmWY1ujVikG+qRIFw5xFhrMPSIoGFU7c79pVU6F6AchaLzHKRYoJCYV4etti0uXl/qkxxh8DMT72cie7lOKyVsxHz7ajan31/Hcgl7e1s0FtuW/nCwVVx21vyKnE/A428h3ztbts8eLxWmmAEyQ7vUU185W7ctm0v6f3bsmB451HO8OBmIxYMCAAXMgQH0CLBxJOXC0kxikk+xMo1L0AoAorYhDKABz/+AtGk5EDro5BHZc8eqslX92Ds9SUjjnk0mRAmJizsZ+WvMkFw3DOYFzTTEeV88i4BuldW+fbtj3EvMVqjigwCxkLh0xYQ8D51rrvso18mSzYL5xUho4Eayv17BOUBjGwmK5QOAfkw1+/Npa+4NLS+UxkQtR7JcWVxWFeYBrLYijiSi0Wru3aTwjGSQDEQETjAH9LIh+VgjCBC664RUAN8wUb1jfkD9aXOCUvdIQ3eQc3lcW5pnWea2FBu/NvAR6nw8qumzsAgEVRVW+QNV+z4EDh99aFpMPcmGuBWiNCC0zxkRYMYyHWiuXtLU8wRTmCcXIcDECptMGrXUgIoxGBqNJ+WDA/IGuugsPH17/pZWVxZOSxjvHQCwGDBgwYDPyiL1jO3z+E4pZj3asSZoiVXr5F0JLQ3bFzmcgfttrpQO2KTzFeGfd4LLxqLhkY731WgsgeGWkuIZu168+6lEVMMZAxGFjo0FZ8pkLC8WPOsWPuhbXMeFWJayFSu6L1ukDuaBzxxOfj8uJQEXTedj4RF5N7UDkMFooH4eZ+dPVtdkzl5fG+482SqOCZusb7rOTgp8k1vuC9G7CFnqfbnwUZBgigtmsATPDk0OFtn4IiEDVyFwwHtELROjsw6v6X1aWyQGAqcg50Vcx8TOsk0IgiFk1iDOnWCD9R/OwEfjqsraxqEbFw3ePlh9et/LfSfV6hRwg0JTAi7Z159LYnFNVnu34XB+eLxpjOidVBdrGQlQxXq6eV9b8BQAvPdoY3l0MxGLAgAEDNmMrn/5jRO4euHMO8kRQVa96Tw3L0l0KtJf9skcqxHsSqpIFsKWJYmz4+mmjryGlP/RRkD6pVrxMFsUa2tM5ekKDEyID1grapgYbQlWZC5jNBfPXsq3FdOoTjJUlh/LphLKMNUIEIgprBdS2ANM3l1T+FIBfP5axKkr+BMG3yTB1jqhbhOl2bpUeDIIpGEWhKU+JKhBdZ4lAbWtBxCgK80OLFT4K4FXp94R3qcOHRyPzhFltEwELv91Ulr37OxI3z2Xq2kJVUJbFyBh+WP6bsmS0bYuNVsFMMIZRFDmP9Um2vHMtwTmLprUoi+LnZ9PpO8aTyTXHMo4niiEqZMCAAQPmEFMf9D+NOSs0e4XoiaTlTvkb87xLO9em1IagqdCgqUBoD9QLlF4bs5fXVmzr+2BI37Qxs59cXhpBIDBMviR62LhHP4UjvarKYDQuYAyjbR3qukHdtOFl0TQOol44luVmNxQOERQS7APWAaOyAJH++7WNZvmYxsrgkwAOFYU/P2X5xFPOkW3a30UQE9iQT4nODGMIJvxdFAWYAecUXOH502kX/UNECtZfcS2cYYOyMCgLhjH9UOA86Xc3rt29LgpGURg4J6jrthvD1qJpHQBCVRUoy6KL5kFHXij0VZyAiD1JMzhPFf/uWMbw7mAgFgMGDBiwGfMxBSHZUUYmsr8RNQXqvfuw6cc70KComMjaA1UIsjZBEcuE9gmFhoJUgq18LCKqkm8aVfTipnH1aFTAF+wikHoVfb7d7+IbMmGWduZ+F11VhX+VBlVpMKoMqsqgqgoUhQmCuh8hEccZ6bwpLHQ3c3H+sY2W3mQFHyYiOOk8Q/wOPjKMTb/Z7lwgAgxTT2D7VOlA08jDDKOnUWDmDxDkz8oyEhKvkdFg6vBnDb4Xc6aZnFwwE4qCUVWehJVlJCr+fWEIhoO5JyMm4Qx9Txv1WiAn9LDZrNnp6dnDQCwGDBgwYDNYabsy5SGp0rylJGkRUtKlTdkm7g6IwDSvR9/UJu8nwHBgEjD12xp+fkShUpbFmwH9A0MGTATnBNYprHNwTrIspJQIRdbGnnCLhKdf/jzPkeEZQ68sCwW9jyKxtSDMi012hG1QMa87wl8D8NlCVeBE4WKJ9i3cZ3yK7+CbEPuHTJOBWOatu8+BrBkAp8y3QcT9grX2UiKCqINzDq0VWCfeOTZvAtHcONLcOOZ+NZq0VR1o83xMR/u2iouZwHmdd9CneCsMxGLAgAED5qBQ4+Mttvk+bKHzBEj+c68wCEKegWMThMeCIOc4vN9Kp4IoGzmUBqeocaCoWSCjhNHRrlWw+c1mZv/GBEdKEUl9017mp83QXtap+HefUGTmIq+R2FYoauwyGLQfwDH7BlSkf980+JQpGNa6ngZnS76XfTQ/rFE7lRRG2h2uXptTzp+uHI9mTHiOKG7gEG0SWc1WvVVoZo7Jb3DnI6IaW5dMWxmZ3bpDMaFZJIIF0xXVqNgxwrsVBmIxYMCAAXNQaONEkxCPwpHSgp/7WPTNDSpJem4Qn1jdiS3htfoWyEVOIgzgGIZCBkoFFAUAE8wSADHDiZgjmUIiTMmzUUk/Mpu2byuKEuNxiaIgFIUBgeA0MyuopjwRcbySYoR8foaU2yMjJX1BD+ROEEQMNhx8DcJ5md+4MKKNYx0uJj5IrL/YNjoriwJqJY7jHDqykdok/iXh5X1548sBEKhIOF5AhINbjmNRXsnQZwO4oapKlJVBVTIKw16Tk40BHYHYdI6yQTORiK1mpAf98SQCG++nwQQsLo7QOtxWGvOOYx3DE8VALAYMGDBgDgvj8QFVHAC8/Zo5X9yRrfx9chFs2AAxrMONbOio4ZHHiopIRPUwEFJv57vaqJXgoCQhTi/ikE7Dl2M9KCq3HMv1qCzWx2Xx7LbWv25aQWEMQH3fjW7nTjmj8J9kzqbd31Gr023BoybAC3EJJhAv6IuCYUyB1uIDZUkvPO4xK/k9ZOgFdatajQwys0oiDZJpYbp/c7NNIBpzxwC+raYsbiXg6m3HkfnjAP69AFf46Bdf3E1V4ZwmJ9WtDFR+SBWI5GxOM9EjtuqgKhDxphaVSPoUo1GJunEwDj/PIz54vON4vBiIxYABAwZsAWXzL6reOz867vkvggKaBIiFrMLu01kBQWEFYMK7RxU1O9kmZvpYa1XLwsBZ10WACDpykfkEdH4Q6QyfHY3Nlcd6PSq5rsb8nNLQrzeN2x+1H84GR8A5rU1P8GXvk5NrphVwItCgBVARWOsjRurG+yOMSkZZGFiHTxjCfz3RMSsL+kNm/vWmVYxHJQAfxtpaB2slkJlYNha9dkaS4cLLKkGUYJ3vOxGgjv6hOoomhYg+QarPEODd1qklYjgROOtJgJOOJHS/yWJG4jQLLxfuO6AgEhC8JkXVwTrnx7H15h9jGNNpW4+L4pfMiF5/ouN4PBiIxYABAwZsAcPyGie4wqucBeK8IPLOd50ToMBHW4gTKBTLyyPULd6lom/d6TaRq//JOf2nmE0y+T5kkSEiitYKWhccFp2DMSUah+mo4L86keuy4RcWhp/dCj7ctCqjUQFjAL9r73b+/hV24toRiig0o6IifScKEQfrwk5bfIjraFSisWKtwztI8UxT0BfvzrhVJf0GEf/8dGYPl2UBYk+OokOq67U59wXp+iDOFxezzjuBVmWFutGDBeP3j2kMma81RE9lot8GcHNVFhiPDZjD/BJNuSfSeGZt2RRCHJxRnfj550RgrfNOmlCMygLWAU5xTWmKH6KCXnJ3xvB4cFJDTgYMGDDgvoym1R8gxh8UjNOdtahrB5+o2W8nfRZt73NRFAQlhsJcVQDfXxT0mZPSprr9Rubiz02Bi6x1PplU8LWIgj2GvFYlYVR5NXhRmJcUhn7p7lxbVJac0M8Z6A9Y5y4oy4IAb8JwNgg/oJeXIcbHeEVA/BaIZiRmDeYmP37W0XpZ0NXq8JqioD++O+2dRz1z32LV/paIfuXCpBw58Vqmzi3B+6r49xnBSGYahSkIo1GF9ak9vDAqftEYesXxtkOsfLUCv0WMxxFRqCuinmC5kOwsHMsUar9EkuYPDb/Q6N4ZSrATuCiwMRWUxtwkov9IJC8ej8vr7s64DRgwYMCAHcSskee0Vj83nbaubp1a59SFl4ioimjdWF1ba5r1Rt8za/VRJ7tNtpYnzqbtZU1jtQdx6sSqiFUVUWdFrdW7nNNfbxutdur6rZUHzKbti6bT+spZ3axZ27VDVFScU3FWnbVqbatt22rbNuHl/3bOqRPVWe10Wstq08rejdq9b21mnz+r7cJOtXUedSuTtfX2+fsPr1558NDaxsa0UScSWu5U1amKU1Hp3ou/103rdH29rZtWP9e0+uy72xbX6tPbmXtz29qb6trOVCSNonVO2zB2TdNo0zRa13V6NW2r1lp1zmldO92YtnVTy22zRi49vNb80dp689gdGK4TwqCxGDBgwICjoG7l7ILpP4jg3wn0fMM0gaoB4KyVDVK+GobeAuD1o4qOWtVzJ2Bre44h8yNW3PfA0LkAKlUYUgCkLYmugcxH2dCfckEfOCltsLKLBE8S0W9X1q8sC7MHpBNVjEUwciIjEJGKACAHggVQG+YZE605p/sA+rwDPgHCRyclffJktHMrzGp7ilr5Rufk6Ur61eNJeQYRjVV0JCKVOC3ApFB1XJgNBladw9VE5h/J4HVVQXfsVFuaxj3YKD1dVJ7MBg+Dod0quuBEKxWUIsoK5aj8IULLhqYF8RoxH3AWVzvFFYB+WLT9+NLCeN9Ote1EMBCLAQMGDDgOtK2OGDiVgLEqahHdV455dm+2SRp9EDHOAbCoCiF1+53o3mJc3nVPtsPW7hwieqCCzlfgXFXsUeiIQK2qzlT1sKrsJ+jNKnLdZGl8UmtWHCumG42B6gMKY85T6FkAFgCMPEfTNSK6RUSuHS2MbjrZbanX2xU2/FBRXKyKswHsJqJSVY2qOlGpobof0NsYuFpVr1lYmRw82e0aMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAH3T/z/9EdomCXcXw4AAAAASUVORK5CYII=`;

const voucherFullNameMap = {
  cristiana: 'CRISTIANA AMANCIO MELO',
  genivaldo: 'GENIVALDO MOREIRA DOS SANTOS',
  nadia: 'NADIA GOMES FROES',
  arnobio: 'ARNOBIO BARROS SANTOS',
  arnóbio: 'ARNOBIO BARROS SANTOS',
  lucas: 'LUCAS DOS SANTOS ANDRADE',
  nalva: 'MARINALVA PARANHOS REIS',
  fernanda: 'FERNADA NASCIMENTO DIAS'
};

function normalizeNameKey(name){
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .split(/\s+/)[0];
}

function voucherEmployeeName(employee){
  const first = normalizeNameKey(employee.name);
  return voucherFullNameMap[first] || String(employee.name || 'FUNCIONÁRIO').toUpperCase();
}

function formatDateBR(date){
  return `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}/${date.getFullYear()}`;
}

function voucherPeriod(){
  const [year, month] = String(state.settings.month || currentMonth()).split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  return {
    vigencia: formatDateBR(first),
    periodo: `${formatDateBR(first)} até ${formatDateBR(last)}`
  };
}

function voucherRows(){
  const sold = totalSold();
  const totalPrize = parseVal(state.settings.prize);

  return state.employees.map(employee => {
    const employeeSale = employeeSold(employee.id);

    // Premiação normal continua igual à tela de Resultados.
    const rankingPrize = sold > 0 ? (employeeSale / sold) * totalPrize : 0;

    // Vendas extras entram somente no PDF dos comprovantes.
    // Elas não alteram ranking, atingimento ou premiação da tela.
    const extrasTotal = employeeExtraTotal(employee.id);
    const voucherTotal = rankingPrize + extrasTotal;

    return {
      name: voucherEmployeeName(employee),
      prize: voucherTotal,
      rankingPrize,
      extrasTotal,
      employeeSale
    };
  });
}

function escapeHtml(value){
  return String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

function voucherBlock(row, via, period, logoUrl){
  return `
    <section class="voucher">
      <div class="voucher-title">BONIFICAÇÃO&nbsp;&nbsp;|&nbsp;&nbsp;${via}</div>
      <div class="company-line">
        <strong>Empresa:</strong> Farmais Tietê&nbsp;&nbsp;
        <strong>CNPJ:</strong> 23.520.159/0001-32&nbsp;&nbsp;
        <strong>Vigência:</strong> ${period.vigencia}
      </div>

      <div class="voucher-body">
        <img class="voucher-watermark" src="${logoUrl}" alt="" />
        <table>
          <tr>
            <th class="label employee-label">FUNCIONÁRIO</th>
            <td class="employee-name">${escapeHtml(row.name)}</td>
          </tr>
          <tr>
            <th class="label">Responsável pela apuração</th>
            <td>Nádia Gomes Froes</td>
          </tr>
          <tr>
            <th class="label">Área contemplada</th>
            <td>BONIFICAÇÃO</td>
          </tr>
          <tr>
            <th class="label">Período de apuração</th>
            <td>${period.periodo}</td>
          </tr>
          <tr>
            <th class="label">Data prevista de pagamento</th>
            <td>5° dia útil</td>
          </tr>
          <tr>
            <th class="label">Valor total</th>
            <td class="money">${brl(row.prize)}</td>
          </tr>
          <tr>
            <th class="signature" colspan="2">Assinatura: __________________________________________________________</th>
          </tr>
        </table>
      </div>
    </section>
  `;
}

function buildVouchersHtml(){
  const period = voucherPeriod();
  const logoUrl = voucherLogoDataUri;
  const rows = voucherRows();
  const pages = rows.map(row => `
    <article class="voucher-page">
      ${voucherBlock(row, '1ª VIA', period, logoUrl)}
      <div class="cut-line">✂ — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —</div>
      ${voucherBlock(row, '2ª VIA', period, logoUrl)}
    </article>
  `).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Comprovantes de Bonificação - ${period.periodo}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    html,body{margin:0;padding:0;background:#fff;color:#202631;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .print-info{display:none}
    .voucher-page{
      width:194mm;
      min-height:281mm;
      padding:4mm 0 0;
      margin:0 auto;
      page-break-after:always;
      break-after:page;
      background:#fff;
    }
    .voucher-page:last-child{page-break-after:auto;break-after:auto}
    .voucher{
      width:100%;
      border:1px solid #9aa7b6;
      margin:0 0 3.5mm;
      min-height:114mm;
      position:relative;
      overflow:hidden;
      background:#ffffff;
    }
    .voucher-title{
      background:#30499c;
      color:#ffffff;
      height:10mm;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:16px;
      font-weight:800;
      letter-spacing:.2px;
    }
    .company-line{
      height:9mm;
      display:flex;
      align-items:center;
      justify-content:center;
      background:#f2f4f7;
      color:#222b38;
      font-size:10.2px;
      border-bottom:1px solid #aeb8c6;
      white-space:nowrap;
    }
    .voucher-body{
      position:relative;
      min-height:95mm;
    }
    .voucher-watermark{
      position:absolute;
      right:9mm;
      top:22mm;
      width:96mm;
      opacity:.18;
      z-index:0;
      pointer-events:none;
      -webkit-print-color-adjust:exact;
      print-color-adjust:exact;
    }
    table{
      position:relative;
      z-index:1;
      width:100%;
      border-collapse:collapse;
      table-layout:fixed;
    }
    th,td{
      border:1px solid #aeb8c6;
      padding:0 4mm;
      height:11.4mm;
      font-size:11.2px;
      text-align:left;
      vertical-align:middle;
      background:rgba(255,255,255,.76);
    }
    th.label{
      width:61mm;
      font-weight:700;
      background:#eef0f2;
    }
    .employee-label{
      background:#ff1f3c!important;
      color:#fff;
      text-align:center;
      font-size:12px;
      font-weight:900!important;
    }
    .employee-name{
      font-size:12px;
      font-weight:800;
      background:#eaf0f7;
      color:#27313f;
    }
    .money{
      font-weight:900;
      color:#111827;
    }
    .signature{
      height:18mm;
      background:#fff;
      font-weight:700;
      font-size:11px;
      border-left:0;
      border-right:0;
      border-bottom:0;
    }
    .cut-line{
      height:10mm;
      display:flex;
      align-items:center;
      justify-content:center;
      color:#555;
      font-size:12px;
      white-space:nowrap;
      overflow:hidden;
    }
    .actions{
      position:fixed;
      right:18px;
      top:18px;
      display:flex;
      gap:8px;
      z-index:10;
    }
    .actions button{
      border:1px solid #d4dce8;
      background:#005095;
      color:#fff;
      font-weight:800;
      padding:10px 14px;
      border-radius:8px;
      cursor:pointer;
      box-shadow:0 6px 16px rgba(0,0,0,.15);
    }
    @media print{
      .actions{display:none}
      .voucher-page{margin:0;width:auto;min-height:auto}
    }
  </style>
</head>
<body>
  <div class="actions">
    <button onclick="window.print()">Imprimir / Salvar PDF</button>
    <button onclick="window.close()">Fechar</button>
  </div>
  ${pages}
  <script>
    function waitForImages(){
      const imgs = Array.from(document.images);
      return Promise.all(imgs.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      }));
    }
    window.addEventListener('load', () => {
      waitForImages().then(() => setTimeout(() => window.print(), 700));
    });
  <\/script>
</body>
</html>`;
}

function openVoucherPrint(){
  renderResults();
  const printWindow = window.open('', '_blank');
  if(!printWindow){
    alert('O navegador bloqueou a nova aba. Libere pop-ups para imprimir os comprovantes.');
    return;
  }
  printWindow.document.open();
  printWindow.document.write(buildVouchersHtml());
  printWindow.document.close();
}

if (printVouchersBtn) {
  printVouchersBtn.addEventListener('click', openVoucherPrint);
}


/* Mostrar/ocultar senha */
document.querySelectorAll('.password-toggle').forEach(button=>{
  button.addEventListener('click', ()=>{
    const wrap = button.closest('.password-wrap');
    const input = wrap?.querySelector('input');
    if(!input) return;

    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.classList.toggle('is-visible', !showing);
    button.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
    button.setAttribute('aria-pressed', String(!showing));
    input.focus();
  });
});

/* Login e criação de usuário */
const authScreen = document.getElementById('authScreen');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginMessage = document.getElementById('loginMessage');
const registerMessage = document.getElementById('registerMessage');
const showRegister = document.getElementById('showRegister');
const showLogin = document.getElementById('showLogin');
const logoutBtn = document.getElementById('logoutBtn');


function setAuthMessage(el, message, success=false){
  if(!el) return;
  el.textContent = message || '';
  el.classList.toggle('success', !!success);
}

function showAuthForm(form){
  loginForm?.classList.toggle('active', form === 'login');
  registerForm?.classList.toggle('active', form === 'register');
  setAuthMessage(loginMessage, '');
  setAuthMessage(registerMessage, '');
}

function isLoggedIn(){
  try{
    const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
    return !!(session && session.username && session.loggedAt);
  }catch{
    return false;
  }
}

function unlockApp(){
  document.body.classList.remove('auth-locked');
}

function lockApp(){
  document.body.classList.add('auth-locked');
  showAuthForm('login');
}

async function authRequest(action, username, password){
  const safeUsername = normalizeClientUsername(username);

  function localAuth(){
    const users = JSON.parse(localStorage.getItem('farmaisLocalUsers') || '{}');
    if(action === 'register'){
      if(users[safeUsername]) throw new Error('Esse usuário já existe neste navegador.');
      users[safeUsername] = {password};
      localStorage.setItem('farmaisLocalUsers', JSON.stringify(users));
      return {ok:true, user:{username:safeUsername}, local:true};
    }
    if(action === 'login'){
      if(!users[safeUsername] || users[safeUsername].password !== password) throw new Error('Usuário ou senha incorretos.');
      return {ok:true, user:{username:safeUsername}, local:true};
    }
    throw new Error('Ação inválida.');
  }

  if(location.protocol === 'file:'){
    return localAuth();
  }

  let response;
  try{
    response = await fetch('/api/auth', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action, username:safeUsername, password})
    });
  }catch(err){
    throw new Error('Não consegui conectar com a API da Vercel. Verifique se o deploy terminou.');
  }

  const rawText = await response.text();
  let data = {};
  try{ data = rawText ? JSON.parse(rawText) : {}; }catch{}

  if(!response.ok || !data.ok){
    const msg = data.error || rawText || `Erro ${response.status}`;
    throw new Error(msg);
  }

  return data;
}

showRegister?.addEventListener('click', ()=>showAuthForm('register'));
showLogin?.addEventListener('click', ()=>showAuthForm('login'));

loginForm?.addEventListener('submit', async e=>{
  e.preventDefault();
  const username = loginUser.value.trim();
  const password = loginPassword.value;

  if(!username || !password){
    setAuthMessage(loginMessage, 'Preencha usuário e senha.');
    return;
  }

  setAuthMessage(loginMessage, 'Entrando...');
  try{
    await authRequest('login', username, password);
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({username:normalizeClientUsername(username), loggedAt:new Date().toISOString()}));
    setAuthMessage(loginMessage, 'Login realizado com sucesso.', true);
    unlockApp();

    const monthToLoad = await getCloudCurrentMonth() || currentMonth();
    await loadMonth(monthToLoad);
    appReady = true;
    startAutoCloudSync();

    loginForm.reset();
  }catch(err){
    setAuthMessage(loginMessage, err.message || 'Usuário ou senha incorretos.');
  }
});

registerForm?.addEventListener('submit', async e=>{
  e.preventDefault();
  const username = registerUser.value.trim();
  const password = registerPassword.value;
  const confirm = registerPasswordConfirm.value;

  if(username.length < 3){
    setAuthMessage(registerMessage, 'O usuário precisa ter pelo menos 3 caracteres.');
    return;
  }
  if(password.length < 4){
    setAuthMessage(registerMessage, 'A senha precisa ter pelo menos 4 caracteres.');
    return;
  }
  if(password !== confirm){
    setAuthMessage(registerMessage, 'As senhas não conferem.');
    return;
  }

  setAuthMessage(registerMessage, 'Criando login...');
  try{
    await authRequest('register', username, password);
    setAuthMessage(registerMessage, 'Login criado. Agora entre com seu usuário.', true);
    registerForm.reset();
    setTimeout(()=>showAuthForm('login'), 900);
  }catch(err){
    setAuthMessage(registerMessage, err.message || 'Não foi possível criar o login.');
  }
});

logoutBtn?.addEventListener('click', async ()=>{
  stopAutoCloudSync();
  saveLocal();
  await saveToUpstash(true);
  appReady = false;
  localStorage.removeItem(AUTH_SESSION_KEY);
  lockApp();
});

if(isLoggedIn()){
  unlockApp();
}else{
  lockApp();
}

function renderSettings(){
  mesReferencia.value=state.settings.month;
  diasTrabalho.value=state.settings.workDays;
  if (document.activeElement !== metaMes) metaMes.value=formatInputDecimal(state.settings.monthlyGoal);
  if (document.activeElement !== premiacao) premiacao.value=formatInputDecimal(state.settings.prize);
}
function bindSettings(){
  mesReferencia.onchange=async e=>{
    const nextMonth = e.target.value;
    if(!nextMonth || nextMonth === state.settings.month) return;
    await setCloudCurrentMonth(nextMonth);
    await loadMonth(nextMonth);
  };

  diasTrabalho.oninput=e=>{
    e.target.value=sanitizeNumberInput(e.target.value);
    state.settings.workDays=parseVal(e.target.value);
    recalcEmployeeGoals();
    save();
  };

  metaMes.oninput=e=>{
    e.target.value=sanitizeNumberInput(e.target.value);
    state.settings.monthlyGoal=parseVal(e.target.value);
    recalcEmployeeGoals();
    saveLocal();
    scheduleCloudSave();
    renderEmployees();
    renderResults();
  };
  metaMes.onblur=()=>{
    metaMes.value=formatInputDecimal(state.settings.monthlyGoal);
    recalcEmployeeGoals();
    saveLocal();
    scheduleCloudSave();
    renderEmployees();
    renderResults();
  };

  premiacao.oninput=e=>{
    e.target.value=sanitizeNumberInput(e.target.value);
    state.settings.prize=parseVal(e.target.value);
    recalcEmployeeGoals();
    saveLocal();
    scheduleCloudSave();
    renderEmployees();
    renderResults();
  };
  premiacao.onblur=()=>{
    premiacao.value=formatInputDecimal(state.settings.prize);
    recalcEmployeeGoals();
    saveLocal();
    scheduleCloudSave();
    renderEmployees();
    renderResults();
  };
}

function renderEmployees(){
  recalcEmployeeGoals();
  employeeRows.innerHTML='';
  state.employees.forEach(e=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td><input value="${e.name}" data-k="name"></td>
      <td><input value="${e.role}" data-k="role"></td>
      <td><input inputmode="decimal" value="${String(e.percent).replace('.', ',')}" data-k="percent"></td>
      <td><input class="auto-field" inputmode="decimal" value="${formatInputDecimal(employeeTarget(e))}" data-k="target" readonly title="Calculado automaticamente pela meta do mês e percentual"></td>
      <td><input class="auto-field" inputmode="decimal" value="${formatInputDecimal(employeeDaily(e))}" data-k="daily" readonly title="Calculado automaticamente pela meta individual dividida pelos dias de trabalho"></td>
      <td><button class="remove" type="button">Remover</button></td>
    `;

    tr.querySelectorAll('input').forEach(inp=>{
      inp.oninput=ev=>{
        const key=ev.target.dataset.k;

        if(key==='name' || key==='role'){
          e[key]=ev.target.value;
          saveLocal();
          scheduleCloudSave();
          renderDaily();
          renderExtraSales();
          renderResults();
          return;
        }

        if(key==='percent'){
          // Não renderiza a tabela durante a digitação.
          // Renderizar aqui recriava o input e fazia aceitar apenas 1 caractere por vez.
          ev.target.value=sanitizeNumberInput(ev.target.value);
          e.percent=parseVal(ev.target.value);
          recalcEmployeeGoals();
          saveLocal();
          scheduleCloudSave();
          renderResults();
        }
      };

      inp.onblur=ev=>{
        const key=ev.target.dataset.k;
        if(key==='percent'){
          ev.target.value = ev.target.value.trim() === '' ? '' : String(parseVal(e.percent)).replace('.', ',');
          recalcEmployeeGoals();
          saveLocal();
          scheduleCloudSave();
          renderEmployees();
          renderResults();
        }
      };
    });

    tr.querySelector('.remove').onclick=()=>{
      if(confirm('Remover este funcionário?')){
        state.employees=state.employees.filter(x=>x.id!==e.id);
        Object.values(state.sales).forEach(row=>delete row[e.id]);
        if(state.extraTotals) delete state.extraTotals[e.id];
        recalcEmployeeGoals();
        save();
      }
    };

    employeeRows.appendChild(tr);
  });
}
addEmployee.onclick=()=>{
  const emp={id:employeeId(),name:'',role:'',percent:0,target:0,daily:0};
  state.employees.push(emp);
  Object.values(state.sales).forEach(row=>row[emp.id]=0);
  state.extraTotals ||= {};
  state.extraTotals[emp.id] = {};
  EXTRA_SALES_CATEGORIES.forEach(cat=>state.extraTotals[emp.id][cat.key]=0);
  recalcEmployeeGoals();
  save();
};

generateDays.onclick=()=>{
  if(!confirm('Deseja limpar todos os lançamentos?')) return;
  ensureDays();
  Object.keys(state.sales).forEach(day=>{
    delete state.sales[day].__status;
    state.employees.forEach(e=>{ state.sales[day][e.id] = 0; });
  });
  save();
};


const clearExtraSalesBtn = document.getElementById('clearExtraSales');

if(clearExtraSalesBtn){
  clearExtraSalesBtn.onclick=()=>{
    if(!confirm('Deseja limpar todas as vendas extras do mês?')) return;
    ensureDays();
    state.employees.forEach(e=>{
      state.extraTotals[e.id] ||= {};
      EXTRA_SALES_CATEGORIES.forEach(cat=>{ state.extraTotals[e.id][cat.key] = 0; });
    });
    save();
  };
}

function extraCellValue(v){
  if(v === undefined || v === null || v === 0 || v === '0') return '';
  return String(v);
}

function renderExtraSales(){
  ensureDays();

  const extraHead = document.getElementById('extraHead');
  const extraBody = document.getElementById('extraBody');
  if(!extraHead || !extraBody) return;

  extraHead.innerHTML = '<tr><th>Funcionário</th>' + EXTRA_SALES_CATEGORIES.map(cat=>`<th>${cat.label}</th>`).join('') + '</tr>';
  extraBody.innerHTML = '';

  state.employees.forEach(e=>{
    normalizeExtraTotalsForEmployee(e.id);
    const tr=document.createElement('tr');

    tr.innerHTML = `<td class="employee-name-cell">${e.name}</td>` + EXTRA_SALES_CATEGORIES.map(cat=>{
      const value = extraCellValue(state.extraTotals[e.id][cat.key]);
      return `<td><input type="text" inputmode="decimal" autocomplete="off" value="${value}" data-id="${e.id}" data-cat="${cat.key}" placeholder="0,00"></td>`;
    }).join('');

    tr.querySelectorAll('input').forEach(inp=>{
      inp.oninput=ev=>{
        ev.target.value=sanitizeNumberInput(ev.target.value);
        const employeeId = ev.target.dataset.id;
        const catKey = ev.target.dataset.cat;
        state.extraTotals[employeeId] ||= {};
        state.extraTotals[employeeId][catKey] = ev.target.value;
        saveLocal();
        scheduleCloudSave();
      };
    });

    extraBody.appendChild(tr);
  });
}

function renderDaily(){
  ensureDays();
  dailyHead.innerHTML='<tr><th>Dia</th>'+state.employees.map(e=>`<th>${e.name}</th>`).join('')+'</tr>';
  dailyBody.innerHTML='';
  Object.keys(state.sales).map(Number).sort((a,b)=>a-b).forEach(day=>{
    const tr=document.createElement('tr');

    const dayCell = `<td class="day-cell"><div class="day-cell-inner"><span>${String(day).padStart(2,'0')}/${state.settings.month.split('-')[1]}</span></div></td>`;

    tr.innerHTML = dayCell + state.employees.map(e=>{
      const special = getCellSpecialValue(day, e.id);
      const value = special ? specialValueLabel(special) : dailyCellValue(state.sales[day][e.id]);
      const readonly = !!special;
      const statusClass = special ? ` status-${special}` : '';
      const menuHtml = `
        <div class="cell-menu">
          <button class="cell-menu-btn" type="button" aria-label="Abrir opções do campo">▾</button>
          <div class="cell-menu-list">
            <button type="button" class="cell-menu-option" data-status="folga">Folga</button>
            <button type="button" class="cell-menu-option" data-status="falta">Falta</button>
            <button type="button" class="cell-menu-option" data-status="atestado">Atestado</button>
            ${special ? '<button type="button" class="cell-menu-option clear" data-status="limpar">Limpar</button>' : ''}
          </div>
        </div>`;
      return `<td><div class="input-with-menu"><input type="text" inputmode="decimal" autocomplete="off" value="${value}" data-day="${day}" data-id="${e.id}" placeholder="0,00" ${readonly ? 'readonly' : ''} class="${special ? 'status-input' : ''}${statusClass}">${menuHtml}</div></td>`;
    }).join('');

    tr.querySelectorAll('.cell-menu').forEach(menuEl=>{
      const btn = menuEl.querySelector('.cell-menu-btn');
      btn.onclick=(ev)=>{
        ev.stopPropagation();
        document.querySelectorAll('.cell-menu.open').forEach(el=>{
          if(el !== menuEl) el.classList.remove('open');
        });
        menuEl.classList.toggle('open');
      };
      menuEl.querySelectorAll('.cell-menu-option').forEach(statusBtn=>{
        statusBtn.onclick=(ev)=>{
          ev.stopPropagation();
          const status = statusBtn.dataset.status;
          const wrapper = statusBtn.closest('.input-with-menu');
          const input = wrapper.querySelector('input');
          const rowDay = input.dataset.day;
          const employeeId = input.dataset.id;
          if(status === 'limpar'){
            clearCellSpecialValue(rowDay, employeeId);
          }else{
            setCellSpecialValue(rowDay, employeeId, status);
          }
          saveLocal();
          scheduleCloudSave();
          renderDaily();
          renderResults();
        };
      });
    });

    tr.querySelectorAll('input:not([readonly])').forEach(inp=>inp.oninput=ev=>{
      ev.target.value=sanitizeNumberInput(ev.target.value);
      state.sales[ev.target.dataset.day][ev.target.dataset.id]=ev.target.value;
      saveLocal();
      scheduleCloudSave();
      renderResults();
    });

    dailyBody.appendChild(tr);
  });
}
// Lógica igual à planilha:
// total vendido = soma dos lançamentos numéricos; textos como FOLGA/atestado valem zero.
// % da meta = vendido do funcionário / meta individual.
// participação = vendido do funcionário / total vendido da loja.
// premiação = participação * premiação configurada.
function renderResults(){
  recalcEmployeeGoals();
  const sold=totalSold(), goal=state.settings.monthlyGoal, missing=Math.max(goal-sold,0), attainment=goal?sold/goal*100:0;
  const days=state.settings.workDays || daysInMonth(state.settings.month);
  const launched=launchedDays();
  const projection=launched?sold/launched*Math.max(1,state.settings.workDays):sold;
  const totalPrize=parseVal(state.settings.prize);
  kpiMetaMes.textContent=brl(goal);
  kpiVendido.textContent=brl(sold);
  kpiFalta.textContent=brl(missing);
  kpiAtingimento.textContent=pct(attainment);
  progressPercent.textContent=pct(attainment);
  progressBar.style.width=Math.min(attainment,100)+'%';
  statusMeta.textContent=attainment>=100?'Meta batida':'Em andamento';
  metaDiariaLoja.textContent=brl(goal/Math.max(1,state.settings.workDays));
  diasLancados.textContent=`${launched} / ${days}`;
  projecaoMes.textContent=brl(projection || sold);
  premiacaoProjetada.textContent=brl(totalPrize);
  const percentSum=state.employees.reduce((s,e)=>s+parseVal(e.percent),0);
  percentWarning.textContent=Math.abs(percentSum-100)>.01?'':'';
  resultRows.innerHTML='';

  // Ranking funcional:
  // - Ordena por maior valor vendido.
  // - Se todos estiverem zerados, não exibe 1º, 2º, 3º...
  // - Funcionários zerados ficam no final e sem posição até terem lançamento.
  const rankedEmployees = state.employees
    .map((employee, originalIndex) => ({
      employee,
      originalIndex,
      sold: employeeSold(employee.id),
      target: employeeTarget(employee)
    }))
    .sort((a, b) => {
      if (b.sold !== a.sold) return b.sold - a.sold;
      const attA = a.target ? a.sold / a.target : 0;
      const attB = b.target ? b.sold / b.target : 0;
      if (attB !== attA) return attB - attA;
      return a.originalIndex - b.originalIndex;
    });

  let visibleRank = 0;
  rankedEmployees.forEach(({ employee:e, sold:soldE, target })=>{
    const miss=target-soldE, att=target?soldE/target*100:0, prize=sold>0?(soldE/sold)*totalPrize:0;
    const tr=document.createElement('tr');
    let rankHtml = '<span class="rank-empty">—</span>';

    if (soldE > 0) {
      visibleRank += 1;
      const rankClass=visibleRank===1?'r1':visibleRank===2?'r2':visibleRank===3?'r3':'';
      rankHtml = `<span class="rank-badge ${rankClass}">${visibleRank}</span>`;
    }

    const soldClass=soldE>=target && soldE>0?'val-green':'val-blue';
    const attClass=att>=100?'val-green':'val-orange';
    const missClass=miss<=0?'negative':'positive';
    tr.innerHTML=`<td>${rankHtml}</td><td>${e.name}</td><td>${brl(target)}</td><td class="${soldClass}">${brl(soldE)}</td><td class="${attClass}">${pct(att)}</td><td class="${missClass}">${brl(miss)}</td><td class="val-green">${brl(prize)}</td>`;
    resultRows.appendChild(tr);
  });
}

function renderAll(){ensureDays();recalcEmployeeGoals();renderSettings();renderEmployees();renderDaily();renderExtraSales();renderResults();}
bindSettings();
if(isLoggedIn()){
  initCloudSync().then(()=>{
    appReady = true;
    startAutoCloudSync();
  });
}else{
  appReady = true;
  renderAll();
  switchScreen('resultados');
}
