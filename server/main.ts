import { createActivitiesServer } from "./activitiesServer.js";

const dataDir = process.env.DATA_DIR ?? "./server-data";
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "10001");
const adminAccessKey = process.env.ADMIN_ACCESS_KEY ?? "";
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET ?? "";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

const server = await createActivitiesServer({ dataDir, adminAccessKey, adminSessionSecret });
server.listen(port, host, () => {
  console.log(`Live Idol Timetable API listening on ${host}:${port}`);
});
