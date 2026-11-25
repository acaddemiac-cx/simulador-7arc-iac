// Capa de IA. Por defecto usa Groq (https://console.groq.com), que tiene una
// capa gratuita real (sin tarjeta de crédito, sin cobro). También soporta
// OpenAI y Azure OpenAI si en algún momento se prefiere cambiar:
//   AI_PROVIDER=groq   (por defecto) -> usa GROQ_API_KEY
//   AI_PROVIDER=openai                -> usa OPENAI_API_KEY (de pago)
//   AI_PROVIDER=azure                 -> usa AZURE_OPENAI_*  (de pago)
// El resto del backend (server.js) no necesita cambiar: siempre llama a
// generarTexto() / generarJSON() de este archivo.

const OpenAI = require("openai");
const store = require("./store");

const PROVIDER = (process.env.AI_PROVIDER || "groq").toLowerCase();

let client;
let modelo;

if (PROVIDER === "azure") {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  modelo = process.env.AZURE_OPENAI_DEPLOYMENT;
  if (!endpoint || !apiKey || !modelo) {
    console.error("Faltan variables de Azure OpenAI (AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY / AZURE_OPENAI_DEPLOYMENT) en .env");
  }
  client = new OpenAI({
    apiKey,
    baseURL: `${endpoint}/openai/deployments/${modelo}`,
    defaultQuery: { "api-version": "2024-06-01" },
    defaultHeaders: { "api-key": apiKey },
  });
} else if (PROVIDER === "openai") {
  const apiKey = process.env.OPENAI_API_KEY;
  modelo = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) {
    console.error("Falta OPENAI_API_KEY en .env");
  }
  client = new OpenAI({ apiKey });
} else {
  // Groq: API gratuita, compatible con el SDK de OpenAI (mismo formato).
  // Nota: llama-3.3-70b-versatile fue descontinuado por Groq el 16/08/2026.
  // openai/gpt-oss-120b es el reemplazo gratuito recomendado por Groq mismo.
  const apiKey = process.env.GROQ_API_KEY;
  modelo = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  if (!apiKey) {
    console.error("Falta GROQ_API_KEY en .env (consíguela gratis en https://console.groq.com/keys)");
  }
  client = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
}

async function generarTexto(mensajes, opts = {}) {
  const resp = await client.chat.completions.create({
    model: modelo,
    messages: mensajes,
    temperature: opts.temperature ?? 0.8,
    max_tokens: opts.maxTokens ?? 350,
  });
  store.registrarUsoIA(resp.usage && resp.usage.total_tokens);
  return resp.choices[0].message.content.trim();
}

async function generarJSON(mensajes, opts = {}) {
  const resp = await client.chat.completions.create({
    model: modelo,
    messages: mensajes,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 1500,
    response_format: { type: "json_object" },
  });
  store.registrarUsoIA(resp.usage && resp.usage.total_tokens);
  const texto = resp.choices[0].message.content;
  try {
    return JSON.parse(texto);
  } catch (e) {
    // Si el modelo no soporta response_format json_object (poco probable con
    // gpt-4o-mini), intenta extraer el primer bloque {...} del texto.
    const match = texto.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("La IA no devolvió un JSON válido: " + texto.slice(0, 200));
  }
}

module.exports = {
  generarTexto,
  generarJSON,
  PROVIDER,
  modelo,
  LIMITES:
    PROVIDER === "groq"
      ? { solicitudesPorDia: 1000, solicitudesPorMinuto: 30, tokensPorDia: 200000, tokensPorMinuto: 8000 }
      : null, // OpenAI/Azure son de pago: no aplican límites gratis fijos
};
