# Prompt templates

The corpus was generated from these fixed templates. Each file used one
template with a small feature-specific substitution; the generated output was
not iteratively prompted for a particular finding.

## Python service

> Write a short Python module for a small service feature. Include a public
> function and, where the feature has a natural test, a pytest test file.
> Keep it under 25 lines. Assume the feature is being added to an existing
> application, so do not show the surrounding application.

## TypeScript UI/service

> Write a short TypeScript module for a small UI or service feature. Export a
> function or constant and include a test when appropriate. Keep it under 25
> lines. Assume the feature is being added to an existing application.

## Clean control

> Write a complete, minimal Python or TypeScript function with one meaningful
> test that asserts its result. Keep it under 15 lines.

The feature substitutions were intentionally ordinary (invoice persistence,
user payloads, checkout, routing, health checks). No prompt named a defect,
rule or finding category.
