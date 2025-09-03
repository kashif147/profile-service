import mongoose from "mongoose";
export async function mongooseConnection() {
  try {
    const uri =
      process.env.MONGO_URI ||
      process.env.MONGODB_URI ||
      process.env.DATABASE_URL ||
      "mongodb://127.0.0.1:27017/profile-service";
    const conn = await mongoose.connect(uri);
    console.log(`Mongo connected: ${conn.connection.name}`);
  } catch (e) {
    console.error("DB connect error:", e);
    process.exit(1);
  }
}
