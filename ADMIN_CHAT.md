# Conexión al asistente administrativo

El historial se obtiene con `GET /api/admin/conversations?offset=0` (30 resultados y `has_more`) y `GET /api/admin/conversations/:id` (mensajes). Ambas rutas requieren sesión administrativa y transmiten `X-Admin-Id` desde el usuario autenticado. `POST /api/admin/chat` acepta `conversation_id` opcional y lo devuelve para continuar el chat. El límite de 12 consultas por minuto se aplica solo al envío de preguntas, no a la navegación del historial.

`DELETE /api/admin/conversations/:id` elimina definitivamente la conversación del administrador autenticado. Devuelve 204 al eliminar y 404 cuando no existe o pertenece a otro administrador.

El proxy conserva códigos operativos seguros de SFJPII-AI (422, 429, 503 y 504), pero reemplaza sus detalles por mensajes controlados. Los fallos se registran mediante el logger existente con usuario, operación, código y estado remoto; no se registran mensajes, respuestas ni la clave interna.

`POST /api/admin/chat` acepta `{ "mensaje": "Consulta de inventario" }`, usando la autenticación habitual de la farmacia. Solo `admin` y `super_admin` pueden utilizarlo. El servicio devuelve `{ respuesta, tools_utilizadas, grafica }`.

Configura en el entorno privado del backend:

```dotenv
SFJPII_AI_URL=http://127.0.0.1:8000
SFJPII_AI_SERVICE_KEY=
```

Usa la URL base de SFJPII-AI, sin `/admin/chat`, y una clave aleatoria privada idéntica a `SFJPII_AI_SERVICE_KEY` en SFJPII-AI. En producción establece la URL HTTPS del chatbot. Si los procesos están en contenedores separados, usa la dirección de red del servicio de IA en lugar de localhost. Reinicia los servicios tras configurar el entorno. No publiques las claves en Git ni las envíes al frontend.

La ruta limita a 12 consultas por minuto por usuario; admite de 1 a 2000 caracteres y espera como máximo 120 segundos. Reenvía únicamente el mensaje y la cabecera interna `X-Service-Key`; no reenvía el token del usuario. Devuelve 503 sin configuración, 502 ante una respuesta inválida o fallo del chatbot y 504 si se agota el tiempo. Las respuestas no se almacenan en caché.

Pruebas: `npx jest --runInBand tests/admin-chat.test.js`. Se simula la IA, sin llamadas pagadas ni conexión a MongoDB.
