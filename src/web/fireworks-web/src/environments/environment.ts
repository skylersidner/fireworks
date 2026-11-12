// Empty base URL: every API call is a relative, same-origin path. In development that works
// because proxy.conf.json forwards /api and /health to the API on 5180; in production the API
// serves the built app from its own wwwroot. There is deliberately no environment.prod.ts and no
// fileReplacements: with a same-origin deployment there is nothing environment-specific to replace.
export const environment = {
  apiBaseUrl: '',
};
