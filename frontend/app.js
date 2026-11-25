/* ============================================================
   SIMULADOR DE VENTAS 7 ARC — IAC (versión independiente)
   Frontend estático + backend propio (Node/Express + OpenAI/Azure OpenAI)
   Simulación de LLAMADA con reconocimiento y síntesis de voz del navegador
   (Web Speech API) — no depende de Claude en absoluto.
   ============================================================ */

const API = ""; // mismo origen (el backend sirve este frontend)

const ARC_KEYS = ["prospectar","quimica","diagnostico","presentacion","objeciones","cierre","reventa"];
const ARC_LABELS = {
  prospectar:"Prospectar", quimica:"Química y Confianza", diagnostico:"Diagnóstico",
  presentacion:"Presentación", objeciones:"Manejo de Objeciones", cierre:"Cierre", reventa:"Reventa y Referidos"
};

function uuid(){
  if(crypto.randomUUID) return crypto.randomUUID();
  return "u" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

let STATE = {
  ready:false,
  userId: localStorage.getItem("sim7arc_userId") || uuid(),
  nombre: localStorage.getItem("sim7arc_nombre") || "",
  email: localStorage.getItem("sim7arc_email") || "",
  adminToken: localStorage.getItem("sim7arc_adminToken") || "",
  isAdmin:false,
  productos:[],
  tab:"simular",
  call:{active:false, mensajes:[], escenario:null, nivel:2, producto:null, escuchando:false, procesando:false, evaluando:false, resultado:null, caption:""},
  misResultados:[], equipoResultados:[], loadingTeam:false,
  uso:null, loadingUso:false,
};
localStorage.setItem("sim7arc_userId", STATE.userId);

function el(html){const d=document.createElement("div");d.innerHTML=html.trim();return d.firstChild;}
function $(sel,root=document){return root.querySelector(sel);}
function escapeHtml(s){return (s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

async function api(path, opts={}){
  const headers = {"Content-Type":"application/json"};
  if(STATE.adminToken) headers["x-admin-password"] = STATE.adminToken;
  const r = await fetch(API + path, {...opts, headers: {...headers, ...(opts.headers||{})}});
  if(!r.ok){
    let msg = "Error " + r.status;
    try{ const j = await r.json(); if(j.error) msg = j.error; }catch(e){}
    throw new Error(msg);
  }
  return r.json();
}

/* ---------------- Web Speech API: reconocimiento y síntesis ---------------- */

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let vocesListas = false;
let vocesDisponibles = [];
if("speechSynthesis" in window){
  window.speechSynthesis.onvoiceschanged = () => {
    vocesDisponibles = window.speechSynthesis.getVoices();
    vocesListas = true;
  };
  vocesDisponibles = window.speechSynthesis.getVoices();
}

function vozEspanol(){
  const candidatas = vocesDisponibles.filter(v => /es/i.test(v.lang));
  return candidatas[0] || null;
}

function hablar(texto){
  return new Promise((resolve)=>{
    if(!("speechSynthesis" in window) || !texto){ resolve(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = "es-CO";
    const v = vozEspanol();
    if(v) u.voice = v;
    u.rate = 1.0;
    u.onend = resolve;
    u.onerror = resolve;
    window.speechSynthesis.speak(u);
  });
}

function crearReconocedor(onFinal, onParcial, onEstado, onError){
  if(!SpeechRecognitionImpl) return null;
  const r = new SpeechRecognitionImpl();
  r.lang = "es-CO";
  r.continuous = true;
  r.interimResults = true;
  r.onresult = (ev)=>{
    let interim = "";
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const res = ev.results[i];
      if(res.isFinal) onFinal(res[0].transcript.trim());
      else interim += res[0].transcript;
    }
    if(interim) onParcial(interim);
  };
  r.onend = ()=>onEstado("idle");
  r.onerror = (ev)=>{ onEstado("idle"); if(onError) onError(ev.error); };
  return r;
}

function mensajeErrorMic(codigo){
  const mapa = {
    "not-allowed": "El navegador bloqueó el micrófono. Haz clic en el ícono de candado/micrófono en la barra de direcciones, permite el acceso al micrófono para este sitio y recarga la página.",
    "permission-denied": "El navegador bloqueó el micrófono. Haz clic en el ícono de candado/micrófono en la barra de direcciones, permite el acceso al micrófono para este sitio y recarga la página.",
    "service-not-allowed": "Este navegador o una política del equipo está bloqueando el reconocimiento de voz. Prueba con Chrome o Edge sin restricciones de red/VPN.",
    "audio-capture": "No se encontró un micrófono disponible. Revisa que tengas uno conectado y habilitado en el sistema.",
    "no-speech": "No se detectó voz. Acércate al micrófono y vuelve a intentarlo.",
    "network": "Hubo un problema de red con el reconocimiento de voz de Google (lo usa Chrome/Edge internamente). Revisa tu conexión a internet e inténtalo de nuevo.",
    "language-not-supported": "El idioma español no está disponible para reconocimiento de voz en este navegador.",
    "aborted": "" // el usuario detuvo la grabación manualmente; no es un error real
  };
  return mapa[codigo] || ("No se pudo usar el micrófono (" + codigo + "). Puedes escribir tu respuesta en el campo de texto mientras tanto.");
}

/* ---------------- Boot ---------------- */

async function boot(){
  try{
    const me = await api("/api/me", {method:"POST", body: JSON.stringify({userId: STATE.userId, nombre: STATE.nombre, email: STATE.email})});
    STATE.nombre = me.nombre || "";
    STATE.email = me.email || "";
    localStorage.setItem("sim7arc_nombre", STATE.nombre);
    localStorage.setItem("sim7arc_email", STATE.email);
  }catch(e){ console.warn(e); }

  try{ STATE.productos = await api("/api/productos"); }catch(e){ console.warn(e); }

  if(STATE.adminToken){
    STATE.isAdmin = true; // se valida de verdad en cada llamada protegida; si el token es inválido, esas llamadas fallarán y se le pedirá reingresar
  }

  STATE.ready = true;
  render();
  loadMisResultados();
}

async function loadMisResultados(){
  try{
    STATE.misResultados = await api("/api/simulaciones/"+STATE.userId);
  }catch(e){ console.warn(e); }
  render();
}

async function loadEquipoResultados(){
  STATE.loadingTeam = true; render();
  try{
    STATE.equipoResultados = await api("/api/equipo");
  }catch(e){
    console.warn(e);
    STATE.isAdmin = false; STATE.adminToken=""; localStorage.removeItem("sim7arc_adminToken");
    showToast("Tu sesión de administrador expiró o la contraseña es inválida. Vuelve a ingresarla en la pestaña Admin.", true);
  }
  STATE.loadingTeam = false; render();
}

async function loadUso(){
  STATE.loadingUso = true;
  try{
    STATE.uso = await api("/api/uso");
  }catch(e){ console.warn(e); }
  STATE.loadingUso = false;
}

function showToast(msg, isErr){
  const t = el('<div class="'+(isErr?"err":"ok")+'" style="position:fixed;bottom:16px;right:16px;max-width:320px;z-index:99;">'+escapeHtml(msg)+'</div>');
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), isErr ? 8000 : 4500);
}

async function guardarNombre(nombre, email){
  STATE.nombre = nombre;
  STATE.email = email || STATE.email || "";
  localStorage.setItem("sim7arc_nombre", nombre);
  localStorage.setItem("sim7arc_email", STATE.email);
  try{ await api("/api/me", {method:"POST", body: JSON.stringify({userId: STATE.userId, nombre, email: STATE.email})}); }catch(e){}
  render();
}

/* ---------------- Simulación de llamada ---------------- */

function iniciarLlamada(opts){
  STATE.call = {active:true, mensajes:[], escenario:opts.escenario, nivel:opts.nivel, producto:opts.producto, escuchando:false, procesando:false, evaluando:false, resultado:null, caption:""};
  render();
}

async function turnoProspecto(){
  const call = STATE.call;
  call.procesando = true; render();
  try{
    const r = await api("/api/simular/turno", {method:"POST", body: JSON.stringify({
      nivel: call.nivel, escenario: call.escenario, producto: call.producto, transcripcion: call.mensajes
    })});
    call.mensajes.push({rol:"prospecto", texto:r.texto});
    call.procesando = false; render();
    await hablar(r.texto);
  }catch(e){
    console.warn(e);
    call.mensajes.push({rol:"sistema", texto:"No se pudo obtener respuesta del prospecto. Intenta de nuevo."});
    call.procesando = false; render();
  }
}

function manejarTranscripcionFinal(texto, chatCardRef){
  if(!texto) return;
  const call = STATE.call;
  call.mensajes.push({rol:"vendedor", texto});
  call.caption = "";
  render();
  turnoProspecto();
}

function toggleMicrofono(){
  const call = STATE.call;
  if(!SpeechRecognitionImpl){
    showToast("Tu navegador no soporta reconocimiento de voz (usa Chrome o Edge). Puedes escribir en su lugar.", true);
    return;
  }
  if(call.escuchando){
    recognizer && recognizer.stop();
    call.escuchando = false; render();
    return;
  }
  window.speechSynthesis && window.speechSynthesis.cancel();
  recognizer = crearReconocedor(
    (textoFinal)=>{ manejarTranscripcionFinal(textoFinal); },
    (parcial)=>{ STATE.call.caption = parcial; render(); },
    (estado)=>{ STATE.call.escuchando = false; render(); },
    (codigoError)=>{
      const msg = mensajeErrorMic(codigoError);
      if(msg) showToast(msg, true);
    }
  );
  try{
    recognizer.start();
    call.escuchando = true; render();
  }catch(e){
    showToast("No se pudo activar el micrófono: " + (e && e.message ? e.message : e), true);
  }
}

async function finalizarYEvaluar(){
  const call = STATE.call;
  if(call.escuchando){ recognizer && recognizer.stop(); call.escuchando=false; }
  call.evaluando = true; render();
  try{
    const r = await api("/api/simular/evaluar", {method:"POST", body: JSON.stringify({
      userId: STATE.userId, nivel: call.nivel, escenario: call.escenario, producto: call.producto, transcripcion: call.mensajes
    })});
    call.resultado = r.evaluacion;
    loadMisResultados();
  }catch(e){
    console.warn(e);
    showToast("No se pudo generar la evaluación. Intenta nuevamente.", true);
  }
  call.evaluando = false;
  render();
}

/* ---------------- Admin ---------------- */

async function loginAdmin(password){
  try{
    await api("/api/admin/login", {method:"POST", body: JSON.stringify({password})});
    STATE.adminToken = password;
    STATE.isAdmin = true;
    localStorage.setItem("sim7arc_adminToken", password);
    showToast("Acceso de administrador activado.");
    render();
  }catch(e){
    showToast("Contraseña de administrador incorrecta.", true);
  }
}
function logoutAdmin(){
  STATE.adminToken=""; STATE.isAdmin=false; localStorage.removeItem("sim7arc_adminToken"); render();
}

/* ---------------- RENDER ---------------- */

function render(){
  const app = $("#app");
  app.innerHTML = "";
  if(!STATE.ready){
    app.appendChild(el('<div class="loading">Cargando Simulador 7 ARC…</div>'));
    return;
  }

  const header = el(`
    <header class="topbar">
      <div class="brand">
        <img src="logo.png" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';">
        <span class="logo-fallback" style="display:none;">IAC</span>
        <h1>Simulador de Ventas <span>7 ARC</span></h1>
      </div>
      <div class="user-badge">
        ${escapeHtml(STATE.nombre || "Vendedor/a")}
        ${STATE.isAdmin ? '<span class="pill">ADMIN</span>' : ''}
      </div>
    </header>
  `);
  app.appendChild(header);

  const tabsDef = [["simular","Simular llamada"],["tablero","Mi Tablero"],["catalogo","Catálogo"],["uso","Uso Gratuito"]];
  if(STATE.isAdmin){ tabsDef.push(["equipo","Equipo"]); }
  tabsDef.push(["admin","Admin"]);

  const nav = el('<nav class="tabs"></nav>');
  tabsDef.forEach(([key,label])=>{
    const b = el('<button>'+escapeHtml(label)+'</button>');
    if(STATE.tab===key) b.classList.add("active");
    b.onclick = ()=>{ STATE.tab = key; if(key==="equipo") loadEquipoResultados(); if(key==="uso") loadUso().then(render); render(); };
    nav.appendChild(b);
  });
  app.appendChild(nav);

  const main = el('<main></main>');
  app.appendChild(main);

  if(!STATE.nombre && STATE.tab==="simular"){
    main.appendChild(renderOnboarding());
  }

  if(STATE.tab==="simular") main.appendChild(renderSimular());
  else if(STATE.tab==="tablero") main.appendChild(renderTablero());
  else if(STATE.tab==="catalogo") main.appendChild(renderCatalogo());
  else if(STATE.tab==="uso") main.appendChild(renderUso());
  else if(STATE.tab==="equipo") main.appendChild(renderEquipo());
  else if(STATE.tab==="admin") main.appendChild(renderAdmin());

  app.appendChild(el('<footer class="note">Simulador 7 ARC · Metodología adaptada para el equipo comercial de IAC · App independiente (backend propio) · Las evaluaciones son generadas por IA como apoyo de entrenamiento, no sustituyen la evaluación del gerente comercial.</footer>'));

  const cb = $("#chatBox", main);
  if(cb) cb.scrollTop = cb.scrollHeight;
}

function renderOnboarding(){
  const c = el(`<div class="card">
    <h2>¡Bienvenido/a!</h2>
    <p>Antes de empezar, dime tu nombre (y tu correo, para poder felicitarte cuando tengas una excelente llamada) para registrar tu progreso en el tablero.</p>
    <input id="nombreInput" placeholder="Tu nombre completo" value="${escapeHtml(STATE.nombre)}">
    <input id="emailInput" placeholder="tu.correo@iaclatam.com (opcional)" value="${escapeHtml(STATE.email)}">
    <button class="btn">Guardar</button>
  </div>`);
  $("button",c).onclick = ()=>{
    const v = $("#nombreInput",c).value.trim();
    const em = $("#emailInput",c).value.trim();
    if(v) guardarNombre(v, em);
  };
  return c;
}

function renderSimular(){
  const wrap = el('<div></div>');
  const call = STATE.call;

  if(!call.active){
    const productos = STATE.productos;
    const lineas = [...new Set(productos.map(p=>p.linea))];
    const card = el(`<div class="card">
      <h2>Configura tu llamada</h2>
      <p class="small">Esta práctica simula una LLAMADA: habla por el micrófono y escucharás la voz del prospecto. Funciona mejor en Chrome o Edge, en computador.</p>
      <div class="grid cols-2">
        <div>
          <label>Línea de negocio / producto a practicar</label>
          <select id="selProducto"></select>
        </div>
        <div>
          <label>Nivel de dificultad</label>
          <select id="selNivel">
            <option value="1">Nivel 1 — Inicial</option>
            <option value="2" selected>Nivel 2 — Intermedio (recomendado)</option>
            <option value="3">Nivel 3 — Avanzado</option>
            <option value="4">Nivel 4 — Experto</option>
          </select>
        </div>
      </div>
      <label>Describe brevemente el escenario</label>
      <textarea id="txtEscenario" rows="3" placeholder="Ej: Gerente de planta de una empresa de manufactura, interesado en SOLIDWORKS Simulation porque tuvo una falla estructural en un diseño reciente."></textarea>
      <button class="btn" id="btnIniciar">Iniciar llamada</button>
    </div>`);
    const sel = $("#selProducto", card);
    lineas.forEach(l=>{
      const og = el('<optgroup label="'+escapeHtml(l)+'"></optgroup>');
      productos.filter(p=>p.linea===l).forEach(p=>{
        og.appendChild(el('<option value="'+escapeHtml(p.nombre)+'">'+escapeHtml(p.nombre)+'</option>'));
      });
      sel.appendChild(og);
    });
    $("#btnIniciar", card).onclick = ()=>{
      const producto = sel.value;
      const nivel = parseInt($("#selNivel",card).value,10);
      const escenario = $("#txtEscenario",card).value.trim() || ("Prospecto interesado en "+producto+", generado libremente por la IA según el nivel elegido.");
      iniciarLlamada({producto, nivel, escenario});
    };
    wrap.appendChild(card);
    return wrap;
  }

  wrap.appendChild(el(`<div class="card">
    <h3>${escapeHtml(call.producto)} · Nivel ${call.nivel} <span class="small">(${escapeHtml(call.escenario)})</span></h3>
  </div>`));

  if(call.resultado){
    wrap.appendChild(renderResultadoEvaluacion(call.resultado));
    const btnNueva = el('<button class="btn secondary" style="margin-top:10px;">Nueva llamada</button>');
    btnNueva.onclick = ()=>{ STATE.call = {active:false, mensajes:[]}; render(); };
    wrap.appendChild(btnNueva);
    return wrap;
  }

  const callCard = el('<div class="card"></div>');
  const stage = el('<div class="call-stage"></div>');
  const avatar = el('<div class="call-avatar">☎️</div>');
  if(call.procesando) avatar.classList.add("hablando");
  stage.appendChild(avatar);
  stage.appendChild(el('<div class="call-status">'+(call.procesando?"El prospecto está respondiendo…":(call.escuchando?"Escuchando…":"Presiona el micrófono y habla"))+'</div>'));
  const micBtn = el('<button class="mic-btn">🎙️</button>');
  if(call.escuchando) micBtn.classList.add("on");
  micBtn.disabled = call.procesando;
  micBtn.onclick = toggleMicrofono;
  stage.appendChild(micBtn);
  stage.appendChild(el('<div class="live-caption">'+escapeHtml(call.caption||"")+'</div>'));
  callCard.appendChild(stage);

  const chatBox = el('<div id="chatBox"></div>');
  if(call.mensajes.length===0){
    chatBox.appendChild(el('<div class="msg sistema">Llamada iniciada. Presiona el micrófono y empieza a hablar como vendedor/a. Para terminar, usa "Finalizar llamada y evaluar".</div>'));
  }
  call.mensajes.forEach(m=>{
    chatBox.appendChild(el('<div class="msg '+(m.rol==="vendedor"?"vendedor":(m.rol==="sistema"?"sistema":"prospecto"))+'">'+escapeHtml(m.texto)+'</div>'));
  });
  callCard.appendChild(chatBox);

  // Entrada de texto como alternativa/respaldo al micrófono
  const inputRow = el('<div style="display:flex;gap:8px;"><input id="txtVendedor" placeholder="O escribe aquí si no quieres usar el micrófono..." style="margin-bottom:0;"><button class="btn secondary" id="btnEnviar">Enviar</button></div>');
  callCard.appendChild(inputRow);

  const footRow = el('<div style="margin-top:10px;display:flex;justify-content:flex-end;"><button class="btn secondary" id="btnFinalizar">Finalizar llamada y evaluar</button></div>');
  callCard.appendChild(footRow);

  wrap.appendChild(callCard);

  const send = ()=>{
    const inp = $("#txtVendedor", callCard);
    const v = inp.value.trim();
    inp.value="";
    if(v) manejarTranscripcionFinal(v);
  };
  $("#btnEnviar", callCard).onclick = send;
  $("#txtVendedor", callCard).addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); send(); }});

  const btnFin = $("#btnFinalizar", callCard);
  btnFin.disabled = call.evaluando || call.mensajes.filter(m=>m.rol==="vendedor").length===0;
  btnFin.textContent = call.evaluando ? "Evaluando..." : "Finalizar llamada y evaluar";
  btnFin.onclick = finalizarYEvaluar;

  return wrap;
}

function renderResultadoEvaluacion(data){
  const c = el('<div class="card"></div>');
  c.appendChild(el('<div class="score-hero">'+Math.round(data.puntuacionTotal||0)+'<span> / 100</span></div>'));
  c.appendChild(el('<h3 style="margin-top:14px;">Puntuación por ARC</h3>'));
  ARC_KEYS.forEach(k=>{
    const a = (data.arc && data.arc[k]) || {puntuacion:0,comentario:""};
    const row = el('<div class="arcbar-row"><div class="arcbar-label">'+ARC_LABELS[k]+'</div><div class="arcbar-track"><div class="arcbar-fill" style="width:'+((a.puntuacion||0)*10)+'%"></div></div><div class="arcbar-val">'+(a.puntuacion||0)+'/10</div></div>');
    c.appendChild(row);
    if(a.comentario) c.appendChild(el('<p class="small" style="margin:-2px 0 10px 0;">'+escapeHtml(a.comentario)+'</p>'));
  });
  if(data.fortalezas && data.fortalezas.length){
    c.appendChild(el('<h3>Fortalezas</h3><ul>'+data.fortalezas.map(f=>'<li>'+escapeHtml(f)+'</li>').join("")+'</ul>'));
  }
  if(data.oportunidades && data.oportunidades.length){
    c.appendChild(el('<h3>Dónde estás dejando dinero sobre la mesa</h3><ul>'+data.oportunidades.map(f=>'<li>'+escapeHtml(f)+'</li>').join("")+'</ul>'));
  }
  if(data.areaMejora){
    c.appendChild(el('<div class="card" style="background:#fff8e6;border-color:var(--naranja);"><b>Principal área de mejora:</b> '+escapeHtml(data.areaMejora)+'</div>'));
  }
  return c;
}

function renderTablero(){
  const wrap = el('<div></div>');
  const n = STATE.misResultados.length;
  const avg = n ? Math.round(STATE.misResultados.reduce((a,b)=>a+(b.puntuacionTotal||0),0)/n) : 0;
  const ultimo = n ? STATE.misResultados[0] : null;

  wrap.appendChild(el(`<div class="grid cols-3">
    <div class="card"><h3>Llamadas</h3><div class="score-hero">${n}</div></div>
    <div class="card"><h3>Promedio</h3><div class="score-hero">${avg}<span>/100</span></div></div>
    <div class="card"><h3>Última puntuación</h3><div class="score-hero">${ultimo?Math.round(ultimo.puntuacionTotal||0):"—"}${ultimo?'<span>/100</span>':""}</div></div>
  </div>`));

  if(n>0){
    const prom = {}; ARC_KEYS.forEach(k=>prom[k]=0);
    STATE.misResultados.forEach(r=>{ ARC_KEYS.forEach(k=>{ prom[k]+= (r.arc && r.arc[k] && r.arc[k].puntuacion)||0; }); });
    ARC_KEYS.forEach(k=>prom[k]=Math.round((prom[k]/n)*10)/10);
    const c = el('<div class="card"><h3>Promedio por ARC</h3></div>');
    ARC_KEYS.forEach(k=>{
      c.appendChild(el('<div class="arcbar-row"><div class="arcbar-label">'+ARC_LABELS[k]+'</div><div class="arcbar-track"><div class="arcbar-fill" style="width:'+(prom[k]*10)+'%"></div></div><div class="arcbar-val">'+prom[k]+'/10</div></div>'));
    });
    wrap.appendChild(c);

    const hist = el('<div class="card"><h3>Historial</h3><table><thead><tr><th>Fecha</th><th>Producto</th><th>Nivel</th><th>Puntuación</th></tr></thead><tbody></tbody></table></div>');
    const tbody = $("tbody",hist);
    STATE.misResultados.forEach(r=>{
      tbody.appendChild(el('<tr><td>'+new Date(r.fecha).toLocaleDateString("es-CO")+'</td><td>'+escapeHtml(r.producto||"")+'</td><td>'+(r.nivel||"")+'</td><td><b>'+Math.round(r.puntuacionTotal||0)+'</b>/100</td></tr>'));
    });
    wrap.appendChild(hist);
  } else {
    wrap.appendChild(el('<div class="card"><div class="empty">Aún no tienes llamadas registradas. Ve a la pestaña "Simular llamada" para practicar tu primera venta.</div></div>'));
  }
  return wrap;
}

function renderCatalogo(){
  const wrap = el('<div class="card"></div>');
  wrap.appendChild(el('<h2>Catálogo IAC (iaclatam.com)</h2><p class="small">Úsalo para elegir sobre qué producto o línea practicar.</p>'));
  const lineas = [...new Set(STATE.productos.map(p=>p.linea))];
  lineas.forEach(l=>{
    wrap.appendChild(el('<h3 style="margin-top:16px;">'+escapeHtml(l)+'</h3>'));
    const tbl = el('<table><tbody></tbody></table>');
    STATE.productos.filter(p=>p.linea===l).forEach(p=>{
      $("tbody",tbl).appendChild(el('<tr><td style="width:220px;"><b>'+escapeHtml(p.nombre)+'</b></td><td class="small">'+escapeHtml(p.descripcion||"")+'</td></tr>'));
    });
    wrap.appendChild(tbl);
  });
  return wrap;
}

function renderUso(){
  const wrap = el('<div></div>');
  const u = STATE.uso;

  if(STATE.loadingUso && !u){
    wrap.appendChild(el('<div class="card"><div class="empty">Cargando uso…</div></div>'));
    return wrap;
  }
  if(!u){
    wrap.appendChild(el('<div class="card"><div class="empty">No se pudo cargar el uso. Intenta de nuevo.</div></div>'));
    return wrap;
  }

  const ia = u.ia, host = u.hosting;
  const limites = ia.limites;

  wrap.appendChild(el(`<div class="card">
    <h2>Uso gratuito de la IA (${escapeHtml(ia.proveedor)})</h2>
    <p class="small">Modelo: <b>${escapeHtml(ia.modelo)}</b> · ${ia.esGratis ? "Capa 100% gratis, sin tarjeta de crédito." : "Este proveedor es de pago (no tiene límite gratis fijo)."}</p>
  </div>`));

  if(ia.esGratis && limites){
    const pctSolic = Math.min(100, Math.round((ia.solicitudesHoy / limites.solicitudesPorDia) * 100));
    const pctTokens = Math.min(100, Math.round((ia.tokensHoy / limites.tokensPorDia) * 100));
    const c = el('<div class="card"><h3>Hoy</h3></div>');
    c.appendChild(el(`<div class="arcbar-row">
      <div class="arcbar-label">Solicitudes de IA</div>
      <div class="arcbar-track"><div class="arcbar-fill" style="width:${pctSolic}%"></div></div>
      <div class="arcbar-val">${ia.solicitudesHoy} / ${limites.solicitudesPorDia}</div>
    </div>`));
    c.appendChild(el(`<div class="arcbar-row">
      <div class="arcbar-label">Tokens procesados</div>
      <div class="arcbar-track"><div class="arcbar-fill" style="width:${pctTokens}%"></div></div>
      <div class="arcbar-val">${ia.tokensHoy.toLocaleString("es-CO")} / ${limites.tokensPorDia.toLocaleString("es-CO")}</div>
    </div>`));
    c.appendChild(el(`<p class="small" style="margin-top:10px;">Estos contadores se reinician solos cada día. También hay un límite de ${limites.solicitudesPorMinuto} solicitudes y ${limites.tokensPorMinuto.toLocaleString("es-CO")} tokens por minuto (no se muestra aquí porque se resetea cada 60 segundos).</p>`));
    wrap.appendChild(c);
  }

  wrap.appendChild(el(`<div class="card">
    <h3>Hosting (${escapeHtml(host.proveedor)}, plan ${escapeHtml(host.plan)})</h3>
    <div class="grid cols-3" style="margin-top:10px;">
      <div><b>${host.ramMB} MB</b><div class="small">RAM</div></div>
      <div><b>${host.cpu}</b><div class="small">CPU</div></div>
      <div><b>${host.horasGratisPorMes}h</b><div class="small">gratis / mes</div></div>
    </div>
    <p class="small" style="margin-top:10px;">El servicio se "duerme" tras ${host.seDuermeTrasMinutos} minutos sin uso, y la siguiente visita puede tardar hasta un minuto en responder mientras despierta. Esto no tiene costo, es normal del plan gratis.</p>
  </div>`));

  return wrap;
}

function renderEquipo(){
  const wrap = el('<div></div>');
  wrap.appendChild(el('<div class="card"><h2>Tablero del equipo comercial</h2><p class="small">Ranking por puntuación promedio en el Simulador 7 ARC.</p></div>'));
  if(STATE.loadingTeam){
    wrap.appendChild(el('<div class="card"><div class="empty">Cargando datos del equipo…</div></div>'));
    return wrap;
  }
  const card = el('<div class="card"></div>');
  if(!STATE.equipoResultados.length){
    card.appendChild(el('<div class="empty">Todavía no hay datos del equipo, o nadie ha registrado su nombre aún.</div>'));
  } else {
    STATE.equipoResultados.forEach((p,i)=>{
      card.appendChild(el('<div class="rank-row"><div style="display:flex;align-items:center;"><div class="rank-pos">#'+(i+1)+'</div><div><b>'+escapeHtml(p.nombre)+'</b><div class="small">'+p.n+' llamada(s)</div></div></div><div class="score-hero" style="font-size:22px;">'+p.avg+'<span style="font-size:13px;">/100</span></div></div>'));
    });
  }
  wrap.appendChild(card);
  return wrap;
}

async function cargarRosterAdmin(comCard){
  const list = $("#rosterList", comCard);
  try{
    const roster = await api("/api/roster");
    list.innerHTML = "";
    if(!roster.length){
      list.appendChild(el('<p class="small">(Aún no hay comerciales registrados)</p>'));
    } else {
      roster.forEach(u=>{
        const row = el('<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--gris-clr);"><span><b>'+escapeHtml(u.nombre||"(sin nombre)")+'</b>'+(u.email?' <span class="small">· '+escapeHtml(u.email)+'</span>':' <span class="small">· sin correo</span>')+'</span><button class="btn ghost" style="padding:4px 10px;">Quitar</button></div>');
        $("button",row).onclick = async ()=>{
          try{ await api("/api/admin/roster/"+u.id, {method:"DELETE"}); cargarRosterAdmin(comCard); }
          catch(e){ showToast("No se pudo quitar: "+e.message, true); }
        };
        list.appendChild(row);
      });
    }
  }catch(e){ list.innerHTML = '<p class="small">No se pudo cargar la lista.</p>'; }
}

function renderAdmin(){
  const wrap = el('<div></div>');

  if(!STATE.isAdmin){
    const loginCard = el(`<div class="card">
      <h2>Acceso de administrador</h2>
      <p class="small">Ingresa la contraseña de administrador que te compartió quien configuró esta app.</p>
      <input id="pwAdmin" type="password" placeholder="Contraseña de administrador">
      <button class="btn" id="btnLoginAdmin">Entrar</button>
    </div>`);
    $("#btnLoginAdmin", loginCard).onclick = ()=>{
      const v = $("#pwAdmin", loginCard).value;
      if(v) loginAdmin(v);
    };
    wrap.appendChild(loginCard);
    return wrap;
  }

  wrap.appendChild(el(`<div class="card">
    <h2>Sesión de administrador activa</h2>
    <button class="btn ghost" id="btnLogoutAdmin">Cerrar sesión de admin en este navegador</button>
  </div>`));
  $("#btnLogoutAdmin", wrap).onclick = logoutAdmin;

  const comCard = el(`<div class="card">
    <h2>Comerciales</h2>
    <p class="small">Agrega aquí a cada comercial con su correo para que, cuando obtenga una excelente puntuación en una llamada, le llegue automáticamente un correo de felicitación (si el servidor tiene configurado el envío de correos — ver <code>.env</code>, variables <code>SMTP_*</code>).</p>
    <div id="rosterList"><p class="small">Cargando...</p></div>
    <div class="grid cols-2" style="margin-top:10px;">
      <div><input id="nuevoComNombre" placeholder="Nombre completo" style="margin-bottom:0;"></div>
      <div><input id="nuevoComEmail" placeholder="correo@iaclatam.com" style="margin-bottom:0;"></div>
    </div>
    <button class="btn" id="btnAddCom" style="margin-top:10px;">Agregar comercial</button>
  </div>`);
  wrap.appendChild(comCard);
  cargarRosterAdmin(comCard);
  $("#btnAddCom", comCard).onclick = async ()=>{
    const nombre = $("#nuevoComNombre", comCard).value.trim();
    const email = $("#nuevoComEmail", comCard).value.trim();
    if(!nombre) return showToast("Escribe al menos el nombre.", true);
    try{
      await api("/api/admin/roster", {method:"POST", body: JSON.stringify({nombre, email})});
      showToast("Comercial agregado.");
      $("#nuevoComNombre", comCard).value = "";
      $("#nuevoComEmail", comCard).value = "";
      cargarRosterAdmin(comCard);
    }catch(e){ showToast("No se pudo agregar: "+e.message, true); }
  };

  const catCard = el(`<div class="card">
    <h2>Agregar producto al catálogo</h2>
    <div class="grid cols-2">
      <div><label>Línea de negocio</label><input id="nuevaLinea" placeholder="Ej: Manufactura"></div>
      <div><label>Nombre del producto</label><input id="nuevoNombre" placeholder="Ej: SOLIDWORKS CAM"></div>
    </div>
    <label>Descripción</label>
    <textarea id="nuevaDesc" rows="2"></textarea>
    <button class="btn" id="btnAddProd">Agregar producto</button>
  </div>`);
  $("#btnAddProd", catCard).onclick = async ()=>{
    const linea = $("#nuevaLinea",catCard).value.trim();
    const nombre = $("#nuevoNombre",catCard).value.trim();
    const descripcion = $("#nuevaDesc",catCard).value.trim();
    if(!linea || !nombre) return showToast("Línea y nombre son obligatorios.", true);
    try{
      await api("/api/productos", {method:"POST", body: JSON.stringify({linea,nombre,descripcion})});
      showToast("Producto agregado.");
      STATE.productos = await api("/api/productos");
      render();
    }catch(e){ showToast("No se pudo guardar: "+e.message, true); }
  };
  wrap.appendChild(catCard);

  wrap.appendChild(el(`<div class="card">
    <h3>Gestión de administradores</h3>
    <p class="small">En esta versión, "ser admin" significa conocer la contraseña de administrador (una sola, compartida). Para dar acceso a alguien más, entrégale la misma contraseña configurada en el archivo <code>.env</code> del servidor (variable <code>ADMIN_PASSWORD</code>). No hay una lista de correos individual en esta versión simple.</p>
  </div>`));

  return wrap;
}

boot();
