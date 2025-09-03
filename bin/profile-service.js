#!/usr/bin/env node
import http from "http";
import debugFactory from "debug";
import app from "../src/app.js";
const debug = debugFactory("profile-service:server");

const port = normalize(process.env.PORT || "3001");
app.set("port", port);
const server = http.createServer(app);
server.listen(port, () => console.log(`profile-service on :${port}`));
server.on("error", onError);
server.on("listening", () =>
  debug(`listening on ${typeof port === "string" ? port : ":" + port}`)
);

function normalize(v) {
  const p = parseInt(v, 10);
  if (Number.isNaN(p)) return v;
  return p >= 0 ? p : false;
}
function onError(err) {
  if (err.syscall !== "listen") throw err;
  const bind = typeof port === "string" ? `Pipe ${port}` : `Port ${port}`;
  if (err.code === "EACCES") {
    console.error(`${bind} requires elevated privileges`);
    process.exit(1);
  }
  if (err.code === "EADDRINUSE") {
    console.error(`${bind} is already in use`);
    process.exit(1);
  }
  throw err;
}
