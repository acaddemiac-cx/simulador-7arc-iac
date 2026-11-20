// Envío de correos de felicitación cuando un comercial obtiene una buena
// puntuación en el Simulador 7 ARC. Usa SMTP genérico (nodemailer), así que
// funciona con Microsoft 365 / Outlook, Gmail, SendGrid, Amazon SES, etc. —
// lo que Kevin ya tenga disponible en IAC.
//
// Si no se configuran las variables SMTP_*, esta función simplemente no
// hace nada (y lo avisa una sola vez en consola) — el resto de la app sigue
// funcionando con normalidad.

const nodemailer = require("nodemailer");

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

const NOTIFY_THRESHOLD = parseInt(process.env.NOTIFY_THRESHOLD || "85", 10);
const ADMIN_NOTIFY_EMAILS = (process.env.ADMIN_NOTIFY_EMAILS || "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

const configurado = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
let avisoHecho = false;

let transporter = null;
if (configurado) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE, // true para puerto 465, false para 587/25 (STARTTLS)
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function plantillaFelicitacion({ nombre, puntuacionTotal, producto, areaMejora }) {
  const asunto = `🎉 ¡Excelente llamada, ${nombre}! (${Math.round(puntuacionTotal)}/100 en el Simulador 7 ARC)`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
      <div style="background:#333333;padding:18px 24px;">
        <span style="color:#F8B126;font-size:20px;font-weight:bold;">IAC</span>
        <span style="color:#fff;font-size:16px;margin-left:10px;">Simulador de Ventas 7 ARC</span>
      </div>
      <div style="padding:24px;color:#333333;">
        <h2 style="color:#333333;">¡Felicitaciones, ${escapeHtml(nombre)}! 🎉</h2>
        <p>Acabas de completar una simulación de llamada sobre <b>${escapeHtml(producto || "")}</b> con una puntuación de:</p>
        <p style="font-size:42px;font-weight:bold;color:#F8B126;margin:10px 0;">${Math.round(puntuacionTotal)}<span style="font-size:18px;color:#686868;"> / 100</span></p>
        <p>Es un resultado destacado dentro de la metodología 7 ARC. ¡Sigue así!</p>
        ${areaMejora ? `<p style="background:#fff8e6;border:1px solid #F8B126;border-radius:8px;padding:10px 14px;font-size:14px;"><b>Para seguir subiendo el nivel:</b> ${escapeHtml(areaMejora)}</p>` : ""}
        <p style="font-size:12px;color:#686868;margin-top:24px;">Este correo fue generado automáticamente por el Simulador de Ventas 7 ARC de IAC.</p>
      </div>
    </div>`;
  const text = `¡Felicitaciones, ${nombre}! Obtuviste ${Math.round(puntuacionTotal)}/100 en tu llamada sobre ${producto || ""} en el Simulador 7 ARC.${areaMejora ? " Para seguir mejorando: " + areaMejora : ""}`;
  return { asunto, html, text };
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Envía (si aplica) el correo de felicitación por una buena puntuación.
 * No lanza errores hacia quien la llama: solo los registra en consola, para
 * no afectar la respuesta del simulador si el correo falla.
 */
async function notificarSiAplica({ nombre, email, puntuacionTotal, producto, areaMejora }) {
  if (!configurado) {
    if (!avisoHecho) {
      console.warn(
        "[mailer] SMTP no configurado (SMTP_HOST/SMTP_USER/SMTP_PASS) — no se enviarán correos de felicitación."
      );
      avisoHecho = true;
    }
    return { enviado: false, razon: "smtp_no_configurado" };
  }
  if ((puntuacionTotal || 0) < NOTIFY_THRESHOLD) {
    return { enviado: false, razon: "bajo_umbral" };
  }
  if (!email) {
    return { enviado: false, razon: "sin_correo_del_comercial" };
  }

  const { asunto, html, text } = plantillaFelicitacion({ nombre, puntuacionTotal, producto, areaMejora });
  const destinatarios = [email, ...ADMIN_NOTIFY_EMAILS].filter(Boolean);

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: destinatarios.join(","),
      subject: asunto,
      text,
      html,
    });
    return { enviado: true };
  } catch (e) {
    console.error("[mailer] Error enviando correo de felicitación:", e.message);
    return { enviado: false, razon: "error_envio", detalle: e.message };
  }
}

module.exports = { notificarSiAplica, NOTIFY_THRESHOLD, configurado };
