require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const store = require("./store");
const ai = require("./ai");
const mailer = require("./mailer");
const { promptTurno, promptEvaluacion } = require("./prompts");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "1mb" }));

// ---------- Auth muy simple ----------
// No hay un sistema de login completo (correo/contraseña por persona): cada
// vendedor se identifica solo con su nombre (se le asigna un id aleatorio que
// el navegador recuerda). El acceso de administrador es una contraseña
// compartida (ADMIN_PASSWORD) que Kevin entrega a Nataly, Carlos, etc.
// Para una herramienta interna de entrenamiento esto es razonable; si más
// adelante quieres cuentas reales por persona, esto es lo primero a cambiar.

function requiereAdmin(req, res, next) {
  const token = req.headers["x-admin-password"] || "";
  if (!ADMIN_PASSWORD || token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

// ---------- Usuarios ----------

app.post("/api/me", (req, res) => {
  let { userId, nombre, email } = req.body || {};
  if (!userId) userId = uuidv4();
  const existente = store.getUsuario(userId);
  const datos = {
    nombre: nombre || (existente && existente.nombre) || "",
    email: (email !== undefined ? email : (existente && existente.email) || "") || "",
  };
  const usuario = store.upsertUsuario(userId, datos);
  res.json(usuario);
});

app.get("/api/roster", requiereAdmin, (req, res) => {
  res.json(store.listUsuarios());
});

// Admin: agregar o editar manualmente un comercial (por ejemplo para
// precargar su correo antes de que entre por primera vez al simulador).
app.post("/api/admin/roster", requiereAdmin, (req, res) => {
  let { userId, nombre, email } = req.body || {};
  if (!nombre) return res.status(400).json({ error: "El nombre es obligatorio" });
  if (!userId) userId = uuidv4();
  const existente = store.getUsuario(userId);
  const usuario = store.upsertUsuario(userId, {
    nombre,
    email: (email !== undefined ? email : (existente && existente.email) || "") || "",
  });
  res.json(usuario);
});

app.delete("/api/admin/roster/:id", requiereAdmin, (req, res) => {
  store.deleteUsuario(req.params.id);
  res.json({ ok: true });
});

// ---------- Admin: verificación y lista ----------

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (ADMIN_PASSWORD && password === ADMIN_PASSWORD) {
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false });
});

// ---------- Catálogo ----------

app.get("/api/productos", (req, res) => {
  res.json(store.listProductos());
});

app.post("/api/productos", requiereAdmin, (req, res) => {
  const { linea, nombre, descripcion } = req.body || {};
  if (!linea || !nombre) return res.status(400).json({ error: "linea y nombre son obligatorios" });
  const nuevo = store.addProducto({ linea, nombre, descripcion: descripcion || "" });
  res.json(nuevo);
});

app.delete("/api/productos/:id", requiereAdmin, (req, res) => {
  store.deleteProducto(req.params.id);
  res.json({ ok: true });
});

// ---------- Simulador (llamada) ----------

app.post("/api/simular/turno", async (req, res) => {
  try {
    const { nivel, escenario, producto, transcripcion } = req.body || {};
    if (!producto || !transcripcion) return res.status(400).json({ error: "Faltan datos" });
    const mensajes = promptTurno({ nivel: nivel || 2, escenario: escenario || "", producto, transcripcion });
    const texto = await ai.generarTexto(mensajes, { maxTokens: 220 });
    res.json({ texto });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error generando la respuesta del prospecto" });
  }
});

app.post("/api/simular/evaluar", async (req, res) => {
  try {
    const { userId, nivel, escenario, producto, transcripcion } = req.body || {};
    if (!userId || !producto || !transcripcion) return res.status(400).json({ error: "Faltan datos" });
    const mensajes = promptEvaluacion({ nivel: nivel || 2, producto, transcripcion });
    const data = await ai.generarJSON(mensajes, { maxTokens: 1600 });

    const registro = store.addSimulacion(userId, {
      fecha: Date.now(),
      nivel: nivel || 2,
      producto,
      escenario: escenario || "",
      puntuacionTotal: data.puntuacionTotal || 0,
      arc: data.arc || {},
      areaMejora: data.areaMejora || "",
    });

    res.json({ evaluacion: data, registro });

    // Felicitación automática por correo (no bloquea la respuesta al vendedor).
    const usuario = store.getUsuario(userId);
    if (usuario) {
      mailer
        .notificarSiAplica({
          nombre: usuario.nombre || "equipo comercial",
          email: usuario.email || "",
          puntuacionTotal: data.puntuacionTotal || 0,
          producto,
          areaMejora: data.areaMejora || "",
        })
        .catch((e) => console.error("[mailer] fallo inesperado:", e));
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error generando la evaluación" });
  }
});

app.get("/api/simulaciones/:userId", (req, res) => {
  res.json(store.listSimulacionesDe(req.params.userId));
});

app.get("/api/equipo", requiereAdmin, (req, res) => {
  const usuarios = store.listUsuarios();
  const todas = store.listSimulacionesTodas();
  const out = usuarios.map((u) => {
    const sims = todas[u.id] || [];
    const n = sims.length;
    const avg = n ? Math.round(sims.reduce((a, b) => a + (b.puntuacionTotal || 0), 0) / n) : 0;
    return { id: u.id, nombre: u.nombre || "(sin nombre)", n, avg, ultimo: n ? sims[0] : null };
  });
  out.sort((a, b) => b.avg - a.avg);
  res.json(out);
});

// ---------- Frontend estático ----------
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_DIR));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "No encontrado" });
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Simulador 7 ARC backend escuchando en http://localhost:${PORT}`);
  console.log(`Proveedor de IA: ${ai.PROVIDER} · modelo: ${ai.modelo}`);
  if (!ADMIN_PASSWORD) console.warn("ADVERTENCIA: ADMIN_PASSWORD no está configurada en .env — nadie podrá entrar como admin.");
});
