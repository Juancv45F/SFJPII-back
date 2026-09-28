const router = require('express').Router();
const axios = require('axios');
const rateLimit = require('express-rate-limit');

const {
  validateToken,
  authorizeRoles
} = require('../middlewares/validateToken');

const safeUpstreamStatus = error => [422, 429, 503, 504].includes(error.response?.status)
  ? error.response.status : null;


router.use(
  validateToken,
  authorizeRoles('admin')
);


router.use(
  rateLimit({
    windowMs: 60000,
    limit: 12,
    skip: req => req.method !== "POST",

    keyGenerator: req =>
      String(req.uid),

    standardHeaders: true,
    legacyHeaders: false,

    message: {
      message:
        'Has enviado varias consultas. Espera un minuto antes de continuar.'
    }
  })
);


router.post('/chat', async (req, res) => {
  if (req.body?.conversation_id != null && (typeof req.body.conversation_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(req.body.conversation_id))) {
    return res.status(400).json({ message: 'Conversación no válida.' });
  }

  res.setHeader(
    'Cache-Control',
    'no-store'
  );


  const mensaje =
    typeof req.body?.mensaje === 'string'
      ? req.body.mensaje.trim()
      : '';


  if (
    !mensaje ||
    mensaje.length > 2000
  ) {
    return res.status(400).json({
      message:
        'Escribe una consulta de entre 1 y 2000 caracteres.'
    });
  }


  const base =
    process.env.SFJPII_AI_URL ||
    (
      process.env.NODE_ENV === 'production'
        ? ''
        : 'http://127.0.0.1:8000'
    );


  const key =
    process.env.SFJPII_AI_SERVICE_KEY;


  if (!base || !key) {
    return res.status(503).json({
      message:
        'El asistente todavía no está configurado. Contacta al administrador del sistema.'
    });
  }


  try {

    const url = new URL(
      base.replace(/\/$/, '') +
      '/admin/chat'
    );


    if (
      !['http:', 'https:']
        .includes(url.protocol)
    ) {
      throw new Error(
        'Invalid service URL'
      );
    }


    const { data } =
      await axios.post(

        url.href,

        {
          mensaje,

          conversation_id:
            req.body?.conversation_id ||
            null
        },

        {
          headers: {

            'X-Service-Key':
              key,

            'X-Admin-Id':
              String(req.uid)
          },

          timeout: 120000,

          maxRedirects: 0,

          maxContentLength:
            1024 * 1024,

          maxBodyLength:
            16384
        }
      );


    if (
      typeof data?.respuesta !== 'string' ||
      !data.respuesta.trim()
    ) {
      return res.status(502).json({
        message:
          'El asistente devolvió una respuesta vacía. Inténtalo nuevamente.'
      });
    }


    return res.json({

      respuesta:
        data.respuesta,

      tools_utilizadas:
        Array.isArray(
          data.tools_utilizadas
        )
          ? data.tools_utilizadas
          : [],

      grafica:
        data.grafica || null,

      conversation_id:
        data.conversation_id || null
    });


  } catch (error) {

    const timeout =
      [
        'ECONNABORTED',
        'ETIMEDOUT'
      ].includes(error.code);

    req.logger?.error('admin_chat_proxy_failed', { context: {
      userId: String(req.uid), timeout, upstreamStatus: error.response?.status || null,
      errorCode: error.code || null
    } });


    const status = timeout ? 504 : (safeUpstreamStatus(error) || 502);
    const messages = {
      422: 'No pude interpretar el periodo o los límites de la consulta.',
      429: 'El asistente está atendiendo varias consultas. Espera un momento.',
      503: 'El asistente no está disponible temporalmente.',
      504: 'La consulta tardó demasiado. Puedes intentarlo de nuevo.'
    };
    return res
      .status(status)
      .json({
        message: messages[status] || 'No se pudo conectar con el asistente. Inténtalo en unos momentos.'
      });
  }
});



router.get(['/conversations', '/conversations/:id'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const base = process.env.SFJPII_AI_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:8000');
  const key = process.env.SFJPII_AI_SERVICE_KEY;
  if (!base || !key) return res.status(503).json({ message: 'El asistente todavía no está configurado.' });
  const offset = Number(req.query.offset || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return res.status(400).json({ message: 'Página no válida.' });
  try {
    const url = new URL(base.replace(/\/$/, '') + '/admin/conversations' + (req.params.id ? '/' + encodeURIComponent(req.params.id) : ''));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid URL');
    const { data } = await axios.get(url.href, { params: req.params.id ? {} : { offset },
      headers: { 'X-Service-Key': key, 'X-Admin-Id': String(req.uid) }, timeout: 25000,
      maxRedirects: 0, maxContentLength: 8 * 1024 * 1024 });
    return res.json(data);
  } catch (error) {
    req.logger?.error('admin_chat_history_failed', { context: {
      userId: String(req.uid), operation: req.params.id ? 'read' : 'list',
      upstreamStatus: error.response?.status || null, errorCode: error.code || null
    } });
    const status = error.response?.status === 404 ? 404 : (safeUpstreamStatus(error) || 502);
    return res.status(status).json({ message: status === 404 ? 'Conversación no encontrada.' : status === 503
      ? 'El historial no está disponible temporalmente.' : 'No se pudo recuperar el historial. Inténtalo de nuevo.' });
  }
});

router.delete('/conversations/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(req.params.id)) {
    return res.status(400).json({ message: 'Conversación no válida.' });
  }
  const base = process.env.SFJPII_AI_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:8000');
  const key = process.env.SFJPII_AI_SERVICE_KEY;
  if (!base || !key) return res.status(503).json({ message: 'El asistente todavía no está configurado.' });
  try {
    const url = new URL(base.replace(/\/$/, '') + '/admin/conversations/' + encodeURIComponent(req.params.id));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid URL');
    await axios.delete(url.href, { headers: { 'X-Service-Key': key, 'X-Admin-Id': String(req.uid) },
      timeout: 25000, maxRedirects: 0 });
    return res.status(204).send();
  } catch (error) {
    req.logger?.error('admin_chat_delete_failed', { context: {
      userId: String(req.uid), upstreamStatus: error.response?.status || null,
      errorCode: error.code || null
    } });
    const status = error.response?.status === 404 ? 404 : (safeUpstreamStatus(error) || 502);
    return res.status(status).json({ message: status === 404 ? 'Conversación no encontrada.' : status === 503
      ? 'El historial no está disponible temporalmente.' : 'No se pudo eliminar la conversación. Inténtalo de nuevo.' });
  }
});
module.exports = router;
