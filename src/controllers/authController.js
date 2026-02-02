const { sequelize } = require('../config/database');
const { User, Ubicacion, Role } = require('../models');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const jwt = require('jsonwebtoken');

// REGISTRO COMPLETO (Usuario + Ubicación + Captcha)
const register = async (req, res) => {
    // Iniciamos una transacción (seguridad de datos)
    const t = await sequelize.transaction();

    try {
        // Recibimos los datos estructurados desde el Frontend
        const { 
            nombre, 
            apellido, 
            telefono, 
            password, 
            ubicacion, // Esto será un objeto { calle, numero, codigo_postal, descripcion, alias }
            recaptchaToken 
        } = req.body;

        // --- VALIDACIÓN CAPTCHA ---
        if (!recaptchaToken) {
            await t.rollback();
            return res.status(400).json({ message: 'Falta el captcha' });
        }

        const secretKey = process.env.RECAPTCHA_SECRET_KEY;
        const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${recaptchaToken}`;
        
        // Descomentar para producción:
        // const googleResponse = await axios.post(verifyUrl);
        // if (!googleResponse.data.success) {
        //     await t.rollback();
        //     return res.status(400).json({ message: 'Captcha inválido' });
        // }
        // -----------------------------

        // --- VALIDAR DUPLICADOS ---
        const existingUser = await User.findOne({ where: { telefono } });
        if (existingUser) {
            await t.rollback();
            return res.status(400).json({ message: 'Este teléfono ya está registrado.' });
        }

        // --- PREPARAR DATOS ---
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const smsCode = Math.floor(100000 + Math.random() * 900000).toString();

        // Buscar el ID del rol "cliente"
        const roleCliente = await Role.findOne({ where: { nombre: 'cliente' } });
        if (!roleCliente) {
            await t.rollback();
            return res.status(500).json({ message: 'Error interno: No existe el rol cliente.' });
        }

        // --- CREAR USUARIO (Dentro de la transacción) ---
        const newUser = await User.create({
            nombre,
            apellido,
            telefono,
            password: hashedPassword,
            verificationCode: smsCode,
            isVerified: false,
            rolId: roleCliente.id
        }, { transaction: t });

        // --- CREAR UBICACIÓN (Vinculada al nuevo ID) ---
        // Asumimos que "ubicacion" viene del formulario de pasos
        await Ubicacion.create({
            calle: ubicacion.calle,
            numero: ubicacion.numero,
            codigo_postal: ubicacion.codigo_postal,
            descripcion: ubicacion.descripcion, // "Casa portón negro..."
            alias: ubicacion.alias || 'Principal',
            userId: newUser.id // Aquí hacemos la relación
        }, { transaction: t });

        // --- CONFIRMAR TRANSACCIÓN ---
        await t.commit();

        // --- SIMULACIÓN SMS ---
        console.log('=============================================');
        console.log(`✉️  [SMS GATEWAY] Mensaje para ${telefono}:`);
        console.log(`🔐  Tu código de verificación es: ${smsCode}`);
        console.log('=============================================');

        res.status(201).json({
            message: 'Registro exitoso. Se ha enviado el código SMS.',
            userId: newUser.id
        });

    } catch (error) {
        // Si algo falla, deshacemos todo (no se crea usuario ni ubicación)
        await t.rollback();
        console.error(error);
        res.status(500).json({ message: 'Error en el servidor al registrar.' });
    }
};

// VERIFICACIÓN DE CÓDIGO (Igual que antes)
const verifyCode = async (req, res) => {
    try {
        const { telefono, code } = req.body;

        const user = await User.findOne({ where: { telefono } });

        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

        if (user.verificationCode !== code) {
            return res.status(400).json({ message: 'Código incorrecto' });
        }

        // Activar usuario
        user.isVerified = true;
        user.verificationCode = null; // Limpiar código para seguridad
        await user.save();

        res.status(200).json({
            message: '¡Verificación exitosa! Ya puedes iniciar sesión.',
            isVerified: true
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al verificar.' });
    }
};

// LOGIN (Para entrar después de verificar)
const login = async (req, res) => {
    try {
        const { telefono, password } = req.body;

        // Buscar usuario e incluir su Rol
        const user = await User.findOne({ 
            where: { telefono },
            include: [{ model: Role }] 
        });

        if (!user) return res.status(400).json({ message: 'Credenciales inválidas' });

        // Verificar si ya confirmó su SMS
        if (!user.isVerified) {
            return res.status(403).json({ message: 'Debes verificar tu teléfono primero.' });
        }

        // Verificar contraseña
        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(400).json({ message: 'Credenciales inválidas' });

        // --- GENERACIÓN DEL JWT ---
        // Payload: Datos que van encriptados dentro del token
        const payload = {
            uid: user.id,
            nombre: user.nombre,
            rol: user.Role ? user.Role.nombre : 'cliente' // Por seguridad
        };

        // Firmar el token (Expira en 4 horas)
        const token = jwt.sign(
            payload, 
            process.env.JWT_SECRET, 
            { expiresIn: '4h' }
        );
        // ----------------------------------

        res.json({
            message: 'Bienvenido',
            token, // <--- Aquí enviamos el "pase" al Frontend
            user: {
                id: user.id,
                nombre: user.nombre,
                rol: user.Role ? user.Role.nombre : 'cliente'
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el login' });
    }
};

module.exports = {
    register,
    verifyCode,
    login
};