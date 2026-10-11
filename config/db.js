const mongoose = require("mongoose");

exports.mongooseConnection = async () => {
  try {
    // Build connection string with environment variables
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error("MONGO_URI is required (no connection string is hardcoded)");
    }

    // Connection options for better Atlas connectivity
    const options = {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    };

    await mongoose.connect(mongoUri, options).then((data) => {
      console.log(
        `SuccessFully Connected to the MongoDB ===> "${data.connection.name}"`
      );
    });
  } catch (e) {
    console.error("Unable to connect to database:", e);
  }
};
