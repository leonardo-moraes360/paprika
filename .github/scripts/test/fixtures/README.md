# Fixtures for `check-actions-pinned.mjs`

These YAML files are inputs for `.github/scripts/test/check-actions-pinned.test.mjs`. Several of
them deliberately reference unpinned actions — that is the point, so the names say what each one
breaks.

Keep them out of any real scan: the checker's default roots are `.github/workflows` and
`.github/actions`, never this directory. The `bad-*` files are not valid runnable workflows either;
only their `uses:` lines matter.
