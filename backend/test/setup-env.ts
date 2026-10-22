process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://chamahub:chamahub@localhost:5432/chamahub_test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-test-access-secret-0123';
process.env.OTP_SECRET = 'test-otp-secret-test-otp-secret-test-012345';
process.env.DEV_LOG_OTP = 'false';
process.env.DISABLE_JOBS = 'true';
process.env.AT_USERNAME = '';
process.env.AT_API_KEY = '';
process.env.MPESA_CONSUMER_KEY = '';
process.env.DISABLE_THROTTLE = 'true';
// Tests never call a real AI provider; they script one where needed.
process.env.ANTHROPIC_API_KEY = '';
