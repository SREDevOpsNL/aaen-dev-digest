# UI architecture

The App Router pages resolve route data, while client components under each route's `_components` directory own interaction state. TanStack Query hooks in `src/lib/hooks` are the only API boundary. PR-list finding previews are returned with list metadata; Review runs owns filtering locally so changing severity never requests an LLM.
