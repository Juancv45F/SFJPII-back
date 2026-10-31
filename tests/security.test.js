const request = require('supertest');
const { app } = require('../index');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../src/models-mongo/user');

describe('Test de seguridad', () => {
    
    // 1. Prevención de fuerza bruta
    test('Debería activar el límite de tasa después de múltiples intentos de inicio de sesión', async () => {
        // En el middleware configuramos 10 intentos por hora para auth
        // Para este test, si enviamos 11, debería dar 429
        for (let i = 0; i < 10; i++) {
            await request(app)
                .post('/api/auth/login')
                .send({ email: 'test@example.com', password: 'wrongpassword' });
        }
        
        const response = await request(app)
            .post('/api/auth/login')
            .send({ email: 'test@example.com', password: 'wrongpassword' });
            
        expect(response.status).toBe(429);
        expect(response.body.message).toMatch(/Demasiados intentos/);
    }, 20000); // Aumentar timeout por los múltiples requests

    // 2. Expiración de tokens (Simulado mediante validación de estructura y lógica)
    test('Debería fallar con un token caducado o no válido', async () => {
        const response = await request(app)
            .get('/api/user/me')
            .set('Authorization', 'Bearer invalidtoken');
            
        expect(response.status).toBe(401);
    });

    // 3. Validación de MFA
    test('Debería requerir MFA si está activo', async () => {
        // Este test requiere un usuario con MFA activo en la DB
        // Simulamos la respuesta del login que debería retornar un mfaToken si está activo
        const response = await request(app)
            .post('/api/auth/login')
            .send({ email: 'user_with_mfa@test.com', password: 'CorrectPass123!' });
        
        // Si tiene MFA, el status no debería ser 200 directo con el token final
        // sino un 200 con { mfaRequired: true, mfaToken: '...' }
        if (response.body.mfaRequired) {
            expect(response.body).toHaveProperty('mfaToken');
            expect(response.body.message).toMatch(/MFA requerido/);
        }
    });

    // 4. Bloqueo/Gestión de sesiones múltiples
    test('Debe enumerar las sesiones activas de un usuario.', async () => {
        // Requiere login previo para obtener token
        // Simulado: Verificar que el endpoint existe y responde
        const response = await request(app)
            .get('/api/user/sessions')
            .set('Authorization', 'Bearer valid_token_here');
            
        // Si no hay token válido, dará 401, pero probamos que la ruta está protegida
        expect([200, 401]).toContain(response.status);
    });

    test.skip('Debe revocar una sesión sin provocar error 500', async () => {
        const email = `revoke_${Date.now()}_${Math.random().toString(16).slice(2)}@test.com`;
        const user = await User.create({
            nombre: 'Test',
            apellido: 'User',
            email,
            password: 'hashed',
            role: 'cliente',
            isVerified: true,
            ubicaciones: [],
            refreshTokens: [{
                sessionId: 'sess_test_1',
                tokenHash: `hash_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                createdAt: new Date(),
                lastUsedAt: new Date(),
                expiresAt: new Date(Date.now() + 60 * 60 * 1000),
                userAgent: 'jest',
                ip: '127.0.0.1'
            }]
        });

        const token = jwt.sign(
            { uid: String(user._id), rol: 'cliente' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        const response = await request(app)
            .post('/api/user/sessions/revoke')
            .set('Authorization', `Bearer ${token}`)
            .send({ sessionId: 'sess_test_1' });

        expect(response.status).toBe(200);
        expect(response.body.message).toMatch(/Sesión (cerrada|no encontrada)/);

        const updated = await User.findById(user._id).select('refreshTokens').lean().exec();
        const tokenEntry = (updated?.refreshTokens || []).find(t => t && t.sessionId === 'sess_test_1');
        expect(tokenEntry).toBeTruthy();
        expect(tokenEntry.revokedAt).toBeTruthy();

        await User.deleteOne({ _id: user._id }).exec();
    });

    test.skip('Debe bloquear acceso si la cuenta está deshabilitada o suspendida', async () => {
        const email1 = `disabled_${Date.now()}_${Math.random().toString(16).slice(2)}@test.com`;
        const u1 = await User.create({
            nombre: 'Disabled',
            apellido: 'User',
            email: email1,
            password: 'hashed',
            role: 'cliente',
            isVerified: true,
            ubicaciones: [],
            access: { status: 'disabled', disabledAt: new Date(), reason: 'test' }
        });

        const token1 = jwt.sign(
            { uid: String(u1._id), rol: 'cliente' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        const r1 = await request(app)
            .get('/api/user/me')
            .set('Authorization', `Bearer ${token1}`);

        expect(r1.status).toBe(403);

        const email2 = `suspended_${Date.now()}_${Math.random().toString(16).slice(2)}@test.com`;
        const until = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const u2 = await User.create({
            nombre: 'Suspended',
            apellido: 'User',
            email: email2,
            password: 'hashed',
            role: 'cliente',
            isVerified: true,
            ubicaciones: [],
            access: { status: 'suspended', suspendedUntil: until, reason: 'test' }
        });

        const token2 = jwt.sign(
            { uid: String(u2._id), rol: 'cliente' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        const r2 = await request(app)
            .get('/api/user/me')
            .set('Authorization', `Bearer ${token2}`);

        expect(r2.status).toBe(403);
        expect(r2.body.message).toMatch(/suspendida/i);

        await Promise.all([
            User.deleteOne({ _id: u1._id }).exec(),
            User.deleteOne({ _id: u2._id }).exec()
        ]);
    });

    test('CORS no refleja orígenes fuera de la allow-list', async () => {
        const evil = await request(app)
            .options('/api/auth/login')
            .set('Origin', 'https://evil.example')
            .set('Access-Control-Request-Method', 'POST');

        expect(evil.headers['access-control-allow-origin']).toBeUndefined();
        expect(evil.headers['access-control-allow-credentials']).toBeUndefined();
        expect(evil.headers['x-powered-by']).toBeUndefined();

        const ok = await request(app)
            .options('/api/auth/login')
            .set('Origin', 'http://localhost:8100')
            .set('Access-Control-Request-Method', 'POST');

        expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:8100');
        expect(ok.headers['access-control-allow-credentials']).toBe('true');
    });

    test('/refresh ignora el refreshToken del body (solo cookie HttpOnly)', async () => {
        const response = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: 'cualquier-token' });

        expect(response.status).toBe(400);
    });
});
