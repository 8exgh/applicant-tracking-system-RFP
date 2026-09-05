// The app connects as a non-superuser role so row-level security applies (F26)
process.env.TEST_ADMIN_DATABASE_URL = process.env.TEST_ADMIN_DATABASE_URL || 'postgres://ats:ats@localhost:5439/ats';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://ats_app:ats@localhost:5439/ats';
process.env.ATS_MASTER_KEY = process.env.ATS_MASTER_KEY || 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.JWT_SECRET = 'test-jwt-secret-test-jwt-secret';
process.env.BACKGROUND_PROCESSOR_API_KEY = 'test-api-key';
process.env.PLATFORM_OPERATOR_EMAIL = 'operator@8examples.test';
process.env.PLATFORM_OPERATOR_PASSWORD = 'operator-password-123';
process.env.ATS_FAKE_CLOCK = '1';
process.env.ATS_EXPOSE_MAGIC_LINKS = '1';
process.env.APP_BASE_URL = 'http://ats.test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';
