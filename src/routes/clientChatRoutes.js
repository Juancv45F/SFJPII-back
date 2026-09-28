const router = require('express').Router();
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const { validateToken, authorizeRoles } = require('../middlewares/validateToken');

const safeUpstreamStatus = error => [400, 422, 429, 503, 504].includes(error.response?.status)
  ? error.response.status : null;

router.use(validateToken, authorizeRoles('cliente'));
router.use(rateLimit({
  windowMs: 60000,
  limit: 12,
  skip: req => req.method !== 'POST',
  keyGenerator: req => String(req.uid),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Has enviado varias consultas. Espera un minuto antes de continuar.' }
}));

router.post('/chat', async (req, res) => {
  const mensaje = typeof req.body?.mensaje === 'string' ? req.body.mensaje.trim() : '';
  const conversationId = req.body?.conversation_id;
  if (!mensaje || mensaje.length > 2000) {
    return res.status(400).json({ message: 'Escribe una consulta de entre 1 y 2000 caracteres.' });
  }
  if (conversationId != null && (typeof conversationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(conversationId))) {
    return res.status(400).json({ message: 'Conversación no válida.' });
  }

  res.setHeader('Cache-Control', 'no-store');
  const base = process.env.SFJPII_AI_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:8000');
  const key = process.env.SFJPII_AI_SERVICE_KEY;
  if (!base || !key) {
    return res.status(503).json({ message: 'El asistente todavía no está configurado.' });
  }

  try {
    const url = new URL(base.replace(/\/$/, '') + '/cliente/chat');
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid service URL');
    const { data } = await axios.post(url.href, {
      mensaje,
      conversation_id: conversationId || null
    }, {
      headers: {
        'X-Service-Key': key,
        'X-User-Id': String(req.uid)
      },
      timeout: 120000,
      maxRedirects: 0,
      maxContentLength: 1024 * 1024,
      maxBodyLength: 16384
    });

    if (typeof data?.respuesta !== 'string' || !data.respuesta.trim()) {
      return res.status(502).json({ message: 'El asistente devolvió una respuesta vacía. Inténtalo nuevamente.' });
    }
    return res.json({
      respuesta: data.respuesta,
      tools_utilizadas: Array.isArray(data.tools_utilizadas) ? data.tools_utilizadas : [],
      grafica: null,
      conversation_id: data.conversation_id || null
    });
  } catch (error) {
    const timeout = ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code);
    req.logger?.error('client_chat_proxy_failed', { context: {
      userId: String(req.uid), timeout, upstreamStatus: error.response?.status || null,
      errorCode: error.code || null
    } });
    const status = timeout ? 504 : (safeUpstreamStatus(error) || 502);
    const messages = {
      400: 'No se pudo validar tu sesión con el asistente.',
      422: 'No pude interpretar los datos de la consulta.',
      429: 'El asistente está atendiendo varias consultas. Espera un momento.',
      503: 'El asistente no está disponible temporalmente.',
      504: 'La consulta tardó demasiado. Puedes intentarlo de nuevo.'
    };
    return res.status(status).json({
      message: messages[status] || 'No se pudo conectar con el asistente. Inténtalo en unos momentos.'
    });
  }
});

module.exports = router;
