import type { IndexDescription } from "mongodb";

export const databaseCollectionNames = {
  batches: "batches",
  documents: "documents",
  chunks: "chunks",
} as const;

export const batchIndexes = [
  {
    name: "batch_id_unique",
    key: { id: 1 },
    unique: true,
  },
  {
    name: "batch_session_lookup",
    key: { sessionId: 1, id: 1 },
  },
  {
    name: "batch_session_status",
    key: { sessionId: 1, status: 1 },
  },
  {
    name: "batch_expiration_ttl",
    key: { expiresAt: 1 },
    expireAfterSeconds: 0,
  },
] as const satisfies readonly IndexDescription[];

export const documentIndexes = [
  {
    name: "document_id_unique",
    key: { id: 1 },
    unique: true,
  },
  {
    name: "document_session_lookup",
    key: { sessionId: 1, batchId: 1, id: 1 },
  },
  {
    name: "document_batch_status",
    key: { sessionId: 1, batchId: 1, status: 1 },
  },
  {
    name: "document_expiration_ttl",
    key: { expiresAt: 1 },
    expireAfterSeconds: 0,
  },
] as const satisfies readonly IndexDescription[];

export const chunkIndexes = [
  {
    name: "chunk_id_unique",
    key: { id: 1 },
    unique: true,
  },
  {
    name: "chunk_document_lookup",
    key: { sessionId: 1, batchId: 1, documentId: 1, chunkIndex: 1 },
  },
  {
    name: "chunk_expiration_ttl",
    key: { expiresAt: 1 },
    expireAfterSeconds: 0,
  },
] as const satisfies readonly IndexDescription[];

export const chunkVectorSearchIndex = {
  name: "chunk_vector_search",
  type: "vectorSearch",
  definition: {
    fields: [
      {
        type: "vector",
        path: "embedding",
        numDimensions: 768,
        similarity: "cosine",
      },
      { type: "filter", path: "sessionId" },
      { type: "filter", path: "batchId" },
      { type: "filter", path: "documentId" },
    ],
  },
} as const;

export const chunkTextSearchIndex = {
  name: "chunk_text_search",
  type: "search",
  definition: {
    mappings: {
      dynamic: false,
      fields: {
        text: {
          type: "string",
        },
        sessionId: {
          type: "token",
          normalizer: "none",
        },
        batchId: {
          type: "token",
          normalizer: "none",
        },
        documentId: {
          type: "token",
          normalizer: "none",
        },
      },
    },
  },
} as const;
