export async function heartbeat(database){
  await database.query("INSERT INTO agenttrust.service_health(service,last_seen) VALUES('worker',clock_timestamp()) ON CONFLICT(service) DO UPDATE SET last_seen=excluded.last_seen");
}
