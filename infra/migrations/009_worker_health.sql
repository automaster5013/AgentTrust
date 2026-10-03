-- Infrastructure heartbeat contains no tenant data or credentials.
CREATE TABLE agenttrust.service_health (
  service text PRIMARY KEY CHECK(service='worker'),
  last_seen timestamptz NOT NULL
);
GRANT SELECT ON agenttrust.service_health TO agenttrust_api;
GRANT INSERT,UPDATE ON agenttrust.service_health TO agenttrust_worker;
