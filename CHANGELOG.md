# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-04-30

### Added

- **Notes management** for people and companies via `noteTargets`:
  - `create_person_note` — attach a new note to a person
  - `upsert_person_note` — create or update note matching a stable key
  - `update_note` — edit an existing note's title/body
  - `get_note` — fetch a single note by id
  - `list_person_notes` — list notes attached to a person
  - `delete_note` — remove a note
- **Companies tools** with dynamic custom field introspection — same shape as
  people tools (`get_company`, `list_companies`, `create_company`,
  `update_company`, `upsert_company`).

### Fixed

- Custom fields written in camelCase from the agent are now mapped to the
  lowercase column names Twenty's GraphQL schema expects, instead of failing
  silently.

### Notes

This release exists because the features above had been on `main` since April
24 but were never published — consumers running
`npx -y @flutchai/mcp-server-twenty` were still pulling 0.1.0 (people-only)
and silently falling back to `update_person`, losing business-context data
agents tried to attach as notes.

## [0.1.0] — 2026-04-13

### Added

- Initial release: people tools (`get_person`, `list_people`, `create_person`,
  `update_person`, `upsert_person`) with dynamic custom field discovery via
  Twenty's GraphQL introspection.
