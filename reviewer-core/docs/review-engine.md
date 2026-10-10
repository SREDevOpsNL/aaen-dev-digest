# Review-engine architecture

The engine is pure: callers supply a diff, configuration, and injected LLM provider. It validates structured output, grounds findings against changed lines, and deterministically recomputes score. Provider-reported USD cost remains distinct from token-price estimates.
