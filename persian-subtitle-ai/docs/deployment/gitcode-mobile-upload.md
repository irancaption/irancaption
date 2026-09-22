# GitCode / AtomGit — Mobile Repository Upload

## Important

GitCode's documented web interface supports online repository file operations, while its documented CLI supports uploading a directory and preserves the directory structure. The web documentation does not state that uploading one `.zip` file automatically extracts it into repository files.

Therefore, do **not** upload the project ZIP as the only repository source and expect GitCode to unpack it automatically.

## Easiest method from Android

1. Download the release ZIP produced for this milestone.
2. Open Android Files / My Files.
3. Extract the ZIP into a normal folder.
4. Open GitCode in Chrome.
5. Open the target repository.
6. Add the extracted project files while preserving the exact paths.
7. Commit to `main`.

The repository root must directly contain:

- `package.json`
- `README.md`
- `apps/`
- `packages/`
- `database/`
- `tests/`
- `docs/`
- `.github/`
- `.gitcode/`

Do **not** create this structure:

```text
repository/
  persian-subtitle-ai-M9/
    package.json
```

The correct structure is:

```text
repository/
  package.json
  README.md
  apps/
  packages/
  database/
```

## GitCode Action

The project includes:

```text
.gitcode/workflows/ci.yml
```

GitCode/AtomGit documents `.gitcode/workflows/*.yml` as the workflow location. After the first commit, the CI workflow can be enabled/run from the repository's Pipeline area if the project's pipeline capability is available.

## GitHub

The same source remains compatible with the existing `.github/workflows/` configuration.
