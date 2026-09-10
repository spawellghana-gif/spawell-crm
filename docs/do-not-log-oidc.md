# OIDC token handling

The Vercel OIDC token is short lived and must not be logged, persisted, committed, or returned to the browser. Runtime code obtains it through `@vercel/oidc` only when a Google token exchange is needed.
