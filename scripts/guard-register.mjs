import { register } from 'node:module';
register('./guard-resolve.mjs', import.meta.url);
register('./guard-ts-loader.mjs', import.meta.url);
