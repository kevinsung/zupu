-- People are stored as JSON (every Person field except id); see src/model.ts.
CREATE TABLE people (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

-- Append-only change log. seq doubles as the data version clients poll for.
CREATE TABLE changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  editor TEXT NOT NULL,
  at INTEGER NOT NULL,
  summary TEXT NOT NULL,
  diffs TEXT NOT NULL
);

-- Failed password attempts, for rate limiting.
CREATE TABLE login_failures (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX login_failures_ip_at ON login_failures (ip, at);

-- Server-side settings, e.g. the random key that signs session cookies.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
