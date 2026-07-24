-- Safe manual SQL for production:
-- 1) Adds users.machine_id only if missing.
-- 2) Adds the machine_id index only if missing.
-- 3) Creates user_documents only if missing.

SET @db_name := DATABASE();

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `users` ADD COLUMN `machine_id` VARCHAR(100) NULL AFTER `email`',
    'SELECT ''users.machine_id already exists'' AS message'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'machine_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `users` ADD INDEX `users_machine_id_idx` (`machine_id`)',
    'SELECT ''users_machine_id_idx already exists'' AS message'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'users_machine_id_idx'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `user_documents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NULL,
  `machine_id` VARCHAR(100) NULL,
  `document_type` ENUM('copy_of_cnic','two_pics','nda','contract_letter','extra') NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_path` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(100) NULL,
  `file_size` BIGINT UNSIGNED NULL,
  `uploaded_by` BIGINT UNSIGNED NULL,
  `uploaded_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_documents_machine_id_idx` (`machine_id`),
  KEY `user_documents_user_type_idx` (`user_id`, `document_type`),
  KEY `user_documents_machine_type_idx` (`machine_id`, `document_type`),
  KEY `user_documents_uploaded_by_idx` (`uploaded_by`),
  CONSTRAINT `user_documents_user_id_foreign`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `user_documents_uploaded_by_foreign`
    FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
