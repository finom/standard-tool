# Security policy

## Supported versions

The latest published `0.x` release is supported. This project is an RFC; the interface is frozen for `V0`, and the reference package may still change.

## Reporting a vulnerability

Report privately through GitHub's [security advisory form](https://github.com/finom/standard-tool/security/advisories/new). Please do not open a public issue.

The package has no runtime dependencies and performs no I/O, so its attack surface is limited to schema validation of untrusted input.
