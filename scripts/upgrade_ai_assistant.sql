-- AI Assistant upgrade: several chats per person, an activity log with
-- "confirm first" for risky actions, per-company settings, and the assistant
-- as an add-on on Apps & Add-ons.
--
-- ai_agent_conversations   One row per chat (a person's own; never shared).
-- ai_agent_messages        + conversation_id (which chat), meta (JSON: action ids,
--                          record links, steps, attached document name) and
--                          tokens (AI usage of an answer). Existing messages are
--                          put in one "Earlier chat" per person.
-- ai_agent_actions         Every change the assistant made or proposed: who,
--                          when, what (tool + arguments), the one-line summary
--                          shown on the card, and the outcome. Risky actions
--                          wait here as PENDING until the person presses
--                          Confirm (or Cancel, or they expire).
-- ai_agent_settings        Per company: may the assistant change data at all,
--                          and how many messages one person may send per day.
-- company_modules          The assistant becomes the add-on "ai_agent". Every
--                          existing company gets it switched on, so nothing
--                          changes for anyone; new companies switch it on
--                          themselves on Apps & Add-ons.
--
-- Run this BEFORE deploying the backend that reads it. Safe to run more than once.

CREATE TABLE IF NOT EXISTS ai_agent_conversations (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  company_id  BIGINT       NOT NULL,
  user_id     BIGINT       NOT NULL,
  title       VARCHAR(120) NOT NULL DEFAULT 'New chat',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ai_conv_user (company_id, user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_agent_actions (
  id               BIGINT       NOT NULL AUTO_INCREMENT,
  company_id       BIGINT       NOT NULL,
  user_id          BIGINT       NOT NULL,
  conversation_id  BIGINT       NULL,
  tool             VARCHAR(64)  NOT NULL,
  kind             VARCHAR(12)  NOT NULL,
  summary          VARCHAR(400) NOT NULL,
  details          TEXT         NULL,
  args             TEXT         NOT NULL,
  status           VARCHAR(12)  NOT NULL,
  result           VARCHAR(500) NULL,
  record_type      VARCHAR(20)  NULL,
  record_id        BIGINT       NULL,
  record_label     VARCHAR(120) NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at       DATETIME     NULL,
  expires_at       DATETIME     NULL,
  PRIMARY KEY (id),
  KEY ix_ai_act_company (company_id, created_at),
  KEY ix_ai_act_user (user_id, status),
  KEY ix_ai_act_conv (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_agent_settings (
  company_id     BIGINT   NOT NULL,
  allow_changes  TINYINT  NOT NULL DEFAULT 1,
  daily_limit    INT      NOT NULL DEFAULT 100,
  updated_by     BIGINT   NULL,
  updated_at     DATETIME NULL,
  PRIMARY KEY (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS samebook_ai_assistant;
DELIMITER //
CREATE PROCEDURE samebook_ai_assistant()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_agent_messages' AND COLUMN_NAME = 'conversation_id') THEN
    ALTER TABLE ai_agent_messages ADD COLUMN conversation_id BIGINT NULL AFTER company_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_agent_messages' AND COLUMN_NAME = 'meta') THEN
    ALTER TABLE ai_agent_messages ADD COLUMN meta TEXT NULL AFTER content;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_agent_messages' AND COLUMN_NAME = 'tokens') THEN
    ALTER TABLE ai_agent_messages ADD COLUMN tokens INT NULL AFTER meta;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_agent_messages' AND INDEX_NAME = 'ix_ai_msg_conv') THEN
    ALTER TABLE ai_agent_messages ADD INDEX ix_ai_msg_conv (conversation_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_agent_messages' AND INDEX_NAME = 'ix_ai_msg_usage') THEN
    ALTER TABLE ai_agent_messages ADD INDEX ix_ai_msg_usage (company_id, user_id, role, created_at);
  END IF;
END //
DELIMITER ;
CALL samebook_ai_assistant();
DROP PROCEDURE samebook_ai_assistant;

-- Existing messages: one "Earlier chat" per person who has any.
INSERT INTO ai_agent_conversations (company_id, user_id, title, created_at, updated_at)
SELECT m.company_id, m.user_id, 'Earlier chat', MIN(m.created_at), MAX(m.created_at)
FROM ai_agent_messages m
WHERE m.conversation_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM ai_agent_conversations c
                  WHERE c.company_id = m.company_id AND c.user_id = m.user_id AND c.title = 'Earlier chat')
GROUP BY m.company_id, m.user_id;

UPDATE ai_agent_messages m
JOIN ai_agent_conversations c
  ON c.company_id = m.company_id AND c.user_id = m.user_id AND c.title = 'Earlier chat'
SET m.conversation_id = c.id
WHERE m.conversation_id IS NULL;

-- The assistant as an add-on, switched on for every existing company.
INSERT INTO company_modules (company_id, module_key, enabled, plan, enabled_at)
SELECT c.id, 'ai_agent', 1, 'FREE', NOW()
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM company_modules m WHERE m.company_id = c.id AND m.module_key = 'ai_agent');
