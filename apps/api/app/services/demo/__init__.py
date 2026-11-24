"""The no-login demo agent builder (build spec: "VoicEra build spec: demo agent builder").

- ``kb``: loads the content team's spreadsheet into a validated, versioned snapshot.
- ``flows``: the server-held question-flow state machine.
- ``prompts``: the GPT-4.1 base prompt, the six template blocks and the router prompt.
- ``builder``: turns the visitor's answers into one agent config and its filled prompt.
- ``sources``: uploaded documents and pasted links, as session-only cards.
- ``calls``: per-call state and the six tools the voice runtime calls.
"""
