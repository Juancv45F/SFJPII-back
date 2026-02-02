const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Categoria = require('./categoria');

const Producto = sequelize.define('Producto', {
    nombre: {
        type: DataTypes.STRING,
        allowNull: false
    },
    descripcion: {
        type: DataTypes.TEXT
    },
    precio: {
        type: DataTypes.DECIMAL(10, 2), // 10 dígitos, 2 decimales
        allowNull: false
    },
    descuento: {
        type: DataTypes.INTEGER,
        defaultValue: 0, // Por defecto 0% de descuento
        validate: {
            min: 0,
            max: 100 // No puedes descontar más del 100%
        }
    },
    stock: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    imagen: {
        type: DataTypes.STRING, // URL de la imagen
        defaultValue: 'https://www.tempra.com.mx/static/754245cbb05fab5a0992a38575208e59/ec333/tempra-500mg-20t_i.png'
    },
    requiere_receta: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
    // categoriaId se agrega automáticamente en las relaciones
});

module.exports = Producto;