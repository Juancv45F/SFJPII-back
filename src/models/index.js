const Role = require('./roles');
const User = require('./user');
const Ubicacion = require('./ubicacion');
const Categoria = require('./categoria');
const Producto = require('./producto');
const Pedido = require('./pedido');
const DetallePedido = require('./detallePedido');

// --- RELACIONES DE USUARIO ---
// Rol <-> Usuario
Role.hasMany(User, { foreignKey: 'roleId' });
User.belongsTo(Role, { foreignKey: 'roleId' });

// Usuario <-> Ubicación
User.hasMany(Ubicacion, { foreignKey: 'userId' });
Ubicacion.belongsTo(User, { foreignKey: 'userId' });

// --- RELACIONES DE PRODUCTO ---
// Categoría <-> Producto
Categoria.hasMany(Producto, { foreignKey: 'categoriaId' });
Producto.belongsTo(Categoria, { foreignKey: 'categoriaId' });

// --- RELACIONES DE PEDIDOS ---
// Usuario <-> Pedido (Un usuario hace muchos pedidos)
User.hasMany(Pedido, { foreignKey: 'userId' });
Pedido.belongsTo(User, { foreignKey: 'userId' });

// Ubicación <-> Pedido (Un pedido se envía a una ubicación específica)
Ubicacion.hasMany(Pedido, { foreignKey: 'ubicacionId' });
Pedido.belongsTo(Ubicacion, { foreignKey: 'ubicacionId' });

// Pedido <-> Producto (Muchos a Muchos a través de DetallePedido)
Pedido.belongsToMany(Producto, { through: DetallePedido, foreignKey: 'pedidoId' });
Producto.belongsToMany(Pedido, { through: DetallePedido, foreignKey: 'productoId' });

// Para poder hacer consultas directas al detalle
Pedido.hasMany(DetallePedido, { foreignKey: 'pedidoId' });
DetallePedido.belongsTo(Pedido, { foreignKey: 'pedidoId' });

// --- RELACIONES DE DETALLE <-> PRODUCTO ---

// Un detalle pertenece a un producto
DetallePedido.belongsTo(Producto, { foreignKey: 'productoId' });

// Un producto puede estar en muchos detalles
Producto.hasMany(DetallePedido, { foreignKey: 'productoId' });

module.exports = {
    Role,
    User,
    Ubicacion,
    Categoria,
    Producto,
    Pedido,
    DetallePedido
};