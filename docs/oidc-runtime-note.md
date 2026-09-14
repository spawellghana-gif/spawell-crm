# Vercel OIDC runtime note

Production Google Data Manager authentication uses `@vercel/oidc` and `getVercelOidcToken()` from the Vercel Function request context. Do not read a browser request header for the deployment OIDC token and do not persist the token.

Always call the SDK before reading any environment fallback. The SDK prioritizes
the current function context and handles token refresh. A copied build or local
development token must not override the production function identity.

If Google rejects an attribute condition, the error includes only an allowlist of
identity metadata: owner ID, project ID, environment, and a conventional Vercel
subject. These are unverified diagnostic claims, not an authorization decision.
The encoded token, its signature, other claims, and customer identifiers are never
included. Compare those fields with the existing provider condition before making
an IAM change; do not remove the condition or grant the entire pool access.
