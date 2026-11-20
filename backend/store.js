// Almacenamiento simple en archivos JSON. Suficiente para un equipo comercial
// (decenas de personas, cientos de simulaciones). Si el equipo crece mucho o
// necesitas alta concurrencia real, migra esto a una base de datos (Postgres,
// MySQL, SQLite con mejor soporte de concurrencia, etc.) - la forma de los
// datos no cambiaría, solo cómo se guardan.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function filePara(nombre) {
  return path.join(DATA_DIR, nombre + ".json");
}

function leer(nombre, porDefecto) {
  const f = filePara(nombre);
  if (!fs.existsSync(f)) return porDefecto;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    console.warn("No se pudo leer " + f, e);
    return porDefecto;
  }
}

function escribir(nombre, data) {
  const f = filePara(nombre);
  // Escritura atómica simple: escribe a un temporal y renombra.
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, f);
}

// ---- Colecciones ----
// usuarios.json      { [id]: { id, nombre, creadoEn } }
// productos.json     [ { id, linea, nombre, descripcion } ]
// simulaciones.json  { [userId]: [ { id, fecha, nivel, producto, escenario, puntuacionTotal, arc, areaMejora } ] }

const CATALOGO_SEED = require("./catalogo-seed.json");

function init() {
  if (!fs.existsSync(filePara("usuarios"))) escribir("usuarios", {});
  if (!fs.existsSync(filePara("productos"))) escribir("productos", CATALOGO_SEED);
  if (!fs.existsSync(filePara("simulaciones"))) escribir("simulaciones", {});
}
init();

module.exports = {
  // usuarios
  getUsuario(id) {
    const usuarios = leer("usuarios", {});
    return usuarios[id] || null;
  },
  upsertUsuario(id, datos) {
    const usuarios = leer("usuarios", {});
    usuarios[id] = { ...(usuarios[id] || { creadoEn: Date.now() }), ...datos, id };
    escribir("usuarios", usuarios);
    return usuarios[id];
  },
  listUsuarios() {
    const usuarios = leer("usuarios", {});
    return Object.values(usuarios);
  },
  deleteUsuario(id) {
    const usuarios = leer("usuarios", {});
    delete usuarios[id];
    escribir("usuarios", usuarios);
  },

  // productos
  listProductos() {
    return leer("productos", []);
  },
  addProducto(producto) {
    const productos = leer("productos", []);
    const nuevo = { id: "p" + Date.now() + Math.floor(Math.random() * 1000), ...producto };
    productos.push(nuevo);
    escribir("productos", productos);
    return nuevo;
  },
  deleteProducto(id) {
    const productos = leer("productos", []).filter((p) => p.id !== id);
    escribir("productos", productos);
  },

  // simulaciones
  addSimulacion(userId, registro) {
    const todas = leer("simulaciones", {});
    if (!todas[userId]) todas[userId] = [];
    const conId = { id: "sim" + Date.now() + Math.floor(Math.random() * 1000), ...registro };
    todas[userId].unshift(conId);
    // conserva como máximo 200 por usuario para no crecer sin límite
    todas[userId] = todas[userId].slice(0, 200);
    escribir("simulaciones", todas);
    return conId;
  },
  listSimulacionesDe(userId) {
    const todas = leer("simulaciones", {});
    return todas[userId] || [];
  },
  listSimulacionesTodas() {
    return leer("simulaciones", {});
  },

  // uso de IA (para el panel "Uso gratuito") — contador simple que se
  // reinicia solo cuando cambia el día (fecha del servidor).
  registrarUsoIA(tokens) {
    const hoy = new Date().toISOString().slice(0, 10);
    let uso = leer("uso", { dia: hoy, solicitudes: 0, tokens: 0 });
    if (uso.dia !== hoy) uso = { dia: hoy, solicitudes: 0, tokens: 0 };
    uso.solicitudes += 1;
    uso.tokens += tokens || 0;
    escribir("uso", uso);
    return uso;
  },
  obtenerUsoIA() {
    const hoy = new Date().toISOString().slice(0, 10);
    const uso = leer("uso", { dia: hoy, solicitudes: 0, tokens: 0 });
    if (uso.dia !== hoy) return { dia: hoy, solicitudes: 0, tokens: 0 };
    return uso;
  },
};
