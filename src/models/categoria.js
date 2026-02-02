const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Categoria = sequelize.define('Categoria', {
    nombre: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    activa: {
        type: DataTypes.BOOLEAN,
        defaultValue: true // Para ocultar una categoría entera temporalmente
    }
}, { timestamps: false });

module.exports = Categoria;