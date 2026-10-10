# Hermetic runner architecture

The hermetic runner starts an isolated Postgres instance, migrates and seeds it, then starts the API and client on dedicated ports. Flow JSON files drive agent-browser with deterministic locators, so the suite never needs an LLM.
