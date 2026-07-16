# Investigation pipeline

The pipeline progresses through URL intake, safety validation, deterministic diagnostics, evidence normalization, deterministic findings, optional AI interpretation, and presentation.

Tools return a success envelope or structured partial failure. They do not throw protocol details as untyped strings. Every network operation has a timeout, redirect limit, byte limit, and audit event. The orchestrator may continue when an optional tool fails and represents the unavailable stage honestly.

Layer 1 uses recorded-style seeded investigations at the presentation boundary. Layer 3 replaces HTTP mock stages with safe live results; Layers 4 and 5 progressively add DNS, TLS, and browser evidence without changing the client contract.
