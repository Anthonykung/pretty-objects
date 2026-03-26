/*
 * File: literal-payload.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

type TrainingSample = {
  id: string;
  task: "classification" | "summarization" | "tool-call-routing" | "extraction";
  source: string;
  payload: Record<string, unknown>;
  metadata: {
    qualityScore: number;
    reviewed: boolean;
    tokenCount: number;
    tags: string[];
  };
};

type TrainingBatch = {
  batchId: string;
  createdAt: string;
  samples: TrainingSample[];
  pipeline: {
    stage: string;
    shardIndex: number;
    retryCount: number;
  };
};

const trainingBatch: TrainingBatch = {
  batchId: "batch-2026-03-25-044",
  createdAt: "2026-03-25T10:22:14.228Z",
  samples: [
    {
      id: "sample-41001",
      task: "classification",
      source: "customer-intent-v1",
      payload: {
        input: "My team cannot export the audit log anymore after the latest release.",
        target: {
          intent: "bug_report",
          urgency: "medium",
        },
      },
      metadata: {
        qualityScore: 0.96,
        reviewed: true,
        tokenCount: 24,
        tags: ["billing", "ops", "structured"],
      },
    },
    {
      id: "sample-41002",
      task: "summarization",
      source: "incident-reports-v3",
      payload: {
        document: {
          title: "Template cache issue",
          content: "A cache invalidation error caused prompt templates to recompile per request.",
        },
        summary: "A cache invalidation issue forced per-request template recompilation and increased latency.",
      },
      metadata: {
        qualityScore: 0.94,
        reviewed: true,
        tokenCount: 39,
        tags: ["incident", "summary", "latency"],
      },
    },
    {
      id: "sample-41003",
      task: "tool-call-routing",
      source: "assistant-routing-v4",
      payload: {
        input: "List failed runs from today that mention tokenizer timeout.",
        target: {
          tool: "run_search",
          arguments: {
            status: "failed",
            date: "today",
            query: "tokenizer timeout",
          },
        },
      },
      metadata: {
        qualityScore: 0.97,
        reviewed: false,
        tokenCount: 21,
        tags: ["tool-routing", "ops"],
      },
    },
  ],
  pipeline: {
    stage: "normalize",
    shardIndex: 12,
    retryCount: 0,
  },
};

export default trainingBatch;
