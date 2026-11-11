"""The sample plugin directory's computed stub-model scenarios (scripts/agent-stack/stub_model.py --scenario-module)."""

SCENARIOS = {
    # Makes an item, uses it by the id the first call returned, and ends naming both results.
    "#chain": [
        ("sample_make", {}),
        ("sample_use", lambda turn: {"item_id": turn.results[0]}),
        ("sample_use", lambda turn: f"Made {turn.results[0]}, then: {turn.results[1]}"),
    ],
}
