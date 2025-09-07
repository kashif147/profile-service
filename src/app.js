import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import { mongooseConnection } from "./config/db.js";
import responseMiddleware from "./middlewares/response.mw.js";
import logger from "./middlewares/logger.mw.js";
import applicationsRouter from "./routes/applications.routes.js";
import profileRouter from "./routes/profile.routes.js";
import { errorMiddleware } from "./middlewares/error.js";

const app = express();
mongooseConnection();

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "200mb" }));
app.use(cors());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret",
    resave: false,
    saveUninitialized: false,
  })
);
app.use(responseMiddleware);
app.use(logger);

// health
// app.get("/health", (req, res) => res.json({ ok: true }));
// app.get("/ready", (req, res) => res.json({ ok: true }));

// swagger
// app.use("/api/docs", swaggerServe, swaggerSetup);

// routes
app.use("/applications", applicationsRouter);
app.use("/profiles", profileRouter);

// 404
app.use((req, _res, next) =>
  next(Object.assign(new Error("Not found"), { status: 404 }))
);

// errors
app.use(errorMiddleware);

export default app;
