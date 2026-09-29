import { defineConfig } from '@playwright/test'
export default defineConfig({
 testDir:'./tests',fullyParallel:false,workers:1,timeout:45000,
 expect:{timeout:10000},reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL:process.env.EDUOS_TEST_URL||'http://localhost:8080',headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
})
