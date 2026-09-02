import { MongoClient, type Db } from "mongodb";

import { getDatabaseEnv } from "@/lib/env";

type MongoGlobal = typeof globalThis & {
  __docchatMongoClientPromise?: Promise<MongoClient>;
};

const mongoGlobal = globalThis as MongoGlobal;

export async function getMongoClient(): Promise<MongoClient> {
  const { MONGODB_URI } = getDatabaseEnv();

  if (!mongoGlobal.__docchatMongoClientPromise) {
    const client = new MongoClient(MONGODB_URI);
    const connection = client.connect();

    mongoGlobal.__docchatMongoClientPromise = connection;

    void connection.catch(() => {
      if (mongoGlobal.__docchatMongoClientPromise === connection) {
        delete mongoGlobal.__docchatMongoClientPromise;
      }
    });
  }

  return mongoGlobal.__docchatMongoClientPromise;
}

export async function getDatabase(): Promise<Db> {
  const { MONGODB_DATABASE } = getDatabaseEnv();
  const client = await getMongoClient();

  return client.db(MONGODB_DATABASE);
}
