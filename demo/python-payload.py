# File: python-payload.py
# Project: pretty-objects
# Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
# License: Apache-2.0

training_manifest = {
  "dataset": "foundation-mix-v7",
  "version": "2026.03.25",
  "splits": {
    "train": {
      "records": 18234567,
      "estimated_tokens": 9482231142,
    },
    "validation": {
      "records": 102400,
      "estimated_tokens": 58231119,
    },
    "test": {
      "records": 20480,
      "estimated_tokens": 11041282,
    },
  },
  "filters": {
    "min_quality_score": 0.82,
    "max_toxicity_score": 0.08,
    "deduplication": {
      "exact": True,
      "normalized": True,
      "semantic": {
        "enabled": True,
        "model": "text-embed-large-v2",
        "threshold": 0.985,
      },
    },
  },
  "sources": [
    {
      "name": "synthetic-support-v2",
      "task": "instruction-following",
      "weight": 0.24,
    },
    {
      "name": "customer-intent-v1",
      "task": "classification",
      "weight": 0.16,
    },
    {
      "name": "incident-reports-v3",
      "task": "summarization",
      "weight": 0.14,
    },
    {
      "name": "assistant-routing-v4",
      "task": "tool-call-routing",
      "weight": 0.12,
    },
  ],
  "runtime": {
    "cluster": "gpu-prep-west",
    "workers": 48,
    "current_stage": "shard-and-publish",
    "status": "running",
  },
  "notes": "This payload is intentionally dense so formatter output is visibly better after cleanup.",
}

print(training_manifest["dataset"])
