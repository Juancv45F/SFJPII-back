# Conexión al asistente administrativo

`POST /api/admin/chat` acepta `{ "mensaje": "Consulta de inventario" }`, usando la autenticación habitual de la farmacia. Solo `admin` y `super_admin` pueden utilizarlo. El servicio devuelve `{ respuesta, tools_utilizadas, grafica }`.

Configura en el entorno privado del backend:

```dotenv
SFJPII_AI_URL=http://127.0.0.1:8000
SFJPII_AI_SERVICE_KEY=
```

Usa la URL base de SFJPII-AI, sin `/admin/chat`, y una clave aleatoria privada idéntica a `SFJPII_AI_SERVICE_KEY` en SFJPII-AI. En producción establece la URL HTTPS del chatbot. Si los procesos están en contenedores separados, usa la dirección de red del servicio de IA en lugar de localhost. Reinicia los servicios tras configurar el entorno. No publiques las claves en Git ni las envíes al frontend.

La ruta limita a 12 consultas por minuto por usuario; admite de 1 a 2000 caracteres y espera como máximo 120 segundos. Reenvía únicamente el mensaje y la cabecera interna `X-Service-Key`; no reenvía el token del usuario. Devuelve 503 sin configuración, 502 ante una respuesta inválida o fallo del chatbot y 504 si se agota el tiempo. Las respuestas no se almacenan en caché.

Pruebas: `npx jest --runInBand tests/admin-chat.test.js`. Se simula la IA, sin llamadas pagadas ni conexión a MongoDB.
