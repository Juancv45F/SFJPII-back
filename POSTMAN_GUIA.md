# Guía de Pruebas de API con Postman - SFJPII Backend

---

## 1. CONFIGURACIÓN INICIAL EN POSTMAN

### 1.1 Crear un Environment (Entorno)

En Postman, crea un nuevo Environment con las siguientes variables:

| Variable | Valor (Desarrollo) | Descripción |
|---|---|---|
| `base_url` | `http://localhost:3000` | URL base del servidor |
| `token` | *(vacío, se llenará después del login)* | Token JWT de acceso |
| `refreshToken` | *(vacío)* | Token para refrescar sesión |
| `userId` | *(vacío)* | ID del usuario logueado |
| `productId` | *(vacío)* | ID de producto de prueba |
| `ubicacionId` | *(vacío)* | ID de ubicación de prueba |
| `pedidoId` | *(vacío)* | ID de pedido de prueba |

### 1.2 Iniciar el servidor

```bash
npm run dev
```

El servidor arranca en el puerto `3000` por defecto 

---

## 2. RUTA DE PRUEBA RÁPIDA

### GET / - Verificar que el servidor está vivo

- **Método:** `GET`
- **URL:** `{{base_url}}/`
- **Headers:** Ninguno
- **Body:** Ninguno

**Respuesta esperada (200 OK):**
```
Servidor trabajando
```

---

## 3. AUTENTICACIÓN - `/api/auth`

Todas las rutas empiezan con `{{base_url}}/api/auth`.

> **Nota importante:** En modo desarrollo, los correos se SIMULAN en consola del servidor. El código de verificación/OTP aparece en la terminal donde corre el backend. Para registro y recuperación de contraseña, el servidor NO valida reCAPTCHA realmente en desarrollo (puedes usar cualquier string).

---

### 3.1 POST /register - Registrar un usuario nuevo

- **Método:** `POST`
- **URL:** `{{base_url}}/api/auth/register`
- **Headers:** `Content-Type: application/json`
- **Body (raw → JSON):**

```json
{
  "nombre": "Juan",
  "apellido": "Pérez",
  "email": "juan.perez@test.com",
  "password": "Prueba123!",
  "confirmPassword": "Prueba123!",
  "ubicacion": {
    "calle": "Av. Reforma",
    "numero": "123",
    "codigo_postal": "06600",
    "descripcion": "Casa azul, portón blanco",
    "alias": "Casa"
  },
  "recaptchaToken": "test_token_desarrollo"
}
```

**Reglas de contraseña:**
- Mínimo 8 caracteres
- Al menos 1 mayúscula
- Al menos 1 número
- Al menos 1 carácter especial (`!@#$%^&*`, etc.)

**Respuesta esperada (201 Created):**
```json
{
  "message": "Registro exitoso. Revisa tu correo para el código.",
  "userId": "60d21b4667d0d8992e610c85"
}
```

**Después de esto:** Mira la terminal del servidor y copia el código de 6 dígitos que se muestra.

---

### 3.2 POST /verify - Verificar código de correo

- **Método:** `POST`
- **URL:** `{{base_url}}/api/auth/verify`
- **Body (JSON):**

```json
{
  "email": "juan.perez@test.com",
  "code": "123456"
}
```

**Respuesta esperada (200 OK):**
```json
{
  "message": "¡Verificación exitosa! Ya puedes iniciar sesión.",
  "isVerified": true
}
```

---

### 3.3 POST /verify/resend - Reenviar código de verificación

- **Método:** `POST`
- **URL:** `{{base_url}}/api/auth/verify/resend`
- **Body (JSON):**

```json
{
  "email": "juan.perez@test.com"
}
```

---

### 3.4 POST /login - Iniciar sesión

- **Método:** `POST`
- **URL:** `{{base_url}}/api/auth/login`
- **Body (JSON):**

```json
{
  "email": "juan.perez@test.com",
  "password": "Prueba123!"
}
```

**Respuesta esperada (200 OK):**
```json
{
  "message": "Bienvenido",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "60d21b4667d0d8992e610c85",
    "nombre": "Juan",
    "rol": "cliente"
  }
}
```

### 3.5 POST /mfa/verify - Verificar MFA (si está habilitado)

> Solo si el usuario tiene MFA activado. El login devolverá `mfaRequired: true` y un `mfaToken`.

- **Body (JSON):**

```json
{
  "mfaToken": "eyJhbGciOiJIUzI1NiIs...",
  "otp": "123456",
  "method": "email"
}
```

**`method` puede ser:** `email`, `totp`, `backup`

---

### 3.6 POST /mfa/resend - Reenviar OTP de MFA

```json
{
  "mfaToken": "eyJhbGciOiJIUzI1NiIs...",
  "method": "email"
}
```

---

### 3.7 POST /refresh - Refrescar token

- **URL:** `{{base_url}}/api/auth/refresh`
- **Body (JSON):**

```json
{
  "refreshToken": "{{refreshToken}}"
}
```

**En Tests:** Actualiza ambos tokens igual que en el login.

---

### 3.8 POST /logout - Cerrar sesión

- **URL:** `{{base_url}}/api/auth/logout`
- **No requiere body ni token** (usa cookies).

---

### 3.9 Recuperación de contraseña

#### Paso 1: Solicitar código
```
POST {{base_url}}/api/auth/recovery/request
```
```json
{
  "email": "juan.perez@test.com",
  "method": "email"
}
```

#### Paso 2: Verificar código (usa el código de la consola)
```
POST {{base_url}}/api/auth/recovery/verify
```
```json
{
  "email": "juan.perez@test.com",
  "code": "123456"
}
```

#### Paso 3: Restablecer contraseña
```
POST {{base_url}}/api/auth/recovery/reset
```
```json
{
  "email": "juan.perez@test.com",
  "newPassword": "NuevaPrueba123!"
}
```

---

## 4. USUARIOS - `/api/user`

**Todas estas rutas requieren autenticación.** En Postman, configura el Header así:

| Header | Valor |
|---|---|
| `x-token` | `{{token}}` |

> O puedes usar el estándar: `Authorization: Bearer {{token}}`

---

### 4.1 GET /me - Obtener perfil del usuario

- **URL:** `{{base_url}}/api/user/me`
- **Headers:** `x-token: {{token}}`

---

### 4.2 PUT /password - Cambiar contraseña

```
PUT {{base_url}}/api/user/password
```
```json
{
  "currentPassword": "Prueba123!",
  "newPassword": "OtraPrueba456!"
}
```

---

### 4.3 PUT /:id/role - Cambiar rol de usuario

> **Solo admin o super_admin** pueden usar esta ruta.

```
PUT {{base_url}}/api/user/{{userId}}/role
```
```json
{
  "role": "editor"
}
```

**Roles válidos:** `cliente`, `editor`, `admin`, `super_admin`

---

### 4.4 GET /preferences y PUT /preferences

```
GET  {{base_url}}/api/user/preferences
PUT  {{base_url}}/api/user/preferences
```
Body PUT:
```json
{
  "theme": "dark",
  "language": "es"
}
```

---

### 4.5 Sesiones

```
GET  {{base_url}}/api/user/sessions              (listar sesiones activas)
POST {{base_url}}/api/user/sessions/revoke       (revocar una sesión)
POST {{base_url}}/api/user/sessions/revoke-others (cerrar sesiones excepto la actual)
```

Body revoke:
```json
{
  "sessionId": "id-de-la-sesion"
}
```

---

### 4.6 MFA - TOTP (Authenticator App)

```
POST {{base_url}}/api/user/mfa/totp/setup          (iniciar setup - devuelve QR/secret)
POST {{base_url}}/api/user/mfa/totp/verify         (verificar y activar)
POST {{base_url}}/api/user/mfa/totp/reset/start    (solicitar reset)
POST {{base_url}}/api/user/mfa/totp/reset/verify   (confirmar reset)
```

Setup inicial no requiere body. Verify:
```json
{
  "token": "123456"
}
```

---

### 4.7 Preguntas de recuperación

```
GET  {{base_url}}/api/user/recovery/questions      (ver estado)
PUT  {{base_url}}/api/user/recovery/questions      (guardar/actualizar)
```

Body PUT:
```json
{
  "questions": [
    { "questionId": "mascota", "answer": "Firulais" },
    { "questionId": "ciudad", "answer": "Monterrey" }
  ]
}
```

---

## 5. PRODUCTOS - `/api/productos`

Rutas base: `{{base_url}}/api/productos`

---

### 5.1 GET / - Obtener todos los productos (público)

```
GET {{base_url}}/api/productos
```

---

### 5.2 GET /buscar - Buscar productos con filtros (público)

```
GET {{base_url}}/api/productos/buscar?q=coca&precioMin=10&precioMax=100&categoriaId=60d...
```

**Query params:**
- `q` = texto a buscar en nombre (regex)
- `precioMin` = precio mínimo
- `precioMax` = precio máximo
- `categoriaId` = ObjectId de la categoría

---

### 5.3 GET /categorias - Listar categorías (público)

```
GET {{base_url}}/api/productos/categorias
```

---

### 5.4 GET /:id/stock - Obtener stock de un producto (público)

```
GET {{base_url}}/api/productos/{{productId}}/stock
```

---

### 5.5 POST / - Crear producto (admin/editor + autenticado)

> **Requiere:** `x-token` de usuario admin o editor, y es un request `multipart/form-data` (no JSON).

- **Método:** `POST`
- **Headers:** `x-token: {{token}}`
- **Body:** `form-data`

| Key | Value | Tipo |
|---|---|---|
| `nombre` | `Coca Cola 600ml` | text |
| `descripcion` | `Refresco de cola 600ml` | text |
| `precio` | `18.50` | text |
| `stock` | `100` | text |
| `descuento` | `0` | text |
| `categoria` | `{"nombre":"Bebidas","activa":true}` | text |
| `imagen` | *(selecciona un archivo JPG/PNG/WebP)* | File |

**Si no tienes imagen:** Puedes omitir el campo `imagen`.

**Respuesta (201):** Guarda el `_id` en la variable `productId`.

---

### 5.6 PUT /:id - Editar producto (admin/editor)

- **Body:** Igual que crear (multipart/form-data), incluyendo el campo `imagen` si quieres reemplazarla.

---

### 5.7 PUT /:id/stock - Actualizar solo el stock (admin/editor)

```
PUT {{base_url}}/api/productos/{{productId}}/stock
```
```json
{
  "stock": 150
}
```

---

### 5.8 DELETE /:id - Eliminar producto (solo admin)

```
DELETE {{base_url}}/api/productos/{{productId}}
```

---

### 5.9 Categorías globales (admin/editor)

```
PUT    {{base_url}}/api/productos/categorias/Bebidas   (renombrar/actualizar)
DELETE {{base_url}}/api/productos/categorias/Bebidas   (eliminar categoría, SOLO admin)
```

Body PUT:
```json
{
  "nuevoNombre": "Bebidas Embotelladas",
  "descripcion": "Refrescos, jugos y aguas",
  "activa": true
}
```

---

## 6. CARRITO - `/api/carrito`

**Solo rol cliente, requiere token.**

---

### 6.1 GET / - Ver carrito

```
GET {{base_url}}/api/carrito
```

---

### 6.2 POST /:id - Agregar producto al carrito

```
POST {{base_url}}/api/carrito/{{productId}}
```
```json
{
  "cantidad": 2
}
```
*(Si no mandas `cantidad`, default = 1)*

---

### 6.3 POST /sync - Sincronizar carrito completo

```
POST {{base_url}}/api/carrito/sync
```
```json
{
  "items": [
    { "id": "{{productId}}", "cantidad": 3 },
    { "id": "otroProductId123", "cantidad": 1 }
  ]
}
```

---

### 6.4 DELETE /:id - Quitar producto del carrito

```
DELETE {{base_url}}/api/carrito/{{productId}}
```

---

## 7. UBICACIONES - `/api/ubicaciones`

**Solo rol cliente, requiere token.**

---

### 7.1 GET / - Listar mis ubicaciones

```
GET {{base_url}}/api/ubicaciones
```

---

### 7.2 POST / - Crear nueva ubicación

```
POST {{base_url}}/api/ubicaciones
```
```json
{
  "calle": "Calle Morelos",
  "numero": "456",
  "codigo_postal": "64000",
  "alias": "Oficina",
  "descripcion": "Piso 3, oficina 302"
}
```

> **Guarda el `_id` devuelto en la variable `ubicacionId`.**

---

### 7.3 PUT /:id - Actualizar ubicación

```
PUT {{base_url}}/api/ubicaciones/{{ubicacionId}}
```
Body igual que crear.

---

### 7.4 DELETE /:id - Eliminar ubicación

```
DELETE {{base_url}}/api/ubicaciones/{{ubicacionId}}
```

---

## 8. PEDIDOS - `/api/pedidos`

**Requiere token.** Crear pedido = solo `cliente`. Cambiar estado = admin/editor/cliente.

---

### 8.1 POST / - Crear pedido (cliente)

```
POST {{base_url}}/api/pedidos
```
```json
{
  "productos": [
    { "id": "{{productId}}", "cantidad": 2, "precio_unitario": 18.50 }
  ],
  "total": 37.00,
  "ubicacionId": "{{ubicacionId}}",
  "metodo_pago": "efectivo"
}
```

**Importante:**
- `productos[].id` debe ser un ObjectId de Mongo válido
- `total` es numérico (el servidor lo recalcula, pero hay que mandarlo)
- `ubicacionId` puede ser el `_id` de una ubicación del usuario o el índice numérico en el array

**Guarda el `_id` del pedido en `pedidoId`.**

---

### 8.2 GET / - Listar mis pedidos

```
GET {{base_url}}/api/pedidos
```

- Clientes ven solo sus pedidos
- Admins/editores ven todos los pedidos

---

### 8.3 GET /:id - Detalle de un pedido

```
GET {{base_url}}/api/pedidos/{{pedidoId}}
```

---

### 8.4 PATCH /:id/estado - Cambiar estado del pedido

```
PATCH {{base_url}}/api/pedidos/{{pedidoId}}/estado
```
```json
{
  "estado": "en_camino"
}
```

**Estados válidos:** `pendiente`, `pagado`, `en_camino`, `enviado`, `entregado`, `cancelado`

---

## 9. WEBAUTHN / PASSKEYS - `/api/auth/webauthn`

> Avanzado, requiere navegador compatible. Para probar en Postman normalmente necesitarías hacer las firmas criptográficas manualmente. Se recomienda probar desde un navegador real.

```
POST   {{base_url}}/api/auth/webauthn/register/options   (iniciar registro de passkey - con token)
POST   {{base_url}}/api/auth/webauthn/register/verify    (confirmar registro - con token)
POST   {{base_url}}/api/auth/webauthn/login/options      (iniciar login con passkey)
POST   {{base_url}}/api/auth/webauthn/login/verify       (confirmar login)
GET    {{base_url}}/api/auth/webauthn/credentials        (listar credenciales - con token)
DELETE {{base_url}}/api/auth/webauthn/credentials        (eliminar credencial - con token)
```

---

## 10. SSO (Single Sign-On)

```
GET  {{base_url}}/api/auth/sso/token       (generar token SSO temporal - con token)
POST {{base_url}}/api/auth/sso/validate    (validar y obtener sesión real)
```

Body validate:
```json
{
  "ssoToken": "..."
}
```

---

## 11. RUTAS DE DEBUG / DIAGNÓSTICO

```
GET {{base_url}}/api/debug/delay?ms=2000     (simular 2s de latencia)
GET {{base_url}}/api/debug/error             (provocar error 500 a propósito)
```

---

## 12. FLUJO COMPLETO DE PRUEBA (Sugerido)

**Paso 1:** Probar `GET /` → servidor vivo.

**Paso 2:** `POST /api/auth/register` → usuario nuevo.
- Copia código de la consola.

**Paso 3:** `POST /api/auth/verify` → activar cuenta.

**Paso 4:** `POST /api/auth/login` → obtener tokens.
- Asegúrate de tener el script en Tests para guardar variables.

**Paso 5:** `POST /api/productos` (con token de admin) → crear producto.
- Guarda `_id` en `productId`.

**Paso 6:** `GET /api/productos` → verificar que aparezca.

**Paso 7:** `POST /api/ubicaciones` (con token cliente) → crear ubicación.
- Guarda `_id` en `ubicacionId`.

**Paso 8:** `POST /api/carrito/{{productId}}` → agregar al carrito.

**Paso 9:** `GET /api/carrito` → ver carrito.

**Paso 10:** `POST /api/pedidos` → crear pedido.
- Guarda `_id` en `pedidoId`.

**Paso 11:** `PATCH /api/pedidos/{{pedidoId}}/estado` → cambiar a `pagado` o `en_camino`.

**Paso 12:** `GET /api/pedidos` → confirmar cambio.

---

## 13. ERRORES COMUNES Y SOLUCIONES

| Código | Causa | Solución |
|---|---|---|
| `400 Bad Request` | Campos faltantes, contraseña débil, IDs inválidos | Revisa el body y las reglas de validación en este documento |
| `401 Unauthorized` | No hay token, token expirado, token inválido | Haz login nuevo o usa `/refresh` |
| `403 Forbidden` | Rol no permitido (ej: cliente intentando crear producto) | Usa una cuenta con rol `admin`/`editor` |
| `404 Not Found` | Producto/pedido/ubicación no existe | Verifica que el ID exista en BD |
| `429 Too Many Requests` | Rate limit alcanzado (login/register) | Espera el tiempo indicado en `retryAfterSec` |
| `500 Internal Server Error` | Error de código o BD | Revisa la consola del servidor para ver el stack trace |

---

## 14. HEADERS QUE ACEPTA EL SERVIDOR

El CORS está configurado en [index.js#L57-L68](file:///c:/Users/cisne/OneDrive/Documents/IDGS_8_A/Desarrollo_Web_Profesional/Full_SFJPII/SFJPII-back/index.js#L57-L68) para aceptar:

- `Content-Type`
- `Authorization`
- `x-token` (recomendado para este proyecto)
- `x-refresh-token`
- `x-correlation-id`

Métodos permitidos: `GET, POST, PUT, PATCH, DELETE, OPTIONS`

---

## 15. SEEDS (Datos de prueba)

Si quieres poblar la BD con datos de prueba:

```bash
# Limpiar datos anteriores
npm run seed:clean

# Insertar datos de prueba
npm run seed
```

Revisa [src/seeds/seed.js](file:///c:/Users/cisne/OneDrive/Documents/IDGS_8_A/Desarrollo_Web_Profesional/Full_SFJPII/SFJPII-back/src/seeds/seed.js) para ver qué usuarios/productos se crean.

---

## 16. RESUMEN DE ROLES Y PERMISOS

| Ruta | Público | Cliente | Editor | Admin | Super Admin |
|---|---|---|---|---|---|
| Productos - GET | ✅ | ✅ | ✅ | ✅ | ✅ |
| Productos - Crear/Editar | ❌ | ❌ | ✅ | ✅ | ✅ |
| Productos - Eliminar | ❌ | ❌ | ❌ | ✅ | ✅ |
| Categorías - PUT | ❌ | ❌ | ✅ | ✅ | ✅ |
| Categorías - DELETE | ❌ | ❌ | ❌ | ✅ | ✅ |
| Stock - Actualizar | ❌ | ❌ | ✅ | ✅ | ✅ |
| Carrito (todas) | ❌ | ✅ | ❌ | ❌ | ❌ |
| Ubicaciones (todas) | ❌ | ✅ | ❌ | ❌ | ❌ |
| Pedidos - Crear | ❌ | ✅ | ❌ | ❌ | ❌ |
| Pedidos - Listar/Ver | ❌ | ✅ (solo suyos) | ✅ (todos) | ✅ (todos) | ✅ |
| Pedidos - Cambiar estado | ❌ | ✅ | ✅ | ✅ | ✅ |
| User /me, password, etc | ❌ | ✅ | ✅ | ✅ | ✅ |
| User cambiar rol | ❌ | ❌ | ❌ | ✅ | ✅ |
