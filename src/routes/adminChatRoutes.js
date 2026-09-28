const router = require('express').Router();
const axios = require('axios');
const rateLimit = require('express-rate-limit');

const {
  validateToken,
  authorizeRoles
} = require('../middlewares/validateToken');


router.use(
  validateToken,
  authorizeRoles('admin')
);


router.use(
  rateLimit({
    windowMs: 60000,
    limit: 12,

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


    return res
      .status(
        timeout ? 504 : 502
      )
      .json({

        message:
          timeout
            ? 'La consulta tardó demasiado. Puedes intentarlo de nuevo.'
            : 'No se pudo conectar con el asistente. Inténtalo en unos momentos.'
      });
  }
});


module.exports = router;