import { defineConfig } from '@playwright/test'

// CI uses Compose's default 8080; local runs can explicitly select another port or URL.
const baseURL = process.env.EDUOS_TEST_URL || `http://localhost:${process.env.EDUOS_HTTP_PORT || 8080}`
export default defineConfig({
 testDir:'./tests',fullyParallel:false,workers:1,timeout:45000,
 expect:{timeout:10000},reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL,headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
})
