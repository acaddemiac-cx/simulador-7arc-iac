# Simulador de Ventas 7 ARC — IAC (versión independiente)

App de entrenamiento comercial para IAC: simula una LLAMADA de ventas con un
prospecto generado por IA (usando reconocimiento y síntesis de voz del
navegador), evalúa el desempeño con la metodología de las 7 ARC, y lleva un
tablero de resultados por persona y por equipo.

**No depende de Claude ni de créditos de Claude, y el proveedor de IA por
defecto (Groq) es 100% gratis** — sin tarjeta de crédito, sin cobro. Es una
app web normal (frontend estático + backend Node.js) que tú controlas y
despliegas donde quieras.

## Estructura

```
sim7arc-standalone/
  backend/           Servidor Node.js (Express) — API + sirve el frontend
    server.js
    ai.js            Capa que llama a Groq (gratis), OpenAI o Azure OpenAI
    prompts.js       Prompts del Simulador 7 ARC (adaptados del PDF original)
    store.js         Persistencia simple en archivos JSON (backend/data/)
    catalogo-seed.json
    package.json
    .env.example     Copia a ".env" y completa tus valores
  frontend/          Página web (sin build, HTML/CSS/JS plano)
    index.html
    app.js
    styles.css
    logo.png         ← AGREGA AQUÍ el logo real de IAC (ver abajo)
```

## Puesta en marcha local (para probar)

```bash
cd backend
npm install
cp .env.example .env
# Edita .env: pon tu GROQ_API_KEY (gratis, console.groq.com) y una ADMIN_PASSWORD segura
npm start
```

Abre `http://localhost:3000` — el mismo servidor sirve el frontend y la API.

## Logo de IAC

No pude descargar el logo real de iaclatam.com desde este entorno (el acceso
a internet aquí está restringido a un listado específico de sitios). Agrega
tú el archivo del logo como:

```
frontend/logo.png
```

La app ya está codificada para mostrarlo automáticamente ahí; si el archivo
no existe, muestra un recuadro "IAC" en naranja como respaldo (para que la
app funcione igual mientras tanto). Los colores corporativos (naranja
`#F8B126`, gris oscuro `#333333`, gris `#686868`, gris claro `#E3E3E3`) ya
están aplicados en toda la interfaz.

## Cómo practicar una llamada

1. Pestaña **Simular llamada** → elige producto/línea, nivel y describe el
   escenario.
2. Presiona el micrófono 🎙️ y habla como lo harías en una llamada real. El
   navegador transcribe tu voz, la IA responde como el prospecto y
   **escucharás su voz** (síntesis de voz del navegador).
   - Funciona mejor en **Chrome o Edge, en computador**. Si el navegador no
     soporta reconocimiento de voz, puedes escribir en el cuadro de texto de
     respaldo.
3. Botón **Finalizar llamada y evaluar** → la IA evalúa las 7 ARC y guarda el
   resultado en tu historial.

## Administradores (Nataly Bustamante, Carlos Manquillo)

Esta versión usa una **sola contraseña de administrador compartida**
(`ADMIN_PASSWORD` en `.env`), no cuentas individuales por correo — es la
forma más simple de dar acceso de administrador sin construir un sistema de
login completo. Para que Nataly y Carlos sean admin:

1. Define una contraseña segura en `ADMIN_PASSWORD` dentro de `.env`.
2. Entrégasela solo a ellos (y a quien más deba ser admin).
3. En la app, pestaña **Admin**, la ingresan una vez — su navegador la
   recuerda.

Quien tenga esa contraseña puede ver la pestaña **Equipo** (ranking de todo
el equipo comercial) y agregar productos al catálogo.

> Si más adelante quieres cuentas individuales de verdad (saber exactamente
> quién es admin sin compartir una sola clave), eso requiere un sistema de
> login con usuario/contraseña o correo por persona — es un cambio
> razonable de hacer después, dime si lo quieres y lo construyo.

## Proveedor de IA

Por defecto usa **Groq** (`GROQ_API_KEY` en `.env`, modelo
`llama-3.3-70b-versatile`) — capa gratuita real, sin tarjeta de crédito y sin
ningún cobro, ideal para este caso de uso. Consigue tu llave gratis en
[console.groq.com/keys](https://console.groq.com/keys).

Si en algún momento prefieres **OpenAI** o **Azure OpenAI** (de pago), pon en
`.env`:

```
# OpenAI
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# o Azure OpenAI (ya que IAC usa varios servicios de Azure)
AI_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://tu-recurso.openai.azure.com
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT=nombre-de-tu-deployment
```

No hay que tocar el código: `backend/ai.js` ya soporta los tres.

## Dónde desplegarlo

Es un servidor Node.js estándar — puedes desplegarlo en lo que ya uses o
conozcas:
- Un servidor/VM propio de IAC (con `pm2` o como servicio de Windows/Linux).
- Azure App Service (Node.js), ya que usan Azure.
- Cualquier PaaS (Render, Railway, Fly.io, etc.) si prefieren algo más rápido
  de poner en marcha.

En cualquier caso: configura las variables de entorno del `.env` en la
plataforma elegida (nunca subas el archivo `.env` con las llaves reales a un
repositorio), y asegúrate de que el proceso se reinicie si se cae.

**Nota sobre los datos:** esta versión guarda los datos (usuarios, catálogo,
resultados) en archivos JSON dentro de `backend/data/`. Es simple y
suficiente para un equipo comercial normal, pero significa que los datos
viven en el disco de donde corra el servidor — si despliegas en una
plataforma sin disco persistente (algunos PaaS "serverless"), los datos se
perderían al reiniciar. Si eso es un problema, dímelo y lo cambio a una base
de datos real (Postgres, etc.).

## Comerciales y correos de felicitación automáticos

Cada comercial puede escribir su nombre **y correo** la primera vez que entra
al simulador (quedan guardados en su navegador). Los administradores también
pueden precargar comerciales desde la pestaña **Admin → Comerciales**,
indicando nombre y correo manualmente, sin esperar a que esa persona entre
primero.

Cuando alguien obtiene una puntuación igual o mayor al umbral configurado
(85/100 por defecto) al finalizar una llamada, el backend **envía
automáticamente un correo de felicitación** (con el diseño/colores de IAC) a
esa persona, usando el correo SMTP que configures. Para activarlo, completa
en `.env`:

```
SMTP_HOST=smtp.office365.com      # o el servidor SMTP que uses
SMTP_PORT=587
SMTP_USER=simulador7arc@iaclatam.com
SMTP_PASS=la-contraseña-o-app-password-de-esa-cuenta
SMTP_FROM=simulador7arc@iaclatam.com
NOTIFY_THRESHOLD=85                # puntuación mínima para felicitar
ADMIN_NOTIFY_EMAILS=nataly@iaclatam.com,carlos@iaclatam.com   # opcional, copia a admins
```

Si dejas esas variables vacías, la app funciona exactamente igual, solo que
no se envía ningún correo (y queda registrado en los logs del servidor para
que sepas que falta configurarlo).

Si el comercial no dejó su correo (ni tú lo agregaste desde Admin), esa
felicitación simplemente no se envía — la puntuación igual queda guardada en
su tablero.

## Limitaciones que siguen aplicando (ya las habíamos hablado)

- **No hay integración con Teams/Microsoft Graph** para detectar cargos
  automáticamente — cada persona se identifica solo con el nombre (y ahora
  opcionalmente correo) que escribe al entrar, o lo que el admin precargue
  manualmente en "Comerciales".
