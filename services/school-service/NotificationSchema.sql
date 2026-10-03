-- EduOS notification foundation. Applied by school-service on start; every statement is idempotent.
-- A notification is written once by EduOS itself and never edited. Each recipient has their own row, so reading,
-- counting and tenant checks never depend on anything a client sends.
CREATE SCHEMA IF NOT EXISTS notify;
-- event_key identifies the business event (type, source record, occurrence). It is unique per school, so a retry,
-- a repeated save or a producer that runs twice can never create the same notification again.
-- wording and wording_version record which text was used: the EduOS default or the school's own (and its version).
CREATE TABLE IF NOT EXISTS notify.notifications(
 id uuid PRIMARY KEY, school_id uuid NOT NULL, type varchar(60) NOT NULL, category varchar(40) NOT NULL,
 title varchar(200) NOT NULL, body varchar(1000) NOT NULL, destination jsonb NOT NULL,
 source varchar(60) NOT NULL, event_key varchar(200) NOT NULL,
 wording varchar(10) NOT NULL DEFAULT 'default' CHECK(wording IN('default','school')), wording_version integer,
 created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS notifications_school_created ON notify.notifications(school_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_event ON notify.notifications(school_id,event_key);
CREATE TABLE IF NOT EXISTS notify.recipients(
 notification_id uuid NOT NULL REFERENCES notify.notifications(id) ON DELETE CASCADE, school_id uuid NOT NULL, user_id uuid NOT NULL,
 read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(notification_id,user_id));
CREATE INDEX IF NOT EXISTS recipients_inbox ON notify.recipients(school_id,user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS recipients_unread ON notify.recipients(school_id,user_id) WHERE read_at IS NULL;
-- The outbox. One row per recipient, channel and target, written in the same transaction as the notification.
-- 'in-app' is delivered by being stored. Every other channel starts 'pending' and is sent later by a delivery worker,
-- never inside the request that caused the event. target is the device for push and empty for the other channels.
-- A failed row with next_attempt_at set is retried; with it empty the worker has given up.
CREATE TABLE IF NOT EXISTS notify.deliveries(
 notification_id uuid NOT NULL REFERENCES notify.notifications(id) ON DELETE CASCADE, school_id uuid NOT NULL, user_id uuid NOT NULL,
 channel varchar(20) NOT NULL CHECK(channel IN('in-app','push','email','whatsapp','sms')), target varchar(80) NOT NULL DEFAULT '',
 status varchar(20) NOT NULL CHECK(status IN('pending','processing','delivered','failed','skipped')),
 attempts integer NOT NULL DEFAULT 0, last_error varchar(300), next_attempt_at timestamptz, delivered_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(notification_id,user_id,channel,target));
CREATE INDEX IF NOT EXISTS deliveries_due ON notify.deliveries(next_attempt_at) WHERE status IN('pending','failed') AND next_attempt_at IS NOT NULL;
-- A row exists only where a person changed the default (everything enabled).
CREATE TABLE IF NOT EXISTS notify.preferences(
 school_id uuid NOT NULL, user_id uuid NOT NULL, category varchar(40) NOT NULL,
 channel varchar(20) NOT NULL CHECK(channel IN('in-app','push','email','whatsapp','sms')),
 enabled boolean NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(school_id,user_id,category,channel));
-- A school's own wording for a notification. EduOS defaults live in code (NotificationTemplates) and are never stored
-- or changed here: deleting a row, or disabling it, returns the school to the EduOS default.
CREATE TABLE IF NOT EXISTS notify.template_overrides(
 school_id uuid NOT NULL, template_key varchar(60) NOT NULL,
 channel varchar(20) NOT NULL CHECK(channel IN('in-app','push','email','whatsapp','sms')),
 title varchar(200) NOT NULL, body varchar(1000) NOT NULL, enabled boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,template_key,channel));
-- A phone or tablet that may receive push for one signed-in account. The school and user always come from the access
-- token. An installation or push token belongs to one account at a time: registering it revokes any earlier owner.
-- No provider credential is stored here; push_token is the device's own address at the push provider.
CREATE TABLE IF NOT EXISTS notify.devices(
 id uuid PRIMARY KEY, school_id uuid NOT NULL, user_id uuid NOT NULL, installation_id varchar(100) NOT NULL,
 platform varchar(10) NOT NULL CHECK(platform IN('android','ios')), push_token varchar(512) NOT NULL, app_version varchar(40) NOT NULL DEFAULT '',
 enabled boolean NOT NULL DEFAULT true, revoked_at timestamptz, last_seen_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,user_id,installation_id));
CREATE INDEX IF NOT EXISTS devices_installation ON notify.devices(installation_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS devices_token ON notify.devices(push_token) WHERE revoked_at IS NULL;
