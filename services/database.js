import mongoose from "mongoose";
import { requireMongoUri } from "../config/appConfig.js";

let connectionPromise;

export async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(requireMongoUri(), {
      autoIndex: true
    });
  }

  await connectionPromise;
  return mongoose.connection;
}
