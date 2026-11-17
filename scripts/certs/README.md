# Extra CA certificates for CI

Public certificates only. Nothing here is secret.

## `sectigo-dv-r36.pem`

The **Sectigo Public Server Authentication CA DV R36** intermediate. It's issued by
Sectigo Public Server Authentication Root R46, is valid until 2036, and has SHA-256
fingerprint `8C:54:C3:34:B6:6B:A4:E4:26:77:2A:F4:A3:F9:13:6C:19:A1:AE:C7:29:FD:B2:8C:53:5C:07:A5:A4:EF:22:E0`.
It was downloaded from the CA's own URL, `http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt`.

**Why it's here:** `www.casablanca-bourse.com` (the dividend calendar source)
sends its certificate *without* this intermediate. Browsers fetch the missing
link themselves, but Node doesn't, so `scripts/fetch-prices.mjs` failed with
`unable to verify the first certificate`. `.github/workflows/fetch-prices.yml`
passes this file to Node through `NODE_EXTRA_CA_CERTS`. That completes the chain
and keeps full TLS verification on; it does **not** disable certificate checks.

If the site moves to a different CA, the dividend step logs the TLS error again
(`dividend calendar skipped - request failed: ...`). Replace this file with the
new intermediate, which you can download from the URL in the site certificate's
"CA Issuers" field.
