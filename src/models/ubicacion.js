const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('./user');

const Ubicacion = sequelize.define('Ubicacion', {
    calle: { type: DataTypes.STRING, allowNull: false },
    numero: { type: DataTypes.STRING, allowNull: false },
    codigo_postal: { type: DataTypes.STRING, allowNull: false },
    descripcion: { type: DataTypes.TEXT }, // TEXT por si escriben mucho
    alias: { type: DataTypes.STRING, defaultValue: 'Casa' } // Casa, Trabajo, etc.
});

module.exports = Ubicacion;