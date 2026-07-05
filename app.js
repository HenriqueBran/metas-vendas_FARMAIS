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

function currentMonth(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function employeeId(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `emp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const defaultState = {
  settings:{month:currentMonth(), workDays:26, monthlyGoal:150000, prize:0},
  employees:[
    {id:employeeId(), name:'Cristiana', role:'Balconista', percent:15},
    {id:employeeId(), name:'Genivaldo', role:'Farmacêutico', percent:15},
    {id:employeeId(), name:'Nadia', role:'Farmacêutico', percent:15},
    {id:employeeId(), name:'Arnobio', role:'Farmacêutico', percent:15},
    {id:employeeId(), name:'Lucas', role:'Atendente', percent:15},
    {id:employeeId(), name:'Nalva', role:'Atendente', percent:15},
    {id:employeeId(), name:'Fernanda', role:'Atendente', percent:15}
  ],
  sales:{},
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
    employees:Array.isArray(data.employees) && data.employees.length ? data.employees : base.employees,
    sales:data.sales && typeof data.sales === 'object' ? data.sales : {},
    updatedAt:data.updatedAt || null
  };
  normalized.settings.month = month || normalized.settings.month || currentMonth();
  normalized.settings.workDays = parseVal(normalized.settings.workDays) || 26;
  normalized.settings.monthlyGoal = parseVal(normalized.settings.monthlyGoal);
  normalized.settings.prize = parseVal(normalized.settings.prize);
  normalized.employees = normalized.employees.map(e=>({
    id:e.id || employeeId(),
    name:e.name || 'Funcionário',
    role:e.role || '',
    percent:parseVal(e.percent)
  }));
  return normalized;
}

function createMonthState(month, baseState){
  const base = baseState ? cloneState(baseState) : cloneState(defaultState);
  return normalizeState({
    settings:{...base.settings, month},
    employees:base.employees,
    sales:{},
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
  const month = localStorage.getItem(currentMonthKey()) || currentMonth();
  return loadLocalMonth(month) || createMonthState(month);
}

let cloudSaveTimer = null;
let cloudReady = false;
let state = loadInitial();

function saveLocal(){
  state.updatedAt = new Date().toISOString();
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
  const response = await fetch(`/api/monthly-data?month=${encodeURIComponent(month)}&user=${encodeURIComponent(username)}`, options);
  if (!response.ok) {
    const errorText = await response.text().catch(()=>'');
    throw new Error(errorText || `Erro ${response.status}`);
  }
  return response.json();
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

async function saveToUpstash(){
  try{
    await apiRequest('POST', state.settings.month, state);
    cloudReady = true;
  }catch(err){
    console.warn('Não foi possível salvar no Upstash agora:', err.message);
  }
}

function scheduleCloudSave(){
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(()=>saveToUpstash(), 700);
}

function save(){
  saveLocal();
  scheduleCloudSave();
  renderAll();
}

async function loadMonth(month){
  const previousScreen = document.querySelector('.screen.active')?.id || 'resultados';
  saveLocal();
  scheduleCloudSave();

  state = loadLocalMonth(month) || createMonthState(month, state);
  ensureDays();
  renderAll();
  switchScreen(previousScreen);

  const cloudState = await loadFromUpstash(month);
  if(cloudState){
    const localTime = state.updatedAt ? Date.parse(state.updatedAt) : 0;
    const cloudTime = cloudState.updatedAt ? Date.parse(cloudState.updatedAt) : 0;
    if(!state.updatedAt || cloudTime >= localTime){
      state = cloudState;
      ensureDays();
      saveLocal();
      renderAll();
      switchScreen(previousScreen);
    }
  }else{
    scheduleCloudSave();
  }
}

async function initCloudSync(){
  const cloudState = await loadFromUpstash(state.settings.month);
  if(cloudState){
    const localTime = state.updatedAt ? Date.parse(state.updatedAt) : 0;
    const cloudTime = cloudState.updatedAt ? Date.parse(cloudState.updatedAt) : 0;
    if(cloudTime > localTime){
      state = cloudState;
      ensureDays();
      saveLocal();
      renderAll();
      switchScreen(document.querySelector('.screen.active')?.id || 'resultados');
    }else{
      scheduleCloudSave();
    }
  }else{
    scheduleCloudSave();
  }
}

function daysInMonth(month){const [y,m]=month.split('-').map(Number);return new Date(y,m,0).getDate();}
function ensureDays(){
  const total=daysInMonth(state.settings.month);
  let changed=false;

  // Remove dias que não existem no mês selecionado.
  // Ex.: setembro tem 30 dias, então o dia 31 é removido automaticamente.
  Object.keys(state.sales).forEach(day=>{
    if(Number(day)>total){
      delete state.sales[day];
      changed=true;
    }
  });

  // Garante que todos os dias válidos do mês existam.
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

  if(changed){
    saveLocal();
  }
}
function employeeTarget(e){return state.settings.monthlyGoal*(parseVal(e.percent)/100)}
function employeeDaily(e){return employeeTarget(e)/Math.max(1,state.settings.workDays)}
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
    lancamentos:['Lançamentos diários','Informe as vendas por dia e por funcionário.']
  };
  screenTitle.textContent=titles[id][0];
  screenSubtitle.textContent=titles[id][1];

  const printBtn = document.getElementById('printCurrentBtn');
  if (printBtn) {
    if (id === 'resultados') {
      setPrintButtonLabel('Imprimir resultados');
      printBtn.classList.remove('hidden-print-cta');
      printBtn.dataset.printScreen = 'resultados';
    } else if (id === 'lancamentos') {
      setPrintButtonLabel('Imprimir lançamentos');
      printBtn.classList.remove('hidden-print-cta');
      printBtn.dataset.printScreen = 'lancamentos';
    } else {
      printBtn.classList.add('hidden-print-cta');
      printBtn.dataset.printScreen = '';
    }
  }
}
document.querySelectorAll('.nav').forEach(btn=>btn.onclick=()=>switchScreen(btn.dataset.screen));

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



/* Login e criação de usuário */
const authScreen = document.getElementById('authScreen');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginMessage = document.getElementById('loginMessage');
const registerMessage = document.getElementById('registerMessage');
const showRegister = document.getElementById('showRegister');
const showLogin = document.getElementById('showLogin');
const logoutBtn = document.getElementById('logoutBtn');
const AUTH_SESSION_KEY = 'farmaisAuthSession';

function getCurrentUsername(){
  try{
    const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
    return session && session.username ? String(session.username).trim().toLowerCase() : 'sem-login';
  }catch{
    return 'sem-login';
  }
}

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
  if(location.protocol === 'file:'){
    const users = JSON.parse(localStorage.getItem('farmaisLocalUsers') || '{}');
    if(action === 'register'){
      if(users[username]) throw new Error('Esse usuário já existe.');
      users[username] = {password};
      localStorage.setItem('farmaisLocalUsers', JSON.stringify(users));
      return {ok:true};
    }
    if(action === 'login'){
      if(!users[username] || users[username].password !== password) throw new Error('Usuário ou senha incorretos.');
      return {ok:true, user:{username}};
    }
  }

  const response = await fetch('/api/auth', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action, username, password})
  });

  const data = await response.json().catch(()=>({}));
  if(!response.ok || !data.ok){
    throw new Error(data.error || 'Não foi possível concluir a operação.');
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
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({username, loggedAt:new Date().toISOString()}));
    setAuthMessage(loginMessage, 'Login realizado com sucesso.', true);
    unlockApp();

    const monthToLoad = localStorage.getItem(`${STORAGE_PREFIX}:currentMonth:${getCurrentUsername()}`) || state.settings.month || currentMonth();
    await loadMonth(monthToLoad);

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

logoutBtn?.addEventListener('click', ()=>{
  saveLocal();
  scheduleCloudSave();
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
    await loadMonth(nextMonth);
  };

  diasTrabalho.oninput=e=>{
    state.settings.workDays=parseVal(e.target.value);
    save();
  };

  metaMes.oninput=e=>{
    state.settings.monthlyGoal=parseVal(e.target.value);
    saveLocal();
    scheduleCloudSave();
    renderEmployees();
    renderResults();
  };
  metaMes.onblur=()=>{
    metaMes.value=formatInputDecimal(state.settings.monthlyGoal);
    saveLocal();
    scheduleCloudSave();
  };

  premiacao.oninput=e=>{
    state.settings.prize=parseVal(e.target.value);
    saveLocal();
    scheduleCloudSave();
    renderResults();
  };
  premiacao.onblur=()=>{
    premiacao.value=formatInputDecimal(state.settings.prize);
    saveLocal();
    scheduleCloudSave();
  };
}

function renderEmployees(){
  employeeRows.innerHTML='';
  state.employees.forEach(e=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td><input value="${e.name}" data-k="name"></td><td><input value="${e.role}" data-k="role"></td><td><input value="${e.percent}" data-k="percent"></td><td>${brl(employeeTarget(e))}</td><td>${brl(employeeDaily(e))}</td><td><button class="remove" type="button">Remover</button></td>`;
    tr.querySelectorAll('input').forEach(inp=>inp.oninput=ev=>{e[ev.target.dataset.k]=ev.target.dataset.k==='percent'?parseVal(ev.target.value):ev.target.value;save()});
    tr.querySelector('.remove').onclick=()=>{if(confirm('Remover este funcionário?')){state.employees=state.employees.filter(x=>x.id!==e.id);Object.values(state.sales).forEach(row=>delete row[e.id]);save();}};
    employeeRows.appendChild(tr);
  });
}
addEmployee.onclick=()=>{
  const emp={id:crypto.randomUUID(),name:'Novo funcionário',role:'Cargo',percent:0};
  state.employees.push(emp);
  Object.values(state.sales).forEach(row=>row[emp.id]=0);
  save();
};

generateDays.onclick=()=>{
  if(!confirm('Deseja limpar todos os lançamentos?')) return;
  ensureDays();
  Object.keys(state.sales).forEach(day=>{
    state.employees.forEach(e=>{ state.sales[day][e.id] = 0; });
  });
  save();
};

function renderDaily(){
  ensureDays();
  dailyHead.innerHTML='<tr><th>Dia</th>'+state.employees.map(e=>`<th>${e.name}</th>`).join('')+'</tr>';
  dailyBody.innerHTML='';
  Object.keys(state.sales).map(Number).sort((a,b)=>a-b).forEach(day=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${String(day).padStart(2,'0')}/${state.settings.month.split('-')[1]}</td>`+state.employees.map(e=>`<td><input inputmode="decimal" value="${state.sales[day][e.id]||''}" data-day="${day}" data-id="${e.id}" placeholder="0,00"></td>`).join('');
    tr.querySelectorAll('input').forEach(inp=>inp.oninput=ev=>{state.sales[ev.target.dataset.day][ev.target.dataset.id]=parseVal(ev.target.value);saveLocal();scheduleCloudSave();renderResults();});
    dailyBody.appendChild(tr);
  });
}

// Lógica da premiação igual à planilha:
// premiação do funcionário = venda do funcionário / venda total da loja * premiação configurada.
function renderResults(){
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
  diasLancados.textContent=`${Math.min(days, launched || days)} / ${days}`;
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

function renderAll(){ensureDays();renderSettings();renderEmployees();renderDaily();renderResults();}
bindSettings();
renderAll();
switchScreen('resultados');

if(isLoggedIn()){
  const monthToLoad = localStorage.getItem(`${STORAGE_PREFIX}:currentMonth:${getCurrentUsername()}`) || state.settings.month || currentMonth();
  loadMonth(monthToLoad).then(()=>initCloudSync());
}else{
  initCloudSync();
}
