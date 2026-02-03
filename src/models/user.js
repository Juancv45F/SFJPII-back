const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Role = require('./roles'); // Importamos para relacionar

const User = sequelize.define('User', {
    nombre: { type: DataTypes.STRING, allowNull: false },
    apellido: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    foto_perfil: { type: DataTypes.STRING },
    verificationCode: { type: DataTypes.STRING },
    isVerified: { type: DataTypes.BOOLEAN, defaultValue: false }
});

module.exports = User;
