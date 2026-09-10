# Vercel OIDC runtime note

Production Google Data Manager authentication uses `@vercel/oidc` and `getVercelOidcToken()` from the Vercel Function request context. Do not read a browser request header for the deployment OIDC token and do not persist the token.
