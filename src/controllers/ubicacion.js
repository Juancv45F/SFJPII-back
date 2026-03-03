const { response } = require('express');
const { Ubicacion } = require('../models'); // Asegúrate de importar tu modelo

const obtenerUbicaciones = async (req, res = response) => {

    // Se asume que tu middleware 'validateToken' guarda el ID del usuario en req.uid
    const userId = req.uid; 

    try {
        const ubicaciones = await Ubicacion.findAll({
            where: {
                userId: userId // <-- FILTRO CLAVE: Solo las de este usuario
            }
        });

        res.json({
            ok: true,
            data: ubicaciones
        });

    } catch (error) {
        console.log(error);
        res.status(500).json({
            ok: false,
            msg: 'Hable con el administrador'
        });
    }
}

// Opcional: Crear una nueva ubicación desde el Checkout
const crearUbicacion = async (req, res = response) => {
    const userId = req.uid;
    const { calle, numero, codigo_postal, alias, descripcion } = req.body;

    try {
        const nuevaUbicacion = await Ubicacion.create({
            calle,
            numero,
            codigo_postal,
            alias,
            descripcion,
            userId // Asignamos la ubicación a este usuario
        });

        if (req.logger) {
            req.logger.info('ubicacion_creada', {
                context: {
                    ubicacionId: nuevaUbicacion.id,
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
