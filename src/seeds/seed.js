const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { connect } = require('../config/mongoose');
const User = require('../models-mongo/user');
const Producto = require('../models-mongo/product');
const Pedido = require('../models-mongo/pedido');

async function seedDatabase() {
  await connect();
  await Promise.all([Pedido.deleteMany({}), Producto.deleteMany({}), User.deleteMany({})]);
  const salt = await bcrypt.genSalt(10);
  const passSuperAdmin = await bcrypt.hash('SuperAdmin123!', salt);
  const passAdmin = await bcrypt.hash('Admin123', salt);
  const passCliente = await bcrypt.hash('Cliente123', salt);
  await User.create({
    nombre: 'Super',
    apellido: 'Admin',
    email: 'superadmin@sfjpii.local',
    password: passSuperAdmin,
    role: 'super_admin',
    isVerified: true,
    ubicaciones: []
  });
  const admin = await User.create({
    nombre: 'Juan Pablo',
    apellido: 'Admin',
    email: 'admin@sfjpii.local',
    password: passAdmin,
    role: 'admin',
    isVerified: true,
    ubicaciones: []
  });
  const cliente = await User.create({
    nombre: 'Maria',
    apellido: 'Lopez',
    email: 'cliente@sfjpii.local',
    password: passCliente,
    role: 'cliente',
    isVerified: true,
    ubicaciones: [
      { calle: 'Calle Morelos', numero: '123', codigo_postal: '47250', descripcion: 'Casa color verde frente al parque, Villa Hidalgo.', alias: 'Casa' },
      { calle: 'Av. Industria Textil', numero: '500-B', codigo_postal: '47250', descripcion: 'Local 4, Plaza Textil.', alias: 'Trabajo' }
    ]
  });
  const catFarmacia = { _id: new mongoose.Types.ObjectId(), nombre: 'Farmacia', activa: true };
  const catBebes = { _id: new mongoose.Types.ObjectId(), nombre: 'Bebés', activa: true };
  const catHigiene = { _id: new mongoose.Types.ObjectId(), nombre: 'Higiene y Belleza', activa: true };
  const productos = await Producto.create([
    { nombre: 'Paracetamol 500mg', descripcion: 'Analgésico para fiebre y dolor leve. Caja 10 tabs.', precio: 25.0, descuento: 0, stock: 100, imagen: 'https://www.tempra.com.mx/static/754245cbb05fab5a0992a38575208e59/ec333/tempra-500mg-20t_i.png', requiere_receta: false, categoria: catFarmacia },
    { nombre: 'Amoxicilina 500mg', descripcion: 'Antibiótico de amplio espectro. Requiere receta.', precio: 85.5, descuento: 0, stock: 50, imagen: 'https://cdn-icons-png.flaticon.com/512/883/883356.png', requiere_receta: true, categoria: catFarmacia },
    { nombre: 'Pañales BioBaby Etapa 3', descripcion: 'Pañales ecológicos, paquete de 40 piezas.', precio: 250.0, descuento: 10, stock: 30, imagen: 'https://cdn-icons-png.flaticon.com/512/2257/2257662.png', requiere_receta: false, categoria: catBebes },
    { nombre: 'Shampoo Tío Nacho', descripcion: 'Jalea Real aclarante. Botella 415ml.', precio: 95.0, descuento: 15, stock: 20, imagen: 'https://cdn-icons-png.flaticon.com/512/2553/2553644.png', requiere_receta: false, categoria: catHigiene },
    { nombre: 'Electrolit Uva', descripcion: 'Suero rehidratante oral 625ml.', precio: 28.0, descuento: 0, stock: 200, imagen: 'https://cdn-icons-png.flaticon.com/512/3050/3050257.png', requiere_receta: false, categoria: catFarmacia }
  ]);
  const ubic = cliente.ubicaciones[0];
  const items = [
    { productoId: productos[3]._id, nombre: productos[3].nombre, imagen: productos[3].imagen, precio_unitario: productos[3].precio, cantidad: 1, subtotal: productos[3].precio },
    { productoId: productos[2]._id, nombre: productos[2].nombre, imagen: productos[2].imagen, precio_unitario: productos[2].precio, cantidad: 1, subtotal: productos[2].precio }
  ];
  const total = items.reduce((s, i) => s + i.subtotal, 0);
  await Pedido.create({
    fecha: new Date(new Date().setDate(new Date().getDate() - 2)),
    total,
    estado: 'entregado',
    metodo_pago: 'efectivo',
    userId: cliente._id,
    ubicacion: { calle: ubic.calle, numero: ubic.numero, codigo_postal: ubic.codigo_postal, descripcion: ubic.descripcion, alias: ubic.alias },
    items
  });
  console.log('Seed completado');
  await mongoose.disconnect();
}

seedDatabase().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
