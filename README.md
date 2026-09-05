# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Database guards (Supabase)

`supabase/schema-guards.sql` holds the rules that protect league connections:
one Huddle account per team, membership rows only writable by their owner, and
league settings only changeable by a commissioner.

Run it in the Supabase SQL editor. The app checks the same rules before it
writes, but an app check is only a courtesy — anyone can call the Supabase REST
API directly with their own session token and skip the UI. **Until this SQL is
applied, those rules are not actually enforced.**

Run the AUDIT query at the top first: if a team is already claimed by more than
one account, the unique index will refuse to build until that is resolved.
