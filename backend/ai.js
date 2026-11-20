// Capa de IA. Por defecto llama a la API de OpenAI (platform.openai.com).
// Para usar Azure OpenAI en su lugar: pon AI_PROVIDER=azure en .env y completa
// AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY / AZURE_OPENAI_DEPLOYMENT.
// El resto del backend (server.js) no necesita cambiar: siempre llama a
// generarTexto() / generarJSON() de este archivo.

const OpenAI = require("openai");

const PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();

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
} else {
  const apiKey = process.env.OPENAI_API_KEY;
  modelo = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) {
    console.error("Falta OPENAI_API_KEY en .env");
  }
  client = new OpenAI({ apiKey });
}

async function generarTexto(mensajes, opts = {}) {
  const resp = await client.chat.completions.create({
    model: modelo,
    messages: mensajes,
    temperature: opts.temperature ?? 0.8,
    max_tokens: opts.maxTokens ?? 350,
  });
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

module.exports = { generarTexto, generarJSON, PROVIDER, modelo };
