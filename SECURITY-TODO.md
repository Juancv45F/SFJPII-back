# Pendientes de seguridad (backend)

Hallazgos de la auditoría que **no** se arreglan en el cliente Angular.
Afectan a la API en `http://localhost:3000` (Express), que vive en otro repo.

---

## 1. CORS: refleja cualquier `Origin` con credenciales — Media/Alta

### Qué pasa
La API responde a cualquier origen con:

```
Access-Control-Allow-Origin: <el-origin-que-sea>   ← reflejado
Access-Control-Allow-Credentials: true
```

Probado:

```bash
curl -s -D - -o /dev/null -H "Origin: https://evil.example" \
  http://localhost:3000/api/auth/login -X OPTIONS | grep -i access-control
# -> Access-Control-Allow-Origin: https://evil.example
# -> Access-Control-Allow-Credentials: true
```

### Por qué importa
Reflejar el `Origin` + `Allow-Credentials: true` permite que **cualquier sitio web**
haga peticiones autenticadas en nombre del usuario. Hoy el riesgo es acotado porque
los tokens viajan en `Authorization`/`localStorage` (no en cookies), pero en cuanto
se use **una sola cookie de sesión** queda explotable (robo de sesión cross-site).

### Qué hacer
Usar una **allow-list** de orígenes concretos, nunca reflejar el `Origin`:

```js
// Express + cors
const cors = require('cors');

const ALLOWED = [
  'http://localhost:8100',          // dev Ionic
  'https://farmacia-juan-pablo-ii.web.app', // prod (ajustar)
];

app.use(cors({
  origin(origin, cb) {
    // permitir herramientas sin origin (curl, apps nativas) si aplica
    if (!origin || ALLOWED.includes(origin)) return cb(null, true);
    return cb(new Error('Origin no permitido'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-token', 'x-refresh-token', 'x-correlation-id'],
}));
```

- No usar `origin: true` ni `origin: '*'` junto con `credentials: true`.
- Mantener la lista en variable de entorno (`CORS_ORIGINS`) para dev/prod.

### Extra del mismo bloque
- **Quitar fingerprinting:** `app.disable('x-powered-by');` (hoy expone `X-Powered-By: Express`).
- **Añadir headers de seguridad:** `app.use(require('helmet')())` → CSP, HSTS, X-Content-Type-Options, X-Frame-Options.

---

## 2. Tokens en `localStorage` → robo por XSS — Media

El cliente guarda `token` y `refreshToken` en `localStorage` (cifrado con una clave
que igualmente viaja en el bundle, así que no protege contra XSS).

### Qué hacer (requiere backend)
- Emitir el **refresh token** como cookie `HttpOnly; Secure; SameSite=Strict`.
  Así el JS del navegador no puede leerlo y el XSS no lo roba.
- Mantener el access token en memoria (variable), no en `localStorage`.
- Endpoint `/auth/refresh` lee la cookie, no el body.

---

## 3. Logs que exponen emails/URLs en consola de producción — Baja

En `src/app/services/auth.ts` hay ~18 `console.log('[AUTH] ...')` que imprimen
emails, URLs de endpoints y estados en la consola del navegador. En producción
eso es una fuga menor de información (visible en DevTools).

### Qué hacer (cliente — pendiente de confirmar)
Condicionar los logs al modo desarrollo:

```ts
import { environment } from 'src/environments/environment';
const log = (...a: any[]) => { if (!environment.production) console.log(...a); };
// y reemplazar console.log('[AUTH]'...) por log('[AUTH]'...)
```

O eliminar directamente los que imprimen `email` / `url`.

---

## Resumen de prioridad
1. **CORS allow-list** (backend) — lo primero.
2. `x-powered-by` + `helmet` (backend) — trivial, hazlo junto con CORS.
3. Refresh token en cookie `HttpOnly` (backend) — mejora de fondo.
4. Logs sensibles (cliente) — rápido.
