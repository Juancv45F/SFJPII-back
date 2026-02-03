const { sequelize } = require('../config/database');
const { User, Ubicacion, Role } = require('../models');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isStrongPassword = (v) => v && v.length >= 8 && /[A-Z]/.test(v) && /\d/.test(v) && /[\W_]/.test(v);
const sanitize = (v) => typeof v === 'string' ? v.trim() : v;
const isNonEmpty = (v) => typeof v === 'string' ? v.trim().length > 0 : v !== undefined && v !== null;
const isLettersSpaces = (v) => /^[A-Za-zÀ-ÖØ-öø-ÿ\s]+$/.test(v);
// REGISTRO COMPLETO (Usuario + Ubicación + Captcha)
const register = async (req, res) => {
    // Iniciamos una transacción (seguridad de datos)
    const t = await sequelize.transaction();

    try {
        // Recibimos los datos estructurados desde el Frontend
        let { nombre, apellido, email, password, confirmPassword, ubicacion, recaptchaToken } = req.body;
        nombre = sanitize(nombre);
        apellido = sanitize(apellido);
        email = sanitize(email);
        password = sanitize(password);
        confirmPassword = sanitize(
            confirmPassword ??
            req.body?.confirm_password ??
            req.body?.password2 ??
            req.body?.passwordConfirmation ??
            req.body?.confirm
        );
        if (!isNonEmpty(nombre) || !isNonEmpty(apellido) || !isNonEmpty(email) || !isNonEmpty(password) || !ubicacion) {
            await t.rollback();
            return res.status(400).json({ message: 'Campos requeridos faltantes.' });
        }
        if (!isLettersSpaces(nombre) || !isLettersSpaces(apellido)) {
            await t.rollback();
            return res.status(400).json({ message: 'Nombre y apellido inválidos.' });
        }
        if (!isEmail(email)) {
            await t.rollback();
            return res.status(400).json({ message: 'Correo inválido.' });
        }
        if (!isStrongPassword(password)) {
            await t.rollback();
            return res.status(400).json({ message: 'La contraseña no cumple los requisitos.' });
        }
        if (isNonEmpty(confirmPassword) && password !== confirmPassword) {
            await t.rollback();
            return res.status(400).json({ message: 'Las contraseñas no coinciden.' });
        }
        if (!ubicacion.calle || !ubicacion.numero || !ubicacion.codigo_postal) {
            await t.rollback();
            return res.status(400).json({ message: 'Ubicación incompleta.' });
        }
        ubicacion.calle = sanitize(ubicacion.calle);
        ubicacion.numero = sanitize(ubicacion.numero);
        ubicacion.codigo_postal = sanitize(ubicacion.codigo_postal);
        ubicacion.descripcion = sanitize(ubicacion.descripcion || '');
        ubicacion.alias = sanitize(ubicacion.alias || 'Principal');
        if (!isNonEmpty(ubicacion.calle) || !isNonEmpty(ubicacion.numero) || !isNonEmpty(ubicacion.codigo_postal)) {
            await t.rollback();
            return res.status(400).json({ message: 'Ubicación inválida.' });
        }

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
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            await t.rollback();
            return res.status(400).json({ message: 'Este correo ya está registrado.' });
        }

        // --- PREPARAR DATOS ---
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const emailCode = Math.floor(100000 + Math.random() * 900000).toString();

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
            email,
            password: hashedPassword,
            verificationCode: emailCode,
            isVerified: false,
            rolId: roleCliente.id
        }, { transaction: t });

        // --- CREAR UBICACIÓN (Vinculada al nuevo ID) ---
        // Asumimos que "ubicacion" viene del formulario de pasos
        await Ubicacion.create({
            calle: ubicacion.calle,
            numero: ubicacion.numero,
            codigo_postal: ubicacion.codigo_postal,
            descripcion: ubicacion.descripcion,
            alias: ubicacion.alias || 'Principal',
            userId: newUser.id
        }, { transaction: t });

        // --- CONFIRMAR TRANSACCIÓN ---
        await t.commit();

        // Envío de correo
        let sentByEmail = false;
        try {
            if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: Number(process.env.SMTP_PORT) || 587,
                    secure: false,
                    auth: {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS
                    }
                });

                await transporter.sendMail({
                    from: process.env.FROM_EMAIL || process.env.SMTP_USER,
                    to: email,
                    subject: 'Código de verificación',
                    text: `Tu código de verificación es: ${emailCode}`
                });
                sentByEmail = true;
            }
        } catch (mailError) {
            sentByEmail = false;
        }

        if (!sentByEmail) {
            console.log('=============================================');
            console.log(`✉️  [EMAIL SIMULADO] Mensaje para ${email}:`);
            console.log(`🔐  Tu código de verificación es: ${emailCode}`);
            console.log('=============================================');
        }

        res.status(201).json({
            message: sentByEmail
                ? 'Registro exitoso. Revisa tu correo para el código.'
                : 'Registro exitoso. Código de verificación simulado en servidor.',
            userId: newUser.id
        });

    } catch (error) {
        // Si algo falla, deshacemos todo (no se crea usuario ni ubicación)
        await t.rollback();
        console.error(error);
        res.status(500).json({ message: 'Error en el servidor al registrar.' });
    }
};

// VERIFICACIÓN DE CÓDIGO 
const verifyCode = async (req, res) => {
    try {
        let { email, code } = req.body;
        email = sanitize(email);
        code = sanitize(code);
        if (!isEmail(email) || !isNonEmpty(code)) {
            return res.status(400).json({ message: 'Datos inválidos.' });
        }

        const user = await User.findOne({ where: { email } });

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
        let { email, password } = req.body;
        email = sanitize(email);
        password = sanitize(password);
        if (!isEmail(email) || !isNonEmpty(password)) {
            return res.status(400).json({ message: 'Datos inválidos.' });
        }

        // Buscar usuario e incluir su Rol
        const user = await User.findOne({ 
            where: { email },
            include: [{ model: Role }] 
        });

        if (!user) return res.status(400).json({ message: 'Credenciales inválidas' });

        // Verificar si ya confirmó su SMS
        if (!user.isVerified) {
            return res.status(403).json({ message: 'Debes verificar tu correo primero.' });
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
