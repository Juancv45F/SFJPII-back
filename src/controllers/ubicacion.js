const { response } = require('express');
const User = require('../models-mongo/user');

const obtenerUbicaciones = async (req, res = response) => {

    const userId = req.uid; 

    try {
        const user = await User.findById(userId).select('ubicaciones').exec();
        const ubicaciones = user ? user.ubicaciones : [];

        res.json({
            ok: true,
            data: ubicaciones
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: 'Hable con el administrador'
        });
    }
}

const crearUbicacion = async (req, res = response) => {
    const userId = req.uid;
    const { calle, numero, codigo_postal, alias, descripcion } = req.body;

    try {
        const user = await User.findById(userId).exec();
        if (!user) {
            return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });
        }
        user.ubicaciones = user.ubicaciones || [];
        user.ubicaciones.push({
            calle,
            numero,
            codigo_postal,
            alias,
            descripcion
        });
        await user.save();
        const nuevaUbicacion = user.ubicaciones[user.ubicaciones.length - 1];

        if (req.logger) {
            req.logger.info('ubicacion_creada', {
                context: {
                    alias: nuevaUbicacion.alias,
                    alias: nuevaUbicacion.alias,
                }
            });
        }

        res.json({
            ok: true,
            data: nuevaUbicacion
        });
    } catch (error) {
        if (req.logger) {
            req.logger.error('ubicacion_error', { context: { message: error.message, stack: error.stack } });
        }
        res.status(500).json({
            ok: false,
            msg: 'Error al guardar ubicación'
        });
    }
}

module.exports = {
    obtenerUbicaciones,
    crearUbicacion
}
