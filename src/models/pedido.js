const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('./user');
const Ubicacion = require('./ubicacion');

const Pedido = sequelize.define('Pedido', {
    fecha: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    total: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    estado: {
        type: DataTypes.ENUM('pendiente', 'pagado', 'en_camino', 'entregado', 'cancelado'),
        defaultValue: 'pendiente'
    },
    metodo_pago: {
        type: DataTypes.STRING, // 'efectivo', 'transferencia'
        defaultValue: 'efectivo'
    }
    // userId y ubicacionId se agregan automáticamente
});

module.exports = Pedido;