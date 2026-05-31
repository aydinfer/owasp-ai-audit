import OpenAI from 'openai';
import { pineconeIndex } from './vectorstore';

const client = new OpenAI();

// Embedding + vector retrieval — a RAG path that feeds retrieved text back to
// the model (indirect prompt injection / augmentation manipulation surface).
export async function retrieve(query: string) {
  const emb = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });
  return pineconeIndex.query({ vector: emb.data[0].embedding, topK: 5 });
}
