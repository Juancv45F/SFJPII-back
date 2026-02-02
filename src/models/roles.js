const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Roles = sequelize.define('Role', {
    nombre: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    descripcion: {
        type: DataTypes.STRING
    }
}, { timestamps: false }); // No necesitamos createdAt/updatedAt para roles fijos

module.exports = Roles;