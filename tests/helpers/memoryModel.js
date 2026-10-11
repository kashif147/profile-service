"use strict";
/**
 * Minimal in-memory stand-in for a Mongoose model, for tenant-isolation tests
 * (no DB). Supports the query/update surface the profile-service controllers
 * actually use: find/findOne/findById/countDocuments/exists/distinct,
 * updateOne/updateMany/findOneAndUpdate (with upsert), deleteOne, create,
 * `new Model(data).save()`, and chainable .select/.lean/.sort/.skip/.limit/
 * .populate/.session. Matching covers equality (ObjectId-as-string), dot paths,
 * array membership, RegExp, $in/$nin/$ne/$exists/$gt/$gte/$lt/$lte, $or/$and.
 *
 * Every call is recorded in `Model.calls` so tests can assert on filters.
 */
const crypto = require("crypto");

function getPath(obj, path) {
  const parts = path.split(".");
  let cur = [obj];
  for (const part of parts) {
    const next = [];
    for (const c of cur) {
      if (c == null) continue;
      const v = c[part];
      if (Array.isArray(v)) {
        next.push(v);
        for (const item of v) next.push(item);
      } else {
        next.push(v);
      }
    }
    cur = next;
  }
  return cur;
}

function eq(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (a instanceof Date || b instanceof Date) {
    return new Date(a).getTime() === new Date(b).getTime();
  }
  if (typeof a === "object" && typeof a.toHexString !== "function" && !Array.isArray(a)) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return String(a) === String(b);
}

function isOperatorObject(v) {
  return (
    v &&
    typeof v === "object" &&
    !(v instanceof RegExp) &&
    !(v instanceof Date) &&
    typeof v.toHexString !== "function" &&
    !Array.isArray(v) &&
    Object.keys(v).length > 0 &&
    Object.keys(v).every((k) => k.startsWith("$"))
  );
}

function valueMatches(values, cond) {
  // values: candidate values found at the path (may include arrays + members)
  const flat = values.length ? values : [undefined];
  if (cond instanceof RegExp) {
    return flat.some((v) => typeof v === "string" && cond.test(v));
  }
  if (isOperatorObject(cond)) {
    return Object.entries(cond).every(([op, arg]) => {
      switch (op) {
        case "$in":
          return arg.some((a) =>
            a instanceof RegExp
              ? flat.some((v) => typeof v === "string" && a.test(v))
              : flat.some((v) => eq(v, a)),
          );
        case "$nin":
          return !arg.some((a) => flat.some((v) => eq(v, a)));
        case "$ne":
          return !flat.some((v) => eq(v, arg));
        case "$exists":
          return arg ? flat.some((v) => v !== undefined) : flat.every((v) => v === undefined);
        case "$gt":
          return flat.some((v) => v != null && v > arg);
        case "$gte":
          return flat.some((v) => v != null && v >= arg);
        case "$lt":
          return flat.some((v) => v != null && v < arg);
        case "$lte":
          return flat.some((v) => v != null && v <= arg);
        case "$regex":
          return flat.some((v) => typeof v === "string" && (arg instanceof RegExp ? arg : new RegExp(arg, cond.$options || "")).test(v));
        case "$options":
          return true;
        default:
          throw new Error(`memoryModel: unsupported operator ${op}`);
      }
    });
  }
  if (cond === null) return flat.every((v) => v == null);
  return flat.some((v) => eq(v, cond));
}

function matches(doc, query = {}) {
  return Object.entries(query || {}).every(([key, cond]) => {
    if (key === "$or") return cond.some((q) => matches(doc, q));
    if (key === "$and") return cond.every((q) => matches(doc, q));
    if (key === "$expr") throw new Error("memoryModel: $expr unsupported");
    return valueMatches(getPath(doc, key), cond);
  });
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function unsetPath(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cur[parts[i]] == null) return;
    cur = cur[parts[i]];
  }
  delete cur[parts[parts.length - 1]];
}

function clone(v) {
  if (v == null || typeof v !== "object") return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof RegExp) return v;
  if (typeof v.toHexString === "function") return v;
  if (Array.isArray(v)) return v.map(clone);
  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = clone(val);
  return out;
}

function applyUpdate(doc, update, { inserting = false } = {}) {
  if (Array.isArray(update)) return; // aggregation-pipeline updates: no-op here
  const hasOps = Object.keys(update || {}).some((k) => k.startsWith("$"));
  if (!hasOps) {
    for (const [k, v] of Object.entries(update || {})) setPath(doc, k, clone(v));
    return;
  }
  for (const [k, v] of Object.entries(update.$set || {})) setPath(doc, k, clone(v));
  for (const k of Object.keys(update.$unset || {})) unsetPath(doc, k);
  if (inserting) {
    for (const [k, v] of Object.entries(update.$setOnInsert || {})) setPath(doc, k, clone(v));
  }
}

function seedFromFilter(filter) {
  const doc = {};
  for (const [k, v] of Object.entries(filter || {})) {
    if (k.startsWith("$")) continue;
    if (isOperatorObject(v) || v instanceof RegExp) continue;
    setPath(doc, k, clone(v));
  }
  return doc;
}

function createMemoryModel(name) {
  const store = [];
  const calls = [];

  function attachMethods(doc) {
    const define = (k, fn) =>
      Object.defineProperty(doc, k, { value: fn, enumerable: false, configurable: true, writable: true });
    define("save", async function save() {
      const idx = store.findIndex((d) => String(d._id) === String(doc._id));
      const plain = clone(toPlain(doc));
      if (idx >= 0) store[idx] = plain;
      else store.push(plain);
      calls.push({ op: "save", doc: plain });
      return doc;
    });
    define("toObject", function toObject() {
      return clone(toPlain(doc));
    });
    define("toJSON", function toJSON() {
      return clone(toPlain(doc));
    });
    define("markModified", () => {});
    define("$locals", {});
    return doc;
  }

  function toPlain(doc) {
    const out = {};
    for (const k of Object.keys(doc)) out[k] = doc[k];
    return out;
  }

  function hydrate(plain) {
    return plain ? attachMethods(clone(plain)) : plain;
  }

  function Query(executor) {
    let leanFlag = false;
    let sortSpec = null;
    let skipN = 0;
    let limitN = null;
    const q = {
      select: () => q,
      populate: () => q,
      session: () => q,
      sort: (s) => ((sortSpec = s), q),
      skip: (n) => ((skipN = n || 0), q),
      limit: (n) => ((limitN = n), q),
      lean: () => ((leanFlag = true), q),
      exec: () => run(),
      then: (res, rej) => run().then(res, rej),
      catch: (rej) => run().catch(rej),
    };
    async function run() {
      return executor({ lean: leanFlag, sortSpec, skipN, limitN });
    }
    return q;
  }

  function sorted(rows, sortSpec) {
    if (!sortSpec) return rows;
    const [[key, dir]] = Object.entries(sortSpec);
    return [...rows].sort((a, b) => {
      const av = getPath(a, key)[0];
      const bv = getPath(b, key)[0];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av > bv ? 1 : av < bv ? -1 : 0) * (dir < 0 ? -1 : 1);
    });
  }

  function Model(data = {}) {
    const doc = clone(data);
    if (!doc._id) doc._id = crypto.randomBytes(12).toString("hex");
    return attachMethods(doc);
  }
  Model.modelName = name;
  Model.store = store;
  Model.calls = calls;
  Model.reset = () => {
    store.length = 0;
    calls.length = 0;
  };
  Model.seed = (docs) => {
    for (const d of docs) {
      const doc = clone(d);
      if (!doc._id) doc._id = crypto.randomBytes(12).toString("hex");
      store.push(doc);
    }
  };
  Model.all = () => store.map(clone);

  Model.find = (filter = {}) => {
    calls.push({ op: "find", filter });
    return Query(({ lean, sortSpec, skipN, limitN }) => {
      let rows = sorted(store.filter((d) => matches(d, filter)), sortSpec);
      rows = rows.slice(skipN, limitN != null ? skipN + limitN : undefined);
      return rows.map((r) => (lean ? clone(r) : hydrate(r)));
    });
  };
  Model.findOne = (filter = {}) => {
    calls.push({ op: "findOne", filter });
    return Query(({ lean, sortSpec }) => {
      const row = sorted(store.filter((d) => matches(d, filter)), sortSpec)[0];
      if (!row) return null;
      return lean ? clone(row) : hydrate(row);
    });
  };
  Model.findById = (id) => {
    calls.push({ op: "findById", filter: { _id: id } });
    return Model.findOne({ _id: id });
  };
  Model.countDocuments = async (filter = {}) => {
    calls.push({ op: "countDocuments", filter });
    return store.filter((d) => matches(d, filter)).length;
  };
  Model.exists = async (filter = {}) => {
    calls.push({ op: "exists", filter });
    const row = store.find((d) => matches(d, filter));
    return row ? { _id: row._id } : null;
  };
  Model.distinct = async (field, filter = {}) => {
    calls.push({ op: "distinct", filter });
    const vals = store.filter((d) => matches(d, filter)).map((d) => getPath(d, field)[0]);
    return [...new Set(vals)];
  };
  Model.create = async (data) => {
    const doc = Model(data);
    await doc.save();
    calls.push({ op: "create", doc: clone(toPlain(doc)) });
    return doc;
  };
  Model.updateOne = (filter, update, options = {}) => {
    calls.push({ op: "updateOne", filter, update, options });
    return Query(() => {
      const row = store.find((d) => matches(d, filter));
      if (row) {
        applyUpdate(row, update);
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (options.upsert) {
        const doc = seedFromFilter(filter);
        doc._id = doc._id || crypto.randomBytes(12).toString("hex");
        applyUpdate(doc, update, { inserting: true });
        store.push(doc);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    });
  };
  Model.updateMany = (filter, update, options = {}) => {
    calls.push({ op: "updateMany", filter, update, options });
    return Query(() => {
      const rows = store.filter((d) => matches(d, filter));
      rows.forEach((r) => applyUpdate(r, update));
      return { matchedCount: rows.length, modifiedCount: rows.length };
    });
  };
  Model.findOneAndUpdate = (filter, update, options = {}) => {
    calls.push({ op: "findOneAndUpdate", filter, update, options });
    return Query(({ lean }) => {
      let row = store.find((d) => matches(d, filter));
      if (row) {
        applyUpdate(row, update);
      } else if (options.upsert) {
        row = seedFromFilter(filter);
        row._id = row._id || crypto.randomBytes(12).toString("hex");
        applyUpdate(row, update, { inserting: true });
        store.push(row);
      } else {
        return null;
      }
      return lean ? clone(row) : hydrate(row);
    });
  };
  Model.deleteOne = (filter) => {
    calls.push({ op: "deleteOne", filter });
    return Query(() => {
      const idx = store.findIndex((d) => matches(d, filter));
      if (idx >= 0) store.splice(idx, 1);
      return { deletedCount: idx >= 0 ? 1 : 0 };
    });
  };
  Model.collection = {
    findOne: async (filter) => {
      calls.push({ op: "collection.findOne", filter });
      const row = store.find((d) => matches(d, filter));
      return row ? clone(row) : null;
    },
    updateOne: async (filter, update) => {
      calls.push({ op: "collection.updateOne", filter, update });
      const row = store.find((d) => matches(d, filter));
      if (row) applyUpdate(row, update);
      return { matchedCount: row ? 1 : 0 };
    },
  };
  return Model;
}

/** Fake mongoose session for controllers that open transactions. */
function fakeSession() {
  let inTx = false;
  return {
    startTransaction: () => {
      inTx = true;
    },
    commitTransaction: async () => {
      inTx = false;
    },
    abortTransaction: async () => {
      inTx = false;
    },
    inTransaction: () => inTx,
    endSession: () => {},
  };
}

/** Minimal Express-like res capturing status/body, incl. the service's helpers. */
function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  res.success = (data) => ((res.statusCode = 200), (res.body = { data }), res);
  res.notFoundRecord = (message) => ((res.statusCode = 404), (res.body = { message }), res);
  return res;
}

module.exports = { createMemoryModel, fakeSession, mockRes, matches };
