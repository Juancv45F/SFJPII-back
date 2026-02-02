const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Pedido = require('./pedido');
const Producto = require('./producto');

const DetallePedido = sequelize.define('DetallePedido', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    cantidad: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 }
    },
    precio_unitario: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        comment: 'Precio del producto al momento de la compra (con descuento aplicado)'
    },
    subtotal: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    }
});

module.exports = DetallePedido;