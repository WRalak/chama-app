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
// Billing: test keys only, so webhook authentication can be checked without any network call.
process.env.PAYSTACK_SECRET_KEY = 'sk_test_chamahub_dummy_key';
process.env.BILLING_WEBHOOK_TOKEN = 'test-billing-webhook-token-0123456789';
process.env.BILLING_MPESA_CONSUMER_KEY = '';
// Most suites test other things; the platform suite turns two-step enforcement on where it tests it.
process.env.PLATFORM_REQUIRE_MFA = 'false';
