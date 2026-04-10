require('dotenv').config();
const mongoose = require('mongoose');
const { connect } = require('../config/mongoose');
const User = require('../models-mongo/user');
const Producto = require('../models-mongo/product');
const Pedido = require('../models-mongo/pedido');

async function cleanDatabase() {
  try {
    await connect();
    await Promise.all([
      Pedido.deleteMany({}),
      Producto.deleteMany({}),
      User.deleteMany({})
    ]);
    console.log('Limpieza completada');
  } catch (error) {
    console.error(error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

cleanDatabase();
