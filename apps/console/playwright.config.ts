import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',workers:1,fullyParallel:false,timeout:45000,retries:0,reporter:'./e2e/safe-reporter.ts',use:{baseURL:'http://127.0.0.1:4320',headless:true,trace:'off',screenshot:'off',video:'off'}});
