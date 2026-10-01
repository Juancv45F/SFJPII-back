describe('service keep alive', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, NODE_ENV: 'test' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('builds the health URL without duplicate slashes', () => {
    const { healthUrl } = require('../src/services/serviceKeepAlive');
    expect(healthUrl('https://sfjpii-ai.onrender.com/')).toBe('https://sfjpii-ai.onrender.com/health');
  });

  test('uses a 13 minute default interval', () => {
    const { DEFAULT_INTERVAL_MS } = require('../src/services/serviceKeepAlive');
    expect(DEFAULT_INTERVAL_MS).toBe(13 * 60 * 1000);
  });
});
