import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/ingestion-e2e',globalTeardown:'./tests/ingestion-e2e/teardown.ts',fullyParallel:false,
 use:{baseURL:'http://127.0.0.1:4174',trace:'off'},
 webServer:{command:'node scripts/build-ingestion.mjs && node scripts/serve-ingestion.mjs',url:'http://127.0.0.1:4174',reuseExistingServer:false,env:{INGESTION_SUPABASE_PUBLIC_KEY:'sb_publishable_test_build_only',INGESTION_TURNSTILE_SITE_KEY:'0x4_build_test_only'}},
 projects:[{name:'desktop',use:{viewport:{width:1280,height:900}}},{name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}]
});
