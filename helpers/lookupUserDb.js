const mongoose = require("mongoose");

let lookupConnection = null;

function resolveUserServiceMongoUri() {
  if (process.env.USER_SERVICE_MONGO_URI) {
    return process.env.USER_SERVICE_MONGO_URI;
  }
  const base = process.env.MONGO_URI || process.env.LOOKUP_MONGO_URI;
  if (!base) return null;
  return base.replace(
    /(mongodb(?:\+srv)?:\/\/[^/]+\/)([^/?]+)/,
    "$1User-Service",
  );
}

async function getLookupUserDbConnection() {
  if (lookupConnection?.readyState === 1) {
    return lookupConnection;
  }

  const uri = resolveUserServiceMongoUri();
  if (!uri) {
    throw new Error(
      "User-Service Mongo URI is not configured for lookup reads",
    );
  }

  lookupConnection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 10000,
  });

  if (typeof lookupConnection.asPromise === "function") {
    await lookupConnection.asPromise();
  } else {
    await new Promise((resolve, reject) => {
      lookupConnection.once("connected", resolve);
      lookupConnection.once("error", reject);
    });
  }

  return lookupConnection;
}

function getLookupModels(connection) {
  const lookupSchema = new mongoose.Schema(
    {
      code: String,
      lookupname: String,
      DisplayName: String,
      lookuptypeId: mongoose.Schema.Types.ObjectId,
      isdeleted: Boolean,
      isactive: Boolean,
      processSalaryDeduction: Boolean,
    },
    { collection: "lookups" },
  );

  const lookupTypeSchema = new mongoose.Schema(
    {
      code: String,
      lookuptype: String,
      displayname: String,
    },
    { collection: "lookuptypes" },
  );

  const Lookup =
    connection.models.Lookup || connection.model("Lookup", lookupSchema);
  const LookupType =
    connection.models.LookupType ||
    connection.model("LookupType", lookupTypeSchema);

  return { Lookup, LookupType };
}

module.exports = {
  getLookupUserDbConnection,
  getLookupModels,
  resolveUserServiceMongoUri,
};
