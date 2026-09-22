import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false,
  globalTeardown: './tests/e2e/teardown.ts',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/build.mjs test && node scripts/serve.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false, env: { CONDUIT_TEST_SERVER: '1' } },
  projects: [ { name:'desktop',use:{viewport:{width:1280,height:900}} }, { name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true} } ]
});
