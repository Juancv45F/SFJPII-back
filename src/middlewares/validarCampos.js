const { validationResult } = require('express-validator');

const validarCampos = (req, res, next) => {
    // Revisa si express-validator encontró errores en la ruta
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        return res.status(400).json({
            ok: false,
            errors: errors.mapped() // Devuelve los errores al frontend
        });
    }
    
    next(); // Si no hay errores, pasa al controlador
}

module.exports = {
    validarCampos
};