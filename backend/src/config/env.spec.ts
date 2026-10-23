import { env, resetEnvCache } from './env';

describe('production configuration guards', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
  });
  const prod = (origins: string) => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = origins;
    process.env.DEV_LOG_OTP = 'false';
    delete process.env.DISABLE_THROTTLE;
    resetEnvCache();
    return () => env();
  };

  it('rejects wildcard, http and path CORS origins in production', () => {
    expect(prod('*')).toThrow(/CORS_ORIGINS/);
    expect(prod('http://app.chamahub.ke')).toThrow(/CORS_ORIGINS/);
    expect(prod('https://app.chamahub.ke/path')).toThrow(/CORS_ORIGINS/);
    expect(prod('https://*.chamahub.ke')).toThrow(/CORS_ORIGINS/);
  });

  it('accepts exact https origins in production', () => {
    expect(() => prod('https://app.chamahub.ke, https://admin.chamahub.ke')()).not.toThrow();
  });
});
