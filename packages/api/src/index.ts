#!/usr/bin/env npx ts-node
/* eslint-disable @typescript-eslint/no-require-imports */

const { createMobileUpdateServerApp } = require('./app');
const app = createMobileUpdateServerApp();
app.run();
