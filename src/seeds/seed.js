const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');
const { Role, User, Ubicacion, Categoria, Producto, Pedido, DetallePedido } = require('../models');

const seedDatabase = async () => {
    try {
        // force: true BORRA toda la base de datos y la crea de nuevo.
        await sequelize.sync({ force: true });
        console.log('>>>  Base de datos limpiada y tablas recreadas.');

        // ----------------------------------------------------------------------
        // 1. CREAR ROLES
        // ----------------------------------------------------------------------
        const rolAdmin = await Role.create({ nombre: 'admin', descripcion: 'Control total del sistema' });
        const rolCliente = await Role.create({ nombre: 'cliente', descripcion: 'Comprador' });
        const rolRepartidor = await Role.create({ nombre: 'repartidor', descripcion: 'Encargado de entregas' });
        console.log('Roles creados.');

        // ----------------------------------------------------------------------
        // 2. CREAR USUARIOS
        // ----------------------------------------------------------------------
        const salt = await bcrypt.genSalt(10);
        
        // --- Usuario Administrador ---
        const passAdmin = await bcrypt.hash('Admin123', salt);
        const admin = await User.create({
            nombre: 'Juan Pablo',
            apellido: 'Admin',
            telefono: '4951065080', // Teléfono Admin
            password: passAdmin,
            rolId: rolAdmin.id,
            isVerified: true
        });

        // --- Usuario Cliente ---
        const passCliente = await bcrypt.hash('Cliente123', salt);
        const cliente = await User.create({
            nombre: 'Maria',
            apellido: 'Lopez',
            telefono: '4499998877', // Teléfono Cliente ficticio
            password: passCliente,
            rolId: rolCliente.id,
            isVerified: true
        });
        console.log('Usuarios creados (Admin y Cliente).');

        // ----------------------------------------------------------------------
        // 3. CREAR UBICACIONES (Contexto Villa Hidalgo)
        // ----------------------------------------------------------------------
        const ubicacionCasa = await Ubicacion.create({
            calle: 'Calle Morelos',
            numero: '123',
            codigo_postal: '47250',
            descripcion: 'Casa color verde frente al parque, Villa Hidalgo.',
            alias: 'Casa',
            userId: cliente.id
        });
        
        const ubicacionTrabajo = await Ubicacion.create({
            calle: 'Av. Industria Textil',
            numero: '500-B',
            codigo_postal: '47250',
            descripcion: 'Local 4, Plaza Textil.',
            alias: 'Trabajo',
            userId: cliente.id
        });
        console.log('Ubicaciones creadas.');

        // ----------------------------------------------------------------------
        // 4. CREAR CATEGORÍAS
        // ----------------------------------------------------------------------
        const catFarmacia = await Categoria.create({ nombre: 'Farmacia', activa: true });
        const catBebes = await Categoria.create({ nombre: 'Bebés', activa: true });
        const catHigiene = await Categoria.create({ nombre: 'Higiene y Belleza', activa: true });
        const catOfertas = await Categoria.create({ nombre: 'Ofertas Temporada', activa: true });
        console.log('Categorías creadas.');

        // ----------------------------------------------------------------------
        // 5. CREAR PRODUCTOS (Con Descuentos)
        // ----------------------------------------------------------------------
        const productos = await Producto.bulkCreate([
            {
                nombre: 'Paracetamol 500mg',
                descripcion: 'Analgésico para alivio de fiebre y dolor leve. Caja 10 tabs.',
                precio: 25.00,
                descuento: 0,
                stock: 100,
                imagen: 'https://www.tempra.com.mx/static/754245cbb05fab5a0992a38575208e59/ec333/tempra-500mg-20t_i.png',
                requiere_receta: false,
                categoriaId: catFarmacia.id
            },
            {
                nombre: 'Amoxicilina 500mg',
                descripcion: 'Antibiótico de amplio espectro. Requiere receta.',
                precio: 85.50,
                descuento: 0,
                stock: 50,
                imagen: 'https://cdn-icons-png.flaticon.com/512/883/883356.png',
                requiere_receta: true,
                categoriaId: catFarmacia.id
            },
            {
                nombre: 'Pañales BioBaby Etapa 3',
                descripcion: 'Pañales ecológicos, paquete de 40 piezas.',
                precio: 250.00,
                descuento: 10, // 10% de descuento
                stock: 30,
                imagen: 'https://cdn-icons-png.flaticon.com/512/2257/2257662.png',
                requiere_receta: false,
                categoriaId: catBebes.id
            },
            {
                nombre: 'Shampoo Tío Nacho',
                descripcion: 'Jalea Real aclarante. Botella 415ml.',
                precio: 95.00,
                descuento: 15, // 15% de descuento
                stock: 20,
                imagen: 'https://cdn-icons-png.flaticon.com/512/2553/2553644.png',
                requiere_receta: false,
                categoriaId: catHigiene.id
            },
            {
                nombre: 'Electrolit Uva',
                descripcion: 'Suero rehidratante oral 625ml.',
                precio: 28.00,
                descuento: 0,
                stock: 200,
                imagen: 'https://cdn-icons-png.flaticon.com/512/3050/3050257.png',
                requiere_receta: false,
                categoriaId: catFarmacia.id
            }
        ]);
        console.log('Productos creados.');

        // ----------------------------------------------------------------------
        // 6. CREAR UN PEDIDO DE PRUEBA (Historial)
        // ----------------------------------------------------------------------
        // Supongamos que María compró hace 2 días
        const pedidoPrueba = await Pedido.create({
            fecha: new Date(new Date().setDate(new Date().getDate() - 2)), // Hace 2 días
            total: 345.00,
            estado: 'entregado',
            metodo_pago: 'efectivo',
            userId: cliente.id,
            ubicacionId: ubicacionCasa.id
        });

        // Detalles del pedido (Compró 1 Shampoo y 1 Paquete de Pañales)
        await DetallePedido.bulkCreate([
            {
                cantidad: 1,
                precio_unitario: 95.00, // Precio histórico
                subtotal: 95.00,
                pedidoId: pedidoPrueba.id,
                productoId: 4 // Shampoo
            },
            {
                cantidad: 1,
                precio_unitario: 250.00,
                subtotal: 250.00,
                pedidoId: pedidoPrueba.id,
                productoId: 3 // Pañales
            }
        ]);

        console.log('Pedido de prueba creado (Historial).');

        console.log('==============================================');
        console.log('🚀  BASE DE DATOS LISTA PARA USARSE');
        console.log('    Admin Tel: 4951065080 | Pass: Admin123');
        console.log('    Cliente Tel: 4499998877 | Pass: Cliente123');
        console.log('==============================================');

    } catch (error) {
        console.error('❌ Error fatal al sembrar la BD:', error);
    }
};

seedDatabase();