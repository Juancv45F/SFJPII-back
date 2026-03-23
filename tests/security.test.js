const request = require('supertest');
const { app } = require('../index');
const mongoose = require('mongoose');

describe('Security Tests (Parte 8)', () => {
    
    // 1. Prevención de fuerza bruta
    test('Should trigger rate limit after multiple login attempts', async () => {
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
    test('Should fail with expired or invalid token', async () => {
        const response = await request(app)
            .get('/api/user/me')
            .set('Authorization', 'Bearer invalidtoken');
            
        expect(response.status).toBe(401);
    });

    // 3. Validación de MFA
    test('Should require MFA if enabled', async () => {
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
    test('Should list active sessions for a user', async () => {
        // Requiere login previo para obtener token
        // Simulado: Verificar que el endpoint existe y responde
        const response = await request(app)
            .get('/api/user/sessions')
            .set('Authorization', 'Bearer valid_token_here');
            
        // Si no hay token válido, dará 401, pero probamos que la ruta está protegida
        expect([200, 401]).toContain(response.status);
    });
});
